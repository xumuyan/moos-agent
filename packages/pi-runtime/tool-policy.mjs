import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createBashToolDefinition, createEditToolDefinition,
  createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { sandboxToolchain } from './toolchain.mjs';

const modes = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function canonicalTarget(path, allowMissing) {
  try { return await realpath(path); }
  catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    // realpath also reports ENOENT for a dangling symlink. Do not treat
    // such a link as a new file or a directory that can be created.
    const existing = await lstat(path).catch(cause => {
      if (cause.code !== 'ENOENT') throw cause;
    });
    if (existing || path === dirname(path)) throw error;
    return join(await canonicalTarget(dirname(path), true), basename(path));
  }
}

function within(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function seatbeltProfile(cwd, writable, tools) {
  if (process.platform !== 'darwin' || /[\x00-\x1f]/.test(cwd)) {
    throw new Error('当前平台没有可用的 PI 命令沙箱');
  }
  const roots = [cwd, '/System', '/usr', '/bin', '/sbin', '/Library/Apple', '/private/var/db/dyld', ...tools.roots];
  const ancestors = [];
  for (let parent = dirname(cwd); ; parent = dirname(parent)) {
    ancestors.push('(literal ' + JSON.stringify(parent) + ')');
    if (parent === dirname(parent)) break;
  }
  const toolFiles = tools.files.map(path => '(literal ' + JSON.stringify(path) + ')');
  return [
    '(version 1)', '(allow default)', '(deny network*)', '(deny appleevent-send)',
    '(deny file-read-data)', '(deny file-write*)',
    '(allow file-read-data (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom"))',
    '(allow file-read-data ' + [...ancestors, ...toolFiles].join(' ') + ')',
    `(allow file-read-data ${roots.map(path => '(subpath ' + JSON.stringify(path) + ')').join(' ')})`,
    '(allow file-write* (literal "/dev/null"))',
    ...(writable ? ['(allow file-write* (subpath ' + JSON.stringify(cwd) + '))'] : []),
  ].join(' ');
}

function shellEnvironment(env, cwd) {
  const allowed = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM'];
  const result = Object.fromEntries(allowed.filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  // Do not forward provider credentials, shell startup hooks or a real home
  // directory into model-controlled commands.
  return { ...result, HOME: cwd, TMPDIR: cwd };
}

/** Apply the current desktop permission at the boundary of each PI tool call. */
export function workspaceTools(cwd, { getMode, approve }) {
  function mode() {
    const value = getMode();
    if (!modes.has(value)) throw new Error('无法确定当前会话的 PI 执行权限');
    return value;
  }

  function pathTool(definition, { mutates = false, optionalPath = false } = {}) {
    return { ...definition, async execute(id, input, signal, ...rest) {
      const current = mode();
      if (current === 'danger-full-access') return definition.execute(id, input, signal, ...rest);
      if (mutates && current === 'read-only') throw new Error('当前会话为只读，未修改文件');
      const path = input.path ?? (optionalPath ? '.' : undefined);
      if (typeof path !== 'string' || !path || path.startsWith('~')) throw new Error('请输入项目内的文件路径');
      const target = await canonicalTarget(resolve(cwd, path), definition.name === 'write');
      if (!within(cwd, target)) throw new Error('当前权限只允许访问工作区内的路径');
      const status = await lstat(target).catch(error => {
        if (definition.name !== 'write' || error.code !== 'ENOENT') throw error;
      });
      if (status && (!status.isDirectory() && !status.isFile() || status.isFile() && status.nlink > 1)) {
        throw new Error('当前权限拒绝访问特殊文件或硬链接');
      }
      signal?.throwIfAborted();
      return definition.execute(id, { ...input, path: target }, signal, ...rest);
    } };
  }

  const bash = createBashToolDefinition(cwd, {
    exposeSessionEnvironment: false,
    spawnHook({ command, env }) {
      const current = mode();
      const environment = shellEnvironment(env, cwd);
      if (current === 'danger-full-access') return { command, cwd, env: environment };
      const toolchain = sandboxToolchain(environment.PATH);
      const effectiveCommand = 'exec /usr/bin/sandbox-exec -p ' + shellQuote(seatbeltProfile(cwd, current === 'workspace-write', toolchain))
        + ' /bin/bash --noprofile --norc -c ' + shellQuote(command);
      return { command: effectiveCommand, cwd, env: { ...environment, PATH: toolchain.path,
        GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0',
        npm_config_logs_max: '0', npm_config_update_notifier: 'false',
        NODE_DISABLE_COMPILE_CACHE: '1',
      } };
    },
  });
  const tools = [
    pathTool(createReadToolDefinition(cwd)),
    pathTool(createWriteToolDefinition(cwd), { mutates: true }),
    pathTool(createEditToolDefinition(cwd), { mutates: true }),
    pathTool(createLsToolDefinition(cwd, { operations: {
      exists: path => lstat(path).then(() => true, () => false),
      stat: lstat,
      readdir,
    } }), { optionalPath: true }),
    // PI's native grep/find may install and launch helpers outside this
    // boundary. Use the system search utilities through the confined shell.
    bash,
  ];
  if (typeof approve === 'function') {
    const escalated = createBashToolDefinition(cwd, {
      exposeSessionEnvironment: false,
      spawnHook: ({ command, env }) => ({ command, cwd, env: shellEnvironment(env, cwd) }),
    });
    tools.push({
      ...escalated, name: 'bash_escalated', label: '经批准运行命令',
      description: 'Request one-time approval to run a shell command outside workspace or network restrictions.',
      promptSnippet: 'Request one-time approval for a command requiring external files or network access',
      promptGuidelines: ['Use bash first for commands that can run within the current permission.'],
      async execute(id, input, signal, ...rest) {
        signal?.throwIfAborted();
        const before = mode();
        if (await approve({ id, command: input.command, signal }) !== 'allowed-once' || before !== mode()) {
          throw new Error('命令未获得本次授权');
        }
        signal?.throwIfAborted();
        return escalated.execute(id, input, signal, ...rest);
      },
    });
  }
  return tools;
}
