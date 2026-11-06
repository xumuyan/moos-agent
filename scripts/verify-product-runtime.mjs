import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { startFixture } from '../services/agent/fixture.mjs';

export class RuntimeClient {
  #child; #pending = new Map(); #id = 0; #closed = false;
  constructor(child) {
    this.#child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let value;
      try { if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw Error(); value = JSON.parse(line); if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.id)) throw Error(); }
      catch { this.#fail('Invalid runtime response'); return; }
      const entry = this.#pending.get(value.id);
      if (!entry) { this.#fail('Unexpected runtime response'); return; }
      this.#pending.delete(value.id); clearTimeout(entry.timer);
      if ('error' in value) entry.reject(new Error('Runtime request failed'));
      else if ('result' in value) entry.resolve(value.result);
      else entry.reject(new Error('Invalid runtime outcome'));
    });
    child.stderr?.resume(); // Never print raw diagnostics or credentials.
    child.stdin.on('error', () => this.#fail('Runtime input failed'));
    child.once('exit', () => this.#fail('Runtime exited'));
    child.once('error', () => this.#fail('Runtime startup failed'));
  }
  #fail(message) { this.#closed = true; for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } this.#pending.clear(); }
  request(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error('Runtime closed'));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error('Runtime request timed out')); }, 15000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) this.#fail('Runtime input failed'); });
    });
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await sleep(100); }
  throw new Error('Acceptance condition timed out');
}
export async function verifyProduct({ app, output, long = false, notify = () => {} }) {
  const bundle = await realpath(app), resources = join(bundle, 'Contents/Resources');
  const node = join(bundle, 'Contents/MacOS/node'), entry = join(resources, 'services/agent/main.mjs');
  assert(bundle.endsWith('.app'), 'Expected explicit app bundle');
  await Promise.all([readFile(entry), readFile(join(resources, 'runtime/package.json'))]);
  const root = await mkdtemp(join(tmpdir(), 'moos-p029-packaged-'));
  const fixture = await startFixture({ longDelayMs: long ? 605000 : 100 });
  const child = spawn(node, [entry, `--data-dir=${join(root, 'data')}`], {
    cwd: root, env: { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR, MOOS_RUNTIME_DIR: join(resources, 'runtime') }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit'); const client = new RuntimeClient(child);
  const report = { version: 1, surface: 'packaged Node + PI SDK stdio; not a GUI acceptance', root,
    hostPid: child.pid, shortTasks: 0, longRequested: long, longVerified: false, realProvider: false, checks: {} };
  const taskState = async id => (await client.request('snapshot')).tasks.find(t => t.id === id);
  const completed = id => until(async () => { const t = await taskState(id); if (['failed','cancelled','interrupted'].includes(t?.status)) throw new Error('Fixture task did not succeed'); return t?.status === 'succeeded' && t; });
  try {
    await client.request('snapshot');
    await client.request('save_provider', { provider: { id: 'fixture', name: 'P029 deterministic fixture', baseUrl: fixture.baseUrl, model: 'fixture', api: 'openai-completions' } });
    const conversations = [], projects = [];
    for (const name of ['alpha','beta']) { const path = join(root,name); await mkdir(path); const p = await client.request('add_project',{path}); projects.push(p); conversations.push(await client.request('create_conversation',{projectId:p.id})); }
    const submit = (i,message) => client.request('submit',{conversationId:conversations[i].id,message,providerId:'fixture',apiKey:fixture.apiKey});
    const started = Date.now();
    const held = await submit(0,'MOOS_FIXTURE_LONG');
    await until(async () => (await taskState(held.id))?.status === 'running');
    notify({ stage:'long_started',hostPid:child.pid,startedAt:new Date(started).toISOString() });
    for (let i=0;i<20;i++) {const task=await submit(1,`MOOS_FIXTURE_WRITE P029_${i}`);await completed(task.id);assert.equal(await readFile(join(projects[1].path,'result.txt'),'utf8'),`P029_${i}\n`);assert.equal(child.exitCode,null);report.shortTasks++;notify({stage:'short_complete',count:report.shortTasks,hostPid:child.pid});}
    const quiet=await submit(1,'MOOS_FIXTURE_LONG');await until(async()=>(await taskState(quiet.id))?.status==='running');
    let cancelAt=Date.now();await client.request('cancel',{taskId:quiet.id});await until(async()=>(await taskState(quiet.id))?.status==='cancelled');report.checks.modelCancelMs=Date.now()-cancelAt;
    const tool=await submit(1,'MOOS_FIXTURE_HOLD');
    const toolPid=await until(async()=>{try{return Number(await readFile(join(projects[1].path,'fixture-hold.pid'),'utf8'));}catch{return false;}});
    assert(Number.isSafeInteger(toolPid)&&toolPid>1);
    const queued=await submit(1,'MOOS_FIXTURE_WRITE MUST_NOT_RUN');assert.equal((await taskState(queued.id)).status,'queued');await client.request('cancel',{taskId:queued.id});
    cancelAt=Date.now();await client.request('cancel',{taskId:tool.id});await until(async()=>(await taskState(tool.id))?.status==='cancelled');
    await until(()=>{try{process.kill(toolPid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}});report.checks.toolCancelMs=Date.now()-cancelAt;report.checks.queuedCancelled=true;
    assert.equal(await readFile(join(projects[1].path,'result.txt'),'utf8'),'P029_19\n');
    let lastProgress=0;
    const finished=await until(async()=>{const t=await taskState(held.id);if(t?.status==='failed')throw new Error('Long task failed');if(Date.now()-lastProgress>30000){notify({stage:'long_wait',elapsedSeconds:Math.floor((Date.now()-started)/1000),status:t?.status});lastProgress=Date.now();}return t?.status==='succeeded'&&t;},long?660000:30000);
    report.longElapsedMs=Date.parse(finished.updatedAt)-Date.parse(finished.createdAt);report.longVerified=long&&report.longElapsedMs>600000;
    if(long)assert(report.longVerified);
    report.checks.otherProjectContinued=true;report.checks.stableHostPid=child.pid;report.checks.usage=await client.request('get_usage',{range:'all'});
    const state=await client.request('snapshot');report.checks.longHeartbeats=state.events.filter(e=>e.taskId===held.id&&e.type==='task_heartbeat').length;
    await client.request('shutdown');await exited;report.checks.hostExited=true;
    await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});notify({stage:'complete',output,longVerified:report.longVerified});return report;
  } finally {
    if(child.exitCode===null&&child.signalCode===null){try{await client.request('shutdown');}catch{} if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
    await fixture.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2), value=name=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
  const app=value('--app'), output=value('--output');
  if(!app||!output)throw new Error('Use --app=/explicit/Moos.app --output=/private/report.json [--long]');
  verifyProduct({app,output,long:args.includes('--long'),notify:value=>console.log(JSON.stringify(value))}).then(()=>process.exit(0),()=>{console.error('Packaged acceptance failed; no raw diagnostics printed');process.exit(1);});
}
