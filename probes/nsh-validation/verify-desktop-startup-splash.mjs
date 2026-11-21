import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareStartupClips } from './desktop-startup-clips.mjs';

const probe = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(probe, '../../artifacts/nsh-validation');
const nsh = join(artifacts, 'toolchain/nsh/bin/nsh');
const tsc = join(homedir(), 'Library/Caches/nsh/typescript-7.0.2-darwin-arm64/package/lib/tsc');
const dir = await mkdtemp(join(artifacts, 'startup-splash-test.'));
const ui = join(dir, 'ui');
const clips = join(dir, 'clips');
await mkdir(clips);
await mkdir(join(ui, 'assets/desktop'), { recursive: true });
console.log(`Evidence directory: ${dir}`);
const run = (exe, args) => execFileSync(exe, args, { cwd: ui, stdio: 'inherit', timeout: 120_000 });
run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=2.8',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(clips, 'synthetic.mp4')]);
for (const file of ['DesktopStartupSplash.tsx', 'desktop-startup-splash.test.tsx', 'desktop-theme.ts', 'desktop-contract.ts', 'tsconfig.json', 'assets/desktop/sidebar-icon.png']) {
  await copyFile(join(probe, file), join(ui, file));
}
await prepareStartupClips(ui, clips);
await writeFile(join(ui, 'nsh.json'), JSON.stringify({ name: 'Moos Splash Test', id: 'dev.muma.probe.startup.test', version: '1.0.0', build: 1 }));
const entry = clipList => `import { keymap, mount, signal, Text, View } from 'nsh';
import { Button } from 'nsh/base';
import { DesktopStartupSplash } from './DesktopStartupSplash';
import { startupClips } from './startup-clips';

mount(() => {
  const escaped = signal(0);
  const clicked = signal(false);
  keymap.bind('escape', () => escaped.set(escaped() + 1), { when: 'always' });
  return <View style={{ flex: 1 }}>
    <Button testID="workspace-action" onPress={() => clicked.set(true)}><Text>{clicked() ? 'Clicked' : 'Workspace'}</Text></Button>
    <Text>{'Escape ' + escaped()}</Text>
    <DesktopStartupSplash clips={${clipList}} />
  </View>;
});`;
await writeFile(join(ui, 'App.tsx'), entry('[]'));
await writeFile(join(ui, 'Video.tsx'), entry('startupClips'));
run(nsh, ['check', '.', '--tsc', tsc]);
run(nsh, ['test', '.', '--target', 'macos', '--display', '1']);
