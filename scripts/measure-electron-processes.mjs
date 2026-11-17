// Read-only process metrics. Never attaches a debugger to the production renderer.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export function cpuSeconds(value) {
  const match = /^(?:(\d+)-)?(\d+(?::\d+){1,2}(?:\.\d+)?)$/.exec(value);
  if (!match) throw new Error('Invalid ps CPU time');
  return Number(match[1] ?? 0) * 86400 + match[2].split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}
export function parseProcesses(text) {
  return text.split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!m) return [];
    return [{ pid: Number(m[1]), ppid: Number(m[2]), rssKiB: Number(m[3]), cpuSeconds: cpuSeconds(m[4]), executable: m[5] }];
  });
}
export function applicationProcesses(rows, rootPid) {
  const root = rows.find(row => row.pid === rootPid);
  if (!root || !root.executable.includes('.app/Contents/MacOS/')) throw new Error('Application main process is missing');
  const prefix = root.executable.split('.app/Contents/')[0] + '.app/Contents/';
  const owned = new Set([rootPid]);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; } }
  return rows.filter(row => owned.has(row.pid) && row.executable.startsWith(prefix));
}
export function intervalUsage(before, after, elapsedSeconds) {
  if (!(elapsedSeconds > 0)) throw new Error('Invalid sampling interval');
  const old = new Map(before.map(row => [row.pid, row]));
  const current = new Set(after.map(row => row.pid));
  const processes = after.map(row => ({ pid: row.pid,
    cpuPercent: 100 * Math.max(0, row.cpuSeconds - (old.get(row.pid)?.cpuSeconds ?? 0)) / elapsedSeconds,
    rssMiB: row.rssKiB / 1024 }));
  return { cpuPercent: processes.reduce((sum, row) => sum + row.cpuPercent, 0),
    rssMiB: processes.reduce((sum, row) => sum + row.rssMiB, 0), processes,
    newProcesses: after.filter(row => !old.has(row.pid)).length,
    exitedProcesses: before.filter(row => !current.has(row.pid)).length };
}
function snapshot(pid) {
  const text = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,time=,comm='], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' }, timeout: 5000 });
  return applicationProcesses(parseProcesses(text), pid);
}
export function parseFootprint(result, expectedPids = []) {
  if (!['byte', 'bytes'].includes(result.unit) || result['bytes per unit'] !== 1
    || !Number.isFinite(result['total footprint']) || result['total footprint'] < 0 || result.errors?.length
    || !Array.isArray(result.processes)
    || result.processes.some(p => !Number.isSafeInteger(p.pid) || p.pid <= 1 || !Number.isFinite(p.footprint) || p.footprint < 0)
    || expectedPids.some(pid => !result.processes.some(p => p.pid === pid))) {
    throw new Error('Incomplete footprint report');
  }
  return { status: 'measured', totalMiB: result['total footprint'] / 1048576,
    scope: 'macOS footprint tool total for the selected application processes',
    processes: result.processes.map(p => ({ pid: p.pid, footprintMiB: p.footprint / 1048576 })) };
}
async function footprint(rows) {
  const dir = await mkdtemp('/private/tmp/muma-footprint-');
  try {
    const file = join(dir, 'metrics.json');
    execFileSync('/usr/bin/footprint', [...rows.flatMap(row => ['-p', String(row.pid)]), '--noCategories', '-f', 'bytes', '-j', file], { stdio: 'ignore', timeout: 20000 });
    const result = JSON.parse(await readFile(file, 'utf8'));
    return parseFootprint(result, rows.map(row => row.pid));
  } catch (error) { return { status: 'unavailable', reason: String(error.code ?? error.name) }; }
  finally { await rm(dir, { recursive: true, force: true }); }
}
export async function measureApplication(pid, seconds = 30) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(seconds) || seconds < 4 || seconds > 120) throw new Error('Invalid measurement arguments');
  let before = snapshot(pid), at = performance.now();
  const samples = [], started = new Date().toISOString();
  for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
    await sleep(2000);
    const after = snapshot(pid), now = performance.now();
    samples.push(intervalUsage(before, after, (now - at) / 1000));
    before = after; at = now;
  }
  const mean = key => samples.reduce((sum, row) => sum + row[key], 0) / samples.length;
  return { started, ended: new Date().toISOString(), mainPid: pid, sampleSeconds: seconds,
    scope: 'main and descendant application executables; external build/tool processes excluded',
    cpuPercentMean: mean('cpuPercent'), cpuPercentPeak: Math.max(...samples.map(row => row.cpuPercent)),
    cpuScale: '100% = one CPU core', rssMiBMean: mean('rssMiB'),
    rssCaveat: 'RSS sum double-counts shared pages; do not describe it as exclusive app memory',
    footprint: await footprint(before), processChurn: samples.some(row => row.newProcesses || row.exitedProcesses),
    perProcess: before.map(row => ({ pid: row.pid,
      role: row.pid === pid ? 'main' : row.executable.includes('/Resources/host-runtime/') ? 'host'
        : row.executable.includes('(Renderer)') ? 'renderer' : 'helper',
      cpuPercentMean: samples.reduce((sum, sample) => sum + (sample.processes.find(p => p.pid === row.pid)?.cpuPercent ?? 0), 0) / samples.length,
      rssMiB: row.rssKiB / 1024 })), samples };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [pid, seconds, output] = process.argv.slice(2);
  const result = await measureApplication(Number(pid), Number(seconds ?? 30));
  if (output) await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output, cpuPercentMean: result.cpuPercentMean, rssMiBMean: result.rssMiBMean, footprint: result.footprint, perProcess: result.perProcess }));
}
