// View-only runner. No Host/PI or production data. Uses native NSH macOS development host, never web.
import { mkdtemp, mkdir, cp, writeFile , readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { parseArtRoot, prepareArtwork } from './desktop-theme-assets.mjs';
process.umask(0o077);
assert.ok(tmpdir().startsWith('/private/tmp/n01-'), 'Set TMPDIR to a dedicated 0700 /private/tmp/n01-* directory');
const nsh = resolve('artifacts/nsh-validation/toolchain/nsh/bin/nsh');
assert.equal(execFileSync(nsh, ['--version'], { encoding: 'utf8' }).trim(), 'nsh 0.5.0 (f4d68f7)');
const base = resolve('artifacts/nsh-validation/desktop-theme'); await mkdir(base, { recursive: true });
const dir = await mkdtemp(join(base, 'run-')); const source = join(dir, 'source'); await mkdir(source);
const evidence = process.argv.includes('--evidence');
const rich = process.argv.includes('--rich');
const live = process.argv.includes('--live-sidebar');
const typography = process.argv.includes('--typography');
const activity = process.argv.includes('--sidebar-activity');
const chrome = process.argv.includes('--window-chrome');
const cards = process.argv.includes('--chat-cards');
const icons = process.argv.includes('--icons');
const composer = process.argv.includes('--composer');
const capture = process.argv.includes('--capture') || evidence || typography || chrome || activity || cards || icons || composer, native = process.argv.includes('--native') || capture || rich || live;
const nativeCheck = composer ? 'desktop-composer-check.tsx' : icons ? 'desktop-icons-check.tsx' : cards ? 'desktop-chat-cards-check.tsx' : activity ? 'desktop-sidebar-activity-check.tsx' : chrome ? 'desktop-window-chrome-check.tsx' : typography ? 'desktop-typography-check.tsx' : live ? 'desktop-live-sidebar-check.tsx' : rich ? 'desktop-theme-rich-check.tsx' : evidence ? 'desktop-style-capture.tsx' : capture ? 'desktop-theme-capture.tsx' : 'desktop-theme-native-check.tsx';
const files = ['DesktopView.tsx', 'DesktopIcon.tsx', 'desktop-icon-paths.ts', 'DSH-ICONS-LICENSE.txt', 'desktop-sidebar-footer.ts', 'desktop-sidebar-tree.ts', 'desktop-live-sidebar.ts', 'desktop-theme.ts', 'desktop-theme-layers.tsx', 'desktop-theme-art.ts', 'desktop-theme-fixture.ts', 'desktop-style-assert.ts', 'desktop-ui-controller.ts', 'desktop-ui-transport.ts', 'desktop-contract.ts',
  ...(!native ? ['desktop-theme.test.tsx', 'DesktopApp.test.tsx'] : [])];
for (const file of files) await cp(resolve('probes/nsh-validation', file), join(source, file));
await cp(resolve('probes/nsh-validation/assets/desktop'), join(source, 'assets/desktop'), { recursive: true });
// Explicit local-only artwork opt-in. No default production HOME or downloads.
const artRoot = parseArtRoot(process.argv.slice(2));
const artwork = artRoot !== null;
if (artwork) await prepareArtwork(artRoot, source, JSON.parse(await readFile(resolve('probes/nsh-validation/skin-source.json'), 'utf8')));
// Self-contained mount entry: do not adopt pre-existing untracked DesktopApp/Host/UI integration.
await writeFile(join(source, 'DesktopApp.tsx'), "import { mount } from 'nsh';\nimport { DesktopView } from './DesktopView';\nmount(DesktopView);\n");
if (native) await cp(resolve('probes/nsh-validation', nativeCheck), join(source, 'native.test.tsx'));
await writeFile(join(source, 'nsh.json'), JSON.stringify({ name: '沐码主题视图测试夹具', id: 'dev.muma.probe.nsh.theme', capabilities: { host: ['projects.list','sessions.list','sessions.create','tasks.submit','tasks.events','tasks.cancel'] }, window: { title: 'NSH 原生主题验证 · 合成响应 · 非实际任务', defaultSize: { width: 1240, height: 820 } } }));
await writeFile(join(source, 'App.tsx'), "import './DesktopApp';\n");
await cp(resolve('probes/nsh-validation/tsconfig.json'), join(source, 'tsconfig.json'));
for (const [entry, options] of [['ThemeNative', {}], ['ThemeError', { error: true }], ['ThemeLong', { long: true }], ['ThemeNames', { longNames: true }], ['ThemeDense', { dense: true }]]) {
  await writeFile(join(source, `${entry}.tsx`), `import { mount } from 'nsh';\nimport { DesktopView } from './DesktopView';\nimport { fixture } from './desktop-theme-fixture';\nconst h = fixture(${JSON.stringify(options)});\nmount(() => <DesktopView call={async (method, params) => (h as any)[method](params).result} />);\n`);
}
// Isolated layout diagnostic only: no Host bridge, filesystem or production data.
await writeFile(join(source, 'ThemeGeometry.tsx'), `import { mount, signal, View, Text } from 'nsh';
${chrome ? "import { currentWindow } from 'nsh/desktop';" : ''}
import { DesktopView } from './DesktopView';
import { fixture } from './desktop-theme-fixture';
const h = fixture(${cards || icons ? '{ chatCards: true }' : ''}); const measured = signal<Record<string, any>>({});
mount(() => {
${chrome ? `  const window = currentWindow();
  const closeReason = signal('');
  // Keep the test driver alive after the last-window close request. Never set this in DesktopView.
  window.set({closeOnPress: false});
  window.on('closePress', e => closeReason.set(e.reason));` : ''}
  return <View style={{flex:1}}><DesktopView call={async (method, params) => (h as any)[method](params).result}
   onGeometry={(name, bounds) => { if (JSON.stringify(measured()[name]) !== JSON.stringify(bounds)) measured.set({...measured(), [name]: bounds}); }} />
  <Text testID="geometry-readout" style={{position:'absolute',top:0,left:0,opacity:0,pointerEvents:'none',fontSize:1}}>{'STYLE_GEOMETRY ' + JSON.stringify(measured())}</Text>
  ${chrome ? `<Text style={{position:'absolute',top:0,left:0,opacity:0,pointerEvents:'none',fontSize:1}}>{'WINDOW_CHROME ' + JSON.stringify(window.titleBar())}</Text>
  <Text style={{position:'absolute',top:0,left:0,opacity:0,pointerEvents:'none',fontSize:1}}>{'CHROME_CLOSE ' + closeReason()}</Text>` : ''}</View>;
});
`);
await writeFile(join(source, 'ThemeRich.tsx'), `import { mount, signal, View, Text } from 'nsh';
import { DesktopView } from './DesktopView';
import { fixture } from './desktop-theme-fixture';
const h = fixture();
const metrics = signal<any>({});
mount(() => <View style={{flex:1}}><DesktopView onMessageScroll={e => metrics.set({...metrics(), scroll:e})} onGeometry={(name, bounds) => { if (JSON.stringify(metrics()[name]) !== JSON.stringify(bounds)) metrics.set({...metrics(), [name]:bounds}); }} call={async (method, params) => {
 const result = (h as any)[method](params).result;
 if (method === 'tasks.events') for (const e of result.events) if (e.type === 'text_delta') e.payload.delta = ${JSON.stringify('## 合成 Markdown 长文\n\n' + '长中文边界验证，不是实际用户任务。'.repeat(35) + '\n\n`/isolated/' + 'very-long-segment/'.repeat(30) + 'fixture.txt`\n\n```ts\nconst example = "synthetic";\n```')};
 return result;
}} /><Text style={{position:'absolute',opacity:0,pointerEvents:'none',fontSize:1}}>{'RICH_METRICS ' + JSON.stringify(metrics())}</Text></View>);
`);
if (typography) await writeFile(join(source, 'ThemeTypography.tsx'), `import { mount, signal, View, Text } from 'nsh';
import { DesktopView } from './DesktopView';
import { fixture } from './desktop-theme-fixture';
const h = fixture();
const measured = signal<Record<string, any>>({});
mount(() => <View style={{flex:1}}><DesktopView onGeometry={(name, bounds) => {
  if (JSON.stringify(measured()[name]) !== JSON.stringify(bounds)) measured.set({...measured(), [name]: bounds});
}} call={async (method, params) => {
  const result = (h as any)[method](params).result;
  if (method === 'sessions.list') {
    result.sessions[0].title = 'Maid Atelier · 合成会话';
    result.sessions[1].title = '很长的会话标题用于验证截断'.repeat(6) + ' · Maid Atelier';
  }
  if (method === 'tasks.events') for (const e of result.events) if (e.type === 'text_delta') e.payload.delta = ${JSON.stringify('## 排版验证 Typography\n\n中文正文、英文 Body、数字 012345 与 `file_01.ts`。\n\n```ts\nconst WMWM = "路径";\nconst iiii = "样例";\n```')};
  return result;
}} /><Text style={{position:'absolute',opacity:0,pointerEvents:'none',fontSize:1}}>{'TYPE_GEOMETRY ' + JSON.stringify(measured())}</Text></View>);
`);
// Hash the exact copied/generated pre-build inputs; do not rely on HEAD alone.
async function hashTree(root, prefix = '') {
  const records = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(records, await hashTree(root, name));
    else if (entry.isFile()) {
      const bytes = await readFile(join(root, name));
      records[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    } else throw Error('Unexpected non-file capture input: ' + name);
  }
  return records;
}
const workspaceInputs = [...files, 'verify-desktop-theme.mjs', 'desktop-theme-assets.mjs', 'skin-source.json', 'tsconfig.json', ...(native ? [nativeCheck] : [])];
const workspaceHashes = {};
for (const name of workspaceInputs) {
  const bytes = await readFile(resolve('probes/nsh-validation', name));
  workspaceHashes[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const provenance = { head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  status: execFileSync('git', ['status', '--short'], {encoding:'utf8'}), capturedAt: new Date().toISOString(),
  nsh: execFileSync(nsh, ['--version'], {encoding:'utf8'}).trim(), node: process.version,
  system: execFileSync('/usr/bin/sw_vers', [], {encoding:'utf8'}), arch: process.arch,
  synthetic: true, piExecuted: false, workspaceHashes, sourceHashes: await hashTree(source) };
await writeFile(join(dir, 'capture-inputs.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(dir);
try {
  for (const args of [['check', source], ['test', source, ...(native ? ['--target', 'macos', '--display', '1'] : [])]]) {
    const child = spawnSync(nsh, args, { cwd: dir, timeout: 120000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const out = (child.stdout ?? '') + (child.stderr ?? '');
    await writeFile(join(dir, `${args[0]}.log`), out); console.log(out);
    assert.equal(child.error, undefined); assert.equal(child.status, 0, `${args[0]} failed: see ${dir}/${args[0]}.log`);
  }
  for (const [name, expected] of Object.entries(provenance.sourceHashes)) {
    const bytes = await readFile(join(source, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, 'Capture input mutated: ' + name);
  }
  for (const [name, expected] of Object.entries(workspaceHashes)) {
    const bytes = await readFile(resolve('probes/nsh-validation', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, 'Workspace input changed during capture: ' + name);
  }
  await writeFile(join(dir, 'result.json'), JSON.stringify({ passed: true, platform: native ? 'NSH 0.5.0 macOS development host' : 'headless', fixture: 'synthetic bridge responses; no PI task executed', capture, evidence, artwork, installed: false, files, generatedEntry: true, outerFrame: 'logged by STYLE_FRAME for --evidence and CHROME_FRAME for --window-chrome; PNG is content only', display: native ? 1 : null }, null, 2));
} catch (e) {
  await writeFile(join(dir, 'failure.log'), `${e}\n${e.stdout ?? ''}\n${e.stderr ?? ''}`); throw e;
}
