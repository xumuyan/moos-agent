// Build-time opt-in only. Never executed by the view or default production HOME.
import assert from 'node:assert/strict';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
export const artNames = ['icon','maid-left','maid-right','palace-day','palace-night','bottom-crest','bottom-trim','bow','chibi','composer-frame','new-session','settings-frame','sidebar-corner','sidebar-swag','top-trim','workspace-ribbon','workspace-shield'];
// Bind semantic names to paths, never to the order of a source JSON array.
export const artPaths = ['maid-atelier-icon.webp','maid-atelier-maid-left-v5.webp','maid-atelier-maid-right-v6.webp','maid-atelier-palace-day-v4.webp','maid-atelier-palace-night-v4.webp','maid-bottom-crest-v1.webp','maid-bottom-trim-tile-v1.webp','maid-bow-v1.webp','maid-chibi-v1.webp','maid-composer-frame-v4.webp','maid-new-session-v1.webp','maid-settings-frame-v1.webp','maid-sidebar-corner-v1.webp','maid-sidebar-swag-v1.webp','maid-top-trim-tile-v1.webp','maid-workspace-ribbon-v2.webp','maid-workspace-shield-v2.webp'];
export function parseArtRoot(args) {
  const indices = args.flatMap((x, i) => x === '--art-root' ? [i] : []);
  assert.ok(indices.length <= 1, 'duplicate --art-root');
  if (!indices.length) return null;
  const value = args[indices[0] + 1];
  assert.ok(value && !value.startsWith('--'), 'missing --art-root');
  return value;
}
export async function prepareArtwork(rootPath, source, facts) {
  const root = await realpath(rootPath);
  assert.equal(facts.assets.length, artNames.length, 'unexpected asset count');
  const checked = [];
  for (const [i, name] of artNames.entries()) {
    const asset = facts.assets.find(a => basename(a.path) === artPaths[i]);
    assert.ok(asset, `missing known art: ${name}`);
    const file = await realpath(join(root, asset.path));
    const rel = relative(root, file);
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'asset escapes skin root');
    const bytes = await readFile(file);
    assert.equal(bytes.length, asset.bytes, `size mismatch: ${asset.path}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `hash mismatch: ${asset.path}`);
    checked.push({ name, filename: basename(file), bytes });
  }
  // Validate every file before writing any art to the isolated preview.
  await mkdir(join(source, 'assets/local-art'), { recursive: true });
  const imports = [], entries = [];
  for (const [i, item] of checked.entries()) {
    await writeFile(join(source, 'assets/local-art', item.filename), item.bytes);
    imports.push(`import art${i} from './assets/local-art/${item.filename}';`);
    entries.push(`${JSON.stringify(item.name)}: art${i}`);
  }
  await writeFile(join(source, 'desktop-theme-art.ts'), `import type { ImageAsset } from 'nsh';\n${imports.join('\n')}\nexport const art: Record<string, ImageAsset | undefined> = {${entries.join(',')}};\nexport const artAvailable = true;\n`);
}
