// Explicit isolated Electron acceptance; never targets the installed Moos or user data.
// Verifies that the composer three-tier permission menu (ui-permission /
// dsh-client-ui-permission-presets) is removed in the 0.1.48 build while the same
// probe still finds it in the unpatched 0.1.47 control build.
// Usage: node gui.mjs <control-0.1.47.app> <candidate-0.1.48.app> <output-parent>
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { startFixture } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/services/agent/fixture.mjs';
import { checkedProvider } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/packages/pi-adapter/index.mjs';
import { piModels } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/plugin/pi-models.js';
import { seedHome } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/profile-home.mjs';

const [controlApp, candidateApp, output] = process.argv.slice(2);
if (!controlApp || !candidateApp || !output) throw new Error('Usage: node gui.mjs <control.app> <candidate.app> <output-parent>');
const repo = '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent';
const allowedBuild = resolve(repo, '.generated/moos-electron') + sep;
for (const p of [controlApp, candidateApp]) {
  const build = resolve(p);
  if (!build.startsWith(allowedBuild) || !(await realpath(build)).startsWith(allowedBuild)) {
    throw new Error('Only repository-isolated build paths are accepted');
  }
}
if (!resolve(output).startsWith(resolve(repo, 'artifacts') + sep)) throw new Error('Output must be inside repository artifacts');
await mkdir(resolve(output), { recursive: true });
const scratch = await mkdtemp(join(resolve(output), 'recovery-'));

const probe = `(() => {
  const text = document.body.textContent || '';
  const trigger = [...document.querySelectorAll('button')].find(b =>
    (b.getAttribute('aria-label') || '').startsWith('访问模式') || /SJRB_q_trigger/.test(String(b.className)));
  return {
    trigger: trigger ? { text: (trigger.textContent || '').slice(0, 20), aria: trigger.getAttribute('aria-label') } : null,
    triggerCount: document.querySelectorAll('button').length,
    composer: !!document.querySelector('[data-composer-input]'),
  };
})()`;

const menuProbe = `(() => {
  const text = document.body.textContent || '';
  const labels = ['仅可查看', '工作区内修改', '完全权限'];
  return labels.filter(l => text.includes(l));
})()`;

const relay = await startFixture({ desktopPolicy: true });

async function runOnce(buildPath, label) {
  const instance = join(scratch, label);
  await mkdir(instance, { recursive: true });
  const app = join(instance, 'Moos.app');
  execFileSync('/usr/bin/ditto', [resolve(buildPath), app]);
  const resources = join(app, 'Contents/Resources');
  const shellVersion = JSON.parse(await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
  const entry = join(resources, 'app/main.mjs');
  await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('Moos');", "BrowserWindow.prototype.show = function () {};\napp.setName('Moos');"));
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
  const data = join(instance, 'data');
  const home = join(data, 'dsh');
  await seedHome(resources, home);
  await piModels(data, checkedProvider).save({ id: 'menu-fixture', name: '权限菜单隔离验收', model: 'moos-fixture',
    baseUrl: relay.baseUrl, service: 'openai', api: 'openai-completions', apiKey: relay.apiKey });
  const patchText = await readFile(join(resources, 'execution.patch.yml'), 'utf8');
  const patchDisables = patchText.includes('- id: ui-permission');
  const macosDir = join(app, 'Contents/MacOS');
  const [executable] = (await readdir(macosDir)).filter(name => !name.startsWith('_'));
  const child = spawn(join(macosDir, executable), ['--remote-debugging-port=0'], {
    env: { ...process.env, MOOS_ELECTRON_DATA: data }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const closed = new Promise(r => child.once('exit', r));
  let port;
  const lines = createInterface({ input: child.stderr });
  lines.on('line', line => { const m = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) port = m[1]; });
  let ready = false;
  for (let i = 0; i < 240 && !port; i++) { await sleep(250); if (child.exitCode !== null) break; }
  if (!port) throw new Error(label + ': no debug port');
  let target;
  let socket;
  let seq = 0;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((r, j) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); j(new Error('CDP timeout')); }, 15000);
    pending.set(id, response => { clearTimeout(timer); pending.delete(id); response.error ? j(new Error(response.error.message)) : r(response.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('page evaluation failed: ' + JSON.stringify(result.exceptionDetails).slice(0, 300));
    return result.result.value;
  };
  try {
    for (let i = 0; i < 240; i++) {
      const list = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()).catch(() => []);
      target = list.find(row => row.url.startsWith('http://127.0.0.1:'));
      if (target) break;
      if (child.exitCode !== null) break;
      await sleep(250);
    }
    if (!target) throw new Error(label + ': workbench page not found');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
    socket.addEventListener('message', event => { const response = JSON.parse(event.data); pending.get(response.id)?.(response); });
    for (let i = 0; i < 240; i++) {
      const state = await evaluate(probe).catch(() => null);
      if (state?.composer) { ready = true; break; }
      if (child.exitCode !== null) break;
      await sleep(250);
    }
    if (!ready) throw new Error(label + ': composer never ready');
    await sleep(3000); // locale + composer bottom bar mount after the input element
    const state = await evaluate(probe);
    let menuLabels = [];
    if (state.trigger) {
      await evaluate(`(() => {
        const t = [...document.querySelectorAll('button')].find(b =>
          (b.getAttribute('aria-label') || '').startsWith('访问模式'));
        t?.click();
        return !!t;
      })()`);
      await sleep(800);
      menuLabels = await evaluate(menuProbe);
    }
    const screenshot = await call('Page.captureScreenshot');
    await writeFile(join(instance, 'composer.png'), Buffer.from(screenshot.data, 'base64'));
    await call('Page.close').catch(() => {});
    await Promise.race([closed, sleep(5000)]);
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([closed, sleep(5000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    socket.close();
    lines.close();
    return { label, version: shellVersion, patchDisables, ...state, menuLabels, screenshot: join(instance, 'composer.png'), dir: instance };
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    await Promise.race([closed, sleep(3000)]);
    lines.close();
    socket?.close();
    throw error;
  } finally {
    await rm(join(instance, 'Moos.app'), { recursive: true, force: true }).catch(() => {});
    await rm(join(instance, 'data'), { recursive: true, force: true }).catch(() => {});
  }
}

try {
  const control = await runOnce(controlApp, 'control-0.1.47');
  const candidate = await runOnce(candidateApp, 'candidate-0.1.48');
  const report = { time: new Date().toISOString(), scratch, control, candidate };
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  console.log('CONTROL', JSON.stringify(control));
  console.log('CANDIDATE', JSON.stringify(candidate));
  assert.ok(control.patchDisables === false, 'control build must not contain the disable entry');
  assert.ok(candidate.patchDisables === true, 'candidate build must contain the ui-permission disable entry');
  assert.ok(control.trigger, 'control must show the permission composer trigger');
  assert.deepEqual(control.menuLabels.sort(), ['仅可查看', '完全权限', '工作区内修改'], 'control menu must offer all three presets');
  assert.equal(candidate.trigger, null, 'candidate must not show the permission composer trigger');
  assert.deepEqual(candidate.menuLabels, [], 'candidate must not show any permission preset labels');
  console.log('PERMISSION-MENU-REMOVED OK');
} finally {
  await relay.close().catch(() => {});
}
