import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

export function parseBootstrap(line) {
  const match = /^dsh web: (https?:\/\/\S+)$/.exec(line.trim());
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    const token = url.searchParams.get('token');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.port === '0'
      || url.pathname !== '/' || url.username || url.password || url.hash
      || url.searchParams.size !== 1 || !/^[a-zA-Z0-9_-]{24,128}$/.test(token ?? '')) return null;
    return url;
  } catch { return null; }
}

export function startHost({ cli, home, cwd, tempDir, executionPatch, piRuntime, piFixture, onUnexpectedExit, timeoutMs = 30000 }) {
  const env = {
    ...process.env,
    ...(tempDir && { TMPDIR: tempDir }),
    DSH_HOME: home,
    DSH_SKINS_HOME: `${home}/skins`,
    DSH_SKINS_DIR: `${home}/skins`,
    DSH_TELEMETRY_DISABLED: '1',
    PI_OFFLINE: '1',
    MOOS_ELECTRON_WORKSPACE_ROOT: cwd,
    MOOS_ELECTRON_PARENT_PIPE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.MOOS_ELECTRON_PI_RUNTIME;
  delete env.MOOS_ELECTRON_PI_FIXTURE_MODE;
  const patches = ['--patch', executionPatch];
  if (piRuntime) env.MOOS_ELECTRON_PI_RUNTIME = piRuntime;
  if (piFixture) {
    env.MOOS_ELECTRON_PI_RUNTIME = piFixture;
    env.MOOS_ELECTRON_PI_FIXTURE_MODE = '1';
    patches.push('--patch', join(piFixture, 'profile.patch.yml'));
  }
  const child = spawn(cli, ['web', ...patches, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd, env, detached: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const output = createInterface({ input: child.stdout });
  let stopping = false;
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  child.once('close', () => { output.close(); resolveExit(); });
  const ready = new Promise((resolve, reject) => {
    let started = false;
    const timer = setTimeout(() => reject(new Error('沐码本机服务 启动超时')), timeoutMs);
    output.on('line', line => {
      if (started) return;
      const address = parseBootstrap(line);
      if (!address) return;
      started = true;
      clearTimeout(timer);
      resolve(address);
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('无法启动 沐码本机服务'));
    });
    child.once('close', () => {
      clearTimeout(timer);
      if (!started) reject(new Error('沐码本机服务 启动失败'));
      else if (!stopping) onUnexpectedExit?.();
    });
  });

  function signalGroup(signal) {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }

  let stopPromise;
  const stop = () => {
    if (!stopPromise) {
      stopping = true;
      signalGroup('SIGTERM');
      const timer = setTimeout(() => signalGroup('SIGKILL'), 2000);
      stopPromise = exited.finally(() => clearTimeout(timer));
    }
    return stopPromise;
  };
  return { ready, stop };
}
