// View-only runner. No Host/PI or production data. Uses native NSH macOS development host, never web.
import { mkdtemp, mkdir, cp, writeFile , readFile } from 'node:fs/promises';
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
const capture = process.argv.includes('--capture') || evidence, native = process.argv.includes('--native') || capture || rich;
const files = ['DesktopView.tsx', 'desktop-theme.ts', 'desktop-theme-layers.tsx', 'desktop-theme-art.ts', 'desktop-theme-fixture.ts', 'desktop-style-assert.ts', 'desktop-ui-controller.ts', 'desktop-ui-transport.ts', 'desktop-contract.ts',
  ...(!native ? ['desktop-theme.test.tsx', 'DesktopApp.test.tsx'] : [])];
for (const file of files) await cp(resolve('probes/nsh-validation', file), join(source, file));
await cp(resolve('probes/nsh-validation/assets/desktop'), join(source, 'assets/desktop'), { recursive: true });
// Explicit local-only artwork opt-in. No default production HOME or downloads.
const artRoot = parseArtRoot(process.argv.slice(2));
const artwork = artRoot !== null;
if (artwork) await prepareArtwork(artRoot, source, JSON.parse(await readFile(resolve('probes/nsh-validation/skin-source.json'), 'utf8')));
// Self-contained mount entry: do not adopt pre-existing untracked DesktopApp/Host/UI integration.
await writeFile(join(source, 'DesktopApp.tsx'), "import { mount } from 'nsh';\nimport { DesktopView } from './DesktopView';\nmount(DesktopView);\n");
if (native) await cp(resolve('probes/nsh-validation', rich ? 'desktop-theme-rich-check.tsx' : evidence ? 'desktop-style-capture.tsx' : capture ? 'desktop-theme-capture.tsx' : 'desktop-theme-native-check.tsx'), join(source, 'native.test.tsx'));
await writeFile(join(source, 'nsh.json'), JSON.stringify({ name: '沐码主题视图测试夹具', id: 'dev.muma.probe.nsh.theme', capabilities: { host: ['projects.list','sessions.list','sessions.create','tasks.submit','tasks.events','tasks.cancel'] }, window: { title: 'NSH 原生主题验证 · 合成响应 · 非实际任务', defaultSize: { width: 1240, height: 820 } } }));
await writeFile(join(source, 'App.tsx'), "import './DesktopApp';\n");
await cp(resolve('probes/nsh-validation/tsconfig.json'), join(source, 'tsconfig.json'));
for (const [entry, options] of [['ThemeNative', {}], ['ThemeError', { error: true }], ['ThemeLong', { long: true }]]) {
  await writeFile(join(source, `${entry}.tsx`), `import { mount } from 'nsh';\nimport { DesktopView } from './DesktopView';\nimport { fixture } from './desktop-theme-fixture';\nconst h = fixture(${JSON.stringify(options)});\nmount(() => <DesktopView call={async (method, params) => (h as any)[method](params).result} />);\n`);
}
// Isolated layout diagnostic only: no Host bridge, filesystem or production data.
await writeFile(join(source, 'ThemeGeometry.tsx'), `import { mount, signal, View, Text } from 'nsh';
import { DesktopView } from './DesktopView';
import { fixture } from './desktop-theme-fixture';
const h = fixture(); const measured = signal<Record<string, any>>({});
mount(() => <View style={{flex:1}}><DesktopView call={async (method, params) => (h as any)[method](params).result}
 onGeometry={(name, bounds) => { if (JSON.stringify(measured()[name]) !== JSON.stringify(bounds)) measured.set({...measured(), [name]: bounds}); }} />
<Text testID="geometry-readout" style={{position:'absolute',top:0,left:0,opacity:0,pointerEvents:'none',fontSize:1}}>{'STYLE_GEOMETRY ' + JSON.stringify(measured())}</Text></View>);
`);
await writeFile(join(source, 'ThemeRich.tsx'), `import { mount } from 'nsh';
import { DesktopView } from './DesktopView';
import { fixture } from './desktop-theme-fixture';
const h = fixture();
mount(() => <DesktopView call={async (method, params) => {
 const result = (h as any)[method](params).result;
 if (method === 'tasks.events') for (const e of result.events) if (e.type === 'text_delta') e.payload.delta = ${JSON.stringify('## 合成 Markdown 长文\n\n' + '长中文边界验证，不是实际用户任务。'.repeat(35) + '\n\n`/isolated/' + 'very-long-segment/'.repeat(30) + 'fixture.txt`\n\n```ts\nconst example = "synthetic";\n```')};
 return result;
}} />);
`);
console.log(dir);
try {
  for (const args of [['check', source], ['test', source, ...(native ? ['--target', 'macos', '--display', '1'] : [])]]) {
    const child = spawnSync(nsh, args, { cwd: dir, timeout: 120000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const out = (child.stdout ?? '') + (child.stderr ?? '');
    await writeFile(join(dir, `${args[0]}.log`), out); console.log(out);
    assert.equal(child.error, undefined); assert.equal(child.status, 0, `${args[0]} failed: see ${dir}/${args[0]}.log`);
  }
  await writeFile(join(dir, 'result.json'), JSON.stringify({ passed: true, platform: native ? 'NSH 0.5.0 macOS development host' : 'headless', fixture: 'synthetic bridge responses; no PI task executed', capture, evidence, artwork, installed: false, files, generatedEntry: true, outerFrame: 'logged by STYLE_FRAME for --evidence; PNG is content only', display: native ? 1 : null }, null, 2));
} catch (e) {
  await writeFile(join(dir, 'failure.log'), `${e}\n${e.stdout ?? ''}\n${e.stderr ?? ''}`); throw e;
}
