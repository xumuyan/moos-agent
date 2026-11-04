import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function view(invoke) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { disabled: false, hidden: id === 'capture',
      textContent: '', addEventListener(event, callback) { this[event] = callback; } });
    return elements.get(id);
  };
  const script = await readFile('probes/m01/desktop/web/probe.js', 'utf8');
  vm.runInNewContext(script, { document: { getElementById: get },
    window: { __TAURI__: { core: { invoke } } } });
  await Promise.resolve();
  return get;
}

test('desktop UI does not claim success or show a screenshot when permission is blocked', async () => {
  const calls = [];
  const get = await view(async name => {
    calls.push(name);
    return name === 'run_browser_probe' ? { status: 'blocked', reason: 'system-permission-required' }
      : { screenCaptureGranted: false, accessibilityGranted: false };
  });
  await get('browser').click();
  assert.match(get('browser-status').textContent, /先授权/);
  assert.equal(get('capture').hidden, true);
  assert(!calls.includes('request_desktop_permission'), 'permission requests must be explicit');
});

test('desktop UI displays only a verified successful screenshot and supports cancellation', async () => {
  const get = await view(async name => name === 'run_browser_probe'
    ? { status: 'passed', imageDataUrl: 'data:image/png;base64,fixture' } : {});
  await get('browser').click();
  assert.match(get('browser-status').textContent, /验证通过/);
  assert.equal(get('capture').hidden, false);
  let finish;
  const cancelled = await view(async name => {
    if (name === 'run_browser_probe') return new Promise(resolve => { finish = resolve; });
    if (name === 'stop_browser_probe') { finish({ status: 'cancelled' }); return true; }
    return {};
  });
  const pending = cancelled('browser').click();
  await cancelled('stop').click();
  await pending;
  assert.match(cancelled('browser-status').textContent, /已停止/);
  assert.equal(cancelled('stop').disabled, true);
});

test('each permission button sends its own explicit permission kind', async () => {
  const requested = [];
  const get = await view(async (name, args) => {
    if (name === 'request_desktop_permission') requested.push(args.kind);
    return {};
  });
  assert.deepEqual(requested, []);
  await get('screen').click();
  await get('accessibility').click();
  assert.deepEqual(requested, ['screen', 'accessibility']);
});

test('revoking either permission hides old success and reauthorization permits a new verified run', async () => {
  for (const permission of ['screenCaptureGranted', 'accessibilityGranted']) {
    const state = { screenCaptureGranted: true, accessibilityGranted: true };
    const requests = [];
    const get = await view(async (name) => {
      requests.push(name);
      if (name === 'run_browser_probe') {
        return state.screenCaptureGranted && state.accessibilityGranted
          ? { status: 'passed', imageDataUrl: 'data:image/png;base64,new-capture' }
          : { status: 'blocked', reason: 'system-permission-required' };
      }
      return { ...state };
    });
    await get('browser').click();
    assert.equal(get('capture').hidden, false);
    state[permission] = false;
    await get('browser').click();
    assert.equal(get('capture').hidden, true, 'an earlier screenshot must not look like the blocked run succeeded');
    assert.match(get('browser-status').textContent, /先授权/);
    assert.match(get('permissions').textContent, /未授权/);
    assert.equal(get('browser').disabled, false);
    assert.equal(get('stop').disabled, true);
    state[permission] = true;
    await get('refresh').click();
    assert(!get('permissions').textContent.includes('未授权'));
    await get('browser').click();
    assert.match(get('browser-status').textContent, /验证通过/);
    assert.equal(get('capture').hidden, false);
    assert(!requests.includes('request_desktop_permission'), 'restoration must remain a user system action');
  }
});
