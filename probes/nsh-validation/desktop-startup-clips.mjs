import { copyFile, lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const maxClips = 8;
const maxBytes = 20 * 1024 * 1024;

export function startupClipArguments(args) {
  const index = args.indexOf('--splash-root');
  if (index === -1) return { remaining: args };
  const root = args[index + 1];
  if (!root || root.startsWith('--') || args.lastIndexOf('--splash-root') !== index) throw Error('Expected one splash clip directory');
  return { root, remaining: [...args.slice(0, index), ...args.slice(index + 2)] };
}

export async function prepareStartupClips(ui, root) {
  const imports = [];
  if (root) {
    if (!(await lstat(root)).isDirectory()) throw Error('Splash clip source must be a directory');
    const clips = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!clips.length || clips.length > maxClips) throw Error('Expected 1–8 local MP4 clips');
    const folder = join(ui, 'assets', 'startup');
    await mkdir(folder, { recursive: true });
    for (const [index, clip] of clips.entries()) {
      const from = join(root, clip.name);
      const status = await lstat(from);
      if (!status.isFile() || !status.size || status.size > maxBytes) throw Error('Invalid splash MP4 size');
      const name = `clip-${index}.mp4`;
      await copyFile(from, join(folder, name));
      imports.push(`import clip${index} from './assets/startup/${name}';`);
    }
  }
  const sources = imports.map((_, index) => `clip${index}`);
  await writeFile(join(ui, 'startup-clips.ts'), [...imports, `export const startupClips: readonly string[] = [${sources.join(', ')}];`, ''].join('\n'));
  return imports.length;
}

export const interactiveDesktopEntry = `import { mount, View } from 'nsh';
import { DesktopView } from './DesktopView';
import { DesktopStartupSplash } from './DesktopStartupSplash';
import { startupClips } from './startup-clips';

mount(() => <View style={{ flex: 1 }}>
  <DesktopView persistentHistory />
  <DesktopStartupSplash clips={startupClips} />
</View>);
`;
