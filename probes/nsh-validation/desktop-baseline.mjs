// N01 desktop-only resource comparison gate. No processes launched or data collected here.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const workloads = ['idle-new', 'idle-history', 'stream-tools', 'cancel-drain', 'repeat-cycle'];
const median = xs => [...xs].sort((a,b) => a-b)[1];
const spread = xs => Math.max(...xs) - Math.min(...xs);
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const finite = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
export function validateComparison(report) {
  const errors = [], gains = [];
  const need = (ok, why) => { if (!ok) errors.push(why); };
  need(report?.schemaVersion === 1, 'schemaVersion');
  need(report?.modelKind === 'loopback-fixture-real-pi', 'model-kind: no external inference claim');
  need(report?.productionDataUsed === false, 'production-data-prohibited');
  need(report?.visualAccepted === true, 'visual-not-accepted');
  const pairs = report?.pairs;
  if (!Array.isArray(pairs) || pairs.length !== 3) return { status: 'blocked', errors: [...errors, 'three-pairs-required'], gains };
  for (const [i,p] of pairs.entries()) {
    need(p?.order === (i === 1 ? 'nsh-first' : 'electron-first'), `pair-${i}:order`);
    need(p && typeof p === 'object', `pair-${i}:object`);
    need(digest(p?.fixtureHash), `pair-${i}:fixtureHash`);
    for (const side of ['electron','nsh']) {
      const run = p?.[side];
      need(run?.functionalPassed === true && run?.normalExit === true && run?.forced === false, `pair-${i}:${side}:functional-or-exit`);
      need(run?.processTreeComplete === true && Array.isArray(run?.processes) && run.processes.length > 0, `pair-${i}:${side}:process-tree`);
      const ps = Array.isArray(run?.processes) ? run.processes : [];
      need(Array.isArray(ps) && ps.every(v => Number.isSafeInteger(v?.pid) && v.pid > 0 && Number.isSafeInteger(v?.ppid) && v.ppid >= 0 && typeof v?.path === 'string' && v.path.startsWith('/') && typeof v?.startedAt === 'string' && Number.isFinite(Date.parse(v.startedAt))), `pair-${i}:${side}:process-provenance`);
      need(new Set(ps.map(v => v?.pid)).size === ps.length, `pair-${i}:${side}:duplicate-pid`);
      need(typeof run?.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(run.sourceCommit), `pair-${i}:${side}:sourceCommit`);
      const storage = run?.storage;
      for (const name of ['installerBytes','runtimeDownloadBytes','appBundleBytes','runtimeBytes','dataBytes','fullDiskBytes']) need(Number.isSafeInteger(storage?.[name]) && storage[name] >= 0, `pair-${i}:${side}:storage:${name}`);
      if (storage) {
        need(storage.appBundleBytes > 0 && storage.installerBytes > 0, `pair-${i}:${side}:storage:empty-app-or-installer`);
        need(storage.fullDiskBytes >= storage.appBundleBytes + storage.runtimeBytes + storage.dataBytes, `pair-${i}:${side}:storage:full-scope`);
      }
      for (const name of workloads) {
        const s = run?.samples?.[name];
        need(s?.complete === true && s?.visible === true, `pair-${i}:${side}:${name}:incomplete-or-hidden`);
        for (const field of ['cpuPercent','footprintMiB','rssMiB','seconds']) need(finite(s?.[field]), `pair-${i}:${side}:${name}:${field}`);
        need(s?.seconds > 0 && s?.footprintMiB > 0 && s?.rssMiB > 0, `pair-${i}:${side}:${name}:zero-or-missing`);
        if (name.startsWith('idle') || name === 'repeat-cycle') need(s?.seconds >= 60 && finite(s?.warmupSeconds) && s.warmupSeconds >= 20, `pair-${i}:${side}:${name}:duration`);
      }
    }
    const a = p?.electron?.conditions, b = p?.nsh?.conditions;
    const keys = ['contentWidth','contentHeight','scale','historyRows','cycleTasks','piVersion','themeHash','workloadHash'];
    need(a && b && keys.every(k => a[k] !== undefined && a[k] === b[k]), `pair-${i}:unequal-conditions`);
    need(a && typeof a.piVersion === 'string' && a.piVersion.length > 0 && ['themeHash','workloadHash'].every(k => digest(a[k])), `pair-${i}:condition-provenance`);
    need(a?.contentWidth === 1240 && a?.contentHeight === 820 && finite(a?.scale) && a.scale > 0 && a?.historyRows === 1000 && a?.cycleTasks === 10, `pair-${i}:baseline-conditions`);
  }
  if (errors.length) return { status: 'blocked', errors, gains };
  // Reject non-comparable repetitions as well as unequal members within a pair.
  const conditions = JSON.stringify(pairs[0].electron.conditions);
  if (!pairs.every(p => p.fixtureHash === pairs[0].fixtureHash && JSON.stringify(p.electron.conditions) === conditions)) return { status: 'blocked', errors: ['repetition-conditions-changed'], gains };
  for (const name of workloads) for (const metric of ['cpuPercent','footprintMiB']) {
    const a = pairs.map(p => p.electron.samples[name][metric]), b = pairs.map(p => p.nsh.samples[name][metric]);
    const delta = median(a) - median(b), jitter = Math.max(spread(a),spread(b));
    gains.push({ workload: name, metric, electronMedian: median(a), nshMedian: median(b), delta, jitter, demonstrated: delta > jitter });
  }
  const diskReduced = pairs.every(p => p.nsh.storage.fullDiskBytes < p.electron.storage.fullDiskBytes);
  return { status: gains.every(g => g.demonstrated) && diskReduced ? 'passed-subset-only' : 'not-demonstrated', errors, gains, diskReduced, overallN01Complete: false, externalModel: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = validateComparison(JSON.parse(await readFile(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed-subset-only' ? 0 : 1;
  } catch { console.error('comparison unavailable: provide a sanitized schema-v1 report'); process.exitCode = 2; }
}
