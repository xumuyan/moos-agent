import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyNavigation } from './link-handler.mjs';

const APP = 'http://127.0.0.1:5174'; // local DSH workspace server origin

test('chat links to other local servers open in the system browser', () => {
  const a = classifyNavigation('http://127.0.0.1:5173/', APP);
  assert.equal(a.type, 'open-external');
  assert.equal(a.href, 'http://127.0.0.1:5173/');
});

test('localhost and LAN http/https links open externally', () => {
  assert.equal(classifyNavigation('http://localhost:3000/app', APP).type, 'open-external');
  assert.equal(classifyNavigation('https://example.com/docs', APP).type, 'open-external');
  assert.equal(classifyNavigation('http://192.168.1.20:8080/', APP).type, 'open-external');
});

test('same-origin navigation stays inside the workspace window', () => {
  const a = classifyNavigation('http://127.0.0.1:5174/settings/models', APP);
  assert.equal(a.type, 'allow');
});

test('different port is a different origin and opens externally', () => {
  assert.equal(classifyNavigation('http://127.0.0.1:5173/', 'http://127.0.0.1:5173').type, 'allow');
  assert.equal(classifyNavigation('http://127.0.0.1:9999/', 'http://127.0.0.1:5173').type, 'open-external');
});

test('dangerous or unknown schemes are denied, never opened', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'about:blank', 'data:text/html,x', 'ssh://host']) {
    assert.equal(classifyNavigation(url, APP).type, 'deny', url);
  }
});

test('malformed targets are denied', () => {
  assert.equal(classifyNavigation('not a url', APP).type, 'deny');
  assert.equal(classifyNavigation('', APP).type, 'deny');
  assert.equal(classifyNavigation(undefined, APP).type, 'deny');
});

test('main.mjs wires both window-open and navigation to the classifier + shell', async () => {
  const code = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
  assert.match(code, /import \{[^}]*shell[^}]*\} from 'electron'/);
  assert.match(code, /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*?classifyNavigation\(url, address\.origin\)[\s\S]*?shell\.openExternal[\s\S]*?action: 'deny'/);
  assert.match(code, /will-navigate[\s\S]*?preventRemoteNavigation/);
  assert.match(code, /will-redirect[\s\S]*?preventRemoteNavigation/);
  // still no in-app secondary windows
  assert.doesNotMatch(code, /action: 'allow'|action: 'deny-and-allow'/);
});
