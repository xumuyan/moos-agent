import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateComparison, workloads } from './desktop-baseline.mjs';
const root = new URL('../../', import.meta.url);
const baseline = JSON.parse(await readFile(new URL('./desktop-baseline.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const make = side => ({
    sourceCommit: 'a'.repeat(40), functionalPassed: true, normalExit: true, forced: false, processTreeComplete: true,
    processes: [{pid:1,ppid:0,path:'/isolated/test-app',startedAt:'2026-11-17T00:00:00Z'}],
    conditions: {contentWidth:1240,contentHeight:820,scale:1,historyRows:1000,cycleTasks:10,piVersion:'1.5.0',themeHash:'c'.repeat(64),workloadHash:'d'.repeat(64)},
    storage: {installerBytes:100,runtimeDownloadBytes:0,appBundleBytes:side === 'electron' ? 500 : 100,runtimeBytes:300,dataBytes:100,fullDiskBytes:side === 'electron' ? 900 : 500},
    samples:Object.fromEntries(workloads.map(name => [name,{complete:true,visible:true,cpuPercent:side === 'electron'?10:4,footprintMiB:side === 'electron'?700:300,rssMiB:500,seconds:60,warmupSeconds:20}]))
  });
  return {schemaVersion:1,modelKind:'loopback-fixture-real-pi',productionDataUsed:false,visualAccepted:true,pairs:[0,1,2].map(i=>({order:i===1?'nsh-first':'electron-first',fixtureHash:'b'.repeat(64),electron:make('electron'),nsh:make('nsh')}))};
}
test('baseline references match the recorded Git revision; screenshots are real PNGs with pinned dimensions', async () => {
  for (const ref of baseline.references) {
    const bytes = execFileSync('git',['show',`${baseline.baseCommit}:${ref.path}`],{cwd:root,maxBuffer:10*1024*1024});
    assert.equal(hash(bytes),ref.sha256,ref.path);
    if (ref.role === 'historical-isolated-electron-screenshot') {
      assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      const dimensions=[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
      assert.deepEqual(dimensions,ref.pixels);
    }
  }
});
test('baseline preserves pre-existing untracked ownership and incomplete product gates', () => {
  assert.equal(baseline.initialTrackedDiff,''); assert.equal(baseline.initialWorktree.length,9);
  assert.equal(new Set(baseline.initialWorktree.map(x=>x.path)).size,9);
  for (const row of baseline.initialWorktree) { assert.match(row.sha256,/^[a-f0-9]{64}$/); assert.match(row.ownership,/pre-existing untracked/); }
  assert.equal(baseline.scope.mobile,'paused'); assert.equal(baseline.scope.electronChanges,false);
  assert.equal(baseline.visual.accepted,false); assert.equal(baseline.resource.measured,false); assert.equal(baseline.overallN01Complete,false);
});
test('comparison passes only a fully equivalent subset, not overall N01 or external model inference', () => {
  const out=validateComparison(fixture()); assert.equal(out.status,'passed-subset-only');
  assert.equal(out.gains.length,10); assert.equal(out.overallN01Complete,false); assert.equal(out.externalModel,false);
});
test('empty reports and missing samples cannot pass', () => {
  for(const value of [null,{},[],{schemaVersion:1,pairs:[]}]) assert.equal(validateComparison(value).status,'blocked');
  const v=fixture(); delete v.pairs[0].nsh.samples['idle-history']; assert.equal(validateComparison(v).status,'blocked');
});
test('unequal, hidden, incomplete, non-finite, failure, forced and production runs are blocked', () => {
  const cases=[
    v=>v.pairs[0].nsh.conditions.historyRows=0,
    v=>v.pairs[0].nsh.samples['idle-new'].visible=false,
    v=>v.pairs[0].nsh.samples['stream-tools'].complete=false,
    v=>v.pairs[0].nsh.samples['idle-history'].footprintMiB=null,
    v=>v.pairs[0].nsh.samples['idle-history'].cpuPercent=NaN,
    v=>v.pairs[0].nsh.samples['idle-history'].cpuPercent=-1,
    v=>v.pairs[0].nsh.samples['idle-new'].footprintMiB=0,
    v=>v.pairs[0].nsh.samples['idle-new'].seconds=12,
    v=>v.pairs[0].nsh.functionalPassed=false,
    v=>v.pairs[0].nsh.normalExit=false,
    v=>v.pairs[0].nsh.forced=true,
    v=>v.productionDataUsed=true,
    v=>v.visualAccepted=false,
    v=>v.modelKind='external-model',
    v=>v.pairs[0].nsh.processTreeComplete=false,
    v=>v.pairs[0].nsh.processes=[],
    v=>v.pairs[0].nsh.processes={},
    v=>v.pairs[0].nsh.conditions.themeHash=null,
    v=>v.pairs[0].nsh.processes[0].path='relative',
    v=>v.pairs[0].nsh.storage.installerBytes=null,
    v=>v.pairs[0].nsh.storage.installerBytes=0,
    v=>v.pairs[0].nsh.storage.runtimeBytes=0.5,
    v=>v.pairs[0].nsh.samples['idle-new'].warmupSeconds=Infinity,
    v=>v.pairs[0].nsh.processes.push({...v.pairs[0].nsh.processes[0]}),
    v=>{for(const p of v.pairs) for(const s of ['electron','nsh']) p[s].conditions.themeHash='unknown';},
    v=>v.pairs[0].nsh.storage.fullDiskBytes=1,
    v=>v.pairs[1].fixtureHash='c'.repeat(64),
    v=>v.pairs[1].order='electron-first',
  ];
  for(const change of cases) { const v=fixture(); change(v); assert.equal(validateComparison(v).status,'blocked',change.toString()); }
});
test('one regressed workload, zero improvement or jitter covering the gain is not demonstrated', () => {
  const v=fixture(); v.pairs[0].nsh.samples['idle-new'].cpuPercent=12; v.pairs[1].nsh.samples['idle-new'].cpuPercent=12;
  assert.equal(validateComparison(v).status,'not-demonstrated');
  const w=fixture(); for(const p of w.pairs) p.nsh.samples['idle-new'].cpuPercent=10; assert.equal(validateComparison(w).status,'not-demonstrated');
  const x=fixture(); x.pairs[0].electron.samples['idle-new'].cpuPercent=1; assert.equal(validateComparison(x).status,'not-demonstrated');
  const y=fixture(); y.pairs[0].nsh.storage.fullDiskBytes=900; assert.equal(validateComparison(y).status,'not-demonstrated');
});
test('shared wire adds only scoped read-only history; no renderer directory/credential method', async () => {
  const text=await readFile(new URL('./desktop-contract.ts',import.meta.url),'utf8');
  const block=text.split('export type Calls = {')[1].split('\n};')[0];
  assert.deepEqual([...block.matchAll(/^  '([^']+)':/gm)].map(m=>m[1]),['projects.list','sessions.list','sessions.create','sessions.history','tasks.submit','tasks.cancel','tasks.events']);
  assert.match(block, /'sessions.history': \{ params: Scope & \{ before: string \| null \}/);
  assert.doesNotMatch(block,/credentials|provider|shell|directory|filePath/);
});

test('CLI enforces exit codes on synthetic evidence; not an actual resource measurement', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir=await mkdtemp(join(tmpdir(),'n01-baseline-'));
  try {
    const file=join(dir,'synthetic.json');
    for (const [change,expected,status] of [
      [v=>v,0,'passed-subset-only'],
      [v=>{v.productionDataUsed=true;return v;},1,'blocked'],
      [v=>{v.pairs[0].nsh.storage.fullDiskBytes=900;return v;},1,'not-demonstrated'],
    ]) {
      await writeFile(file,JSON.stringify(change(fixture())));
      const out=spawnSync(process.execPath,['probes/nsh-validation/desktop-baseline.mjs',file],{cwd:root,encoding:'utf8'});
      assert.equal(out.status,expected);assert.equal(JSON.parse(out.stdout).status,status);
    }
    await writeFile(file,'invalid-json');
    assert.equal(spawnSync(process.execPath,['probes/nsh-validation/desktop-baseline.mjs',file],{cwd:root}).status,2);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
