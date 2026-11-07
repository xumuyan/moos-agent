import { execFileSync } from 'node:child_process';
import { accessSync, constants, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

function executable(file) {
  try {
    const resolved = realpathSync(file);
    if (!statSync(resolved).isFile()) return;
    accessSync(resolved, constants.X_OK);
    return resolved;
  } catch { return undefined; }
}

function systemTool(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 2000, maxBuffer: 65536,
      env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}

function homebrewLibraries(git, files) {
  const libraries = new Set([git]);
  for (const library of libraries) {
    if (libraries.size > 32) break;
    for (const line of systemTool('/usr/bin/otool', ['-L', library]).split('\n')) {
      const path = line.trim().split(' (')[0];
      if (!/^\/opt\/homebrew\/(?:opt|Cellar)\/.+\.dylib$/.test(path)) continue;
      try {
        const resolved = realpathSync(path);
        if (/^\/opt\/homebrew\/Cellar\/[^/]+\/[^/]+\/lib\/.+\.dylib$/.test(resolved)) libraries.add(resolved);
      } catch { /* A missing or foreign library stays outside the sandbox. */ }
    }
  }
  for (const library of libraries) files.add(library);
}

function npmRoot(node, npm) {
  if (!node || !npm) return;
  const root = join(dirname(dirname(node)), 'lib/node_modules/npm');
  if (npm === join(root, 'bin/npm-cli.js') && !/[\x00-\x1f]/.test(root)) return root;
}

function localNodeBins() {
  const standard = ['/opt/homebrew/bin', '/usr/local/bin'];
  const nvm = join(homedir(), '.nvm');
  const installed = join(nvm, 'versions/node');
  let versions;
  try { versions = readdirSync(installed).filter(name => /^v\d+\.\d+\.\d+$/.test(name)); }
  catch { return standard; }
  versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  let selected;
  try {
    const defaultAlias = join(nvm, 'alias/default');
    const info = lstatSync(defaultAlias);
    const alias = info.isFile() && info.size < 256 ? readFileSync(defaultAlias, 'utf8').trim().replace(/^v/, '') : '';
    if (/^\d+(?:\.\d+){0,2}$/.test(alias)) selected = versions.find(version =>
      version === 'v' + alias || version.startsWith('v' + alias + '.'));
  } catch { /* A conventional installation without a default alias is still usable. */ }
  return [...standard, ...(selected ? [join(installed, selected, 'bin')] : []),
    ...versions.filter(version => version !== selected).map(version => join(installed, version, 'bin'))];
}

let cachedPath;
let cachedTools;

/** Read-only runtime paths for the shell's installed Git and npm. */
export function sandboxToolchain(path) {
  if (cachedTools && path === cachedPath) return cachedTools;
  const directories = (path || '/usr/bin:/bin:/usr/sbin:/sbin').split(delimiter);
  const find = name => {
    for (const directory of directories) {
      if (!isAbsolute(directory)) continue;
      const resolved = executable(join(directory, name));
      if (resolved) return resolved;
    }
  };
  const files = new Set();
  const roots = [];
  const node = find('node');
  const npm = find('npm');
  let root = npmRoot(node, npm);
  if (!node && !npm) {
    for (const directory of localNodeBins()) {
      root = npmRoot(executable(join(directory, 'node')), executable(join(directory, 'npm')));
      if (root) { directories.push(directory); break; }
    }
  }
  if (root) roots.push(root);
  const git = find('git');
  if (/^\/opt\/homebrew\/Cellar\/git\/[^/]+\/bin\/git$/.test(git ?? '')) homebrewLibraries(git, files);
  if (git === '/usr/bin/git') {
    const developer = systemTool('/usr/bin/xcode-select', ['-p']).trim();
    const direct = developer && executable(join(developer, 'usr/bin/git'));
    const systemGit = /^(?:\/Applications\/[^/]+\.app\/Contents\/Developer|\/Library\/Developer\/CommandLineTools)\/usr\/bin\/git$/;
    if (direct && systemGit.test(direct) && !/[\x00-\x1f]/.test(direct)) {
      files.add(direct);
      const index = directories.findIndex(directory => isAbsolute(directory) && executable(join(directory, 'git')) === git);
      if (index >= 0) directories.splice(index, 0, dirname(direct));
    }
  }
  cachedPath = path;
  cachedTools = { path: directories.join(delimiter), files: [...files], roots };
  return cachedTools;
}
