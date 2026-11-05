import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createController } from './controller.mjs';
import { runPi } from '../../packages/pi-adapter/index.mjs';

const directoryArg = process.argv.find(argument => argument.startsWith('--data-dir='));
const dataDir = directoryArg?.slice('--data-dir='.length) || process.env.MOOS_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'dev.moos.agent');
const controller = await createController({ dataDir, run: runPi });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let shuttingDown;
async function shutdown() {
  if (!shuttingDown) shuttingDown = controller.close();
  await shuttingDown;
}
const parent = process.ppid;
const watchdog = setInterval(() => {
  if (process.ppid !== parent) void shutdown().finally(() => process.exit(0));
}, 500);
watchdog.unref();
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void shutdown().finally(() => process.exit(0)));
input.on('line', async line => {
  let id;
  try {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('请求过大');
    const request = JSON.parse(line);
    id = request.id;
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('无效请求标识');
    if (request.method === 'shutdown') {
      await shutdown();
      process.stdout.write(JSON.stringify({ id, result: { stopped: true } }) + '\n', () => process.exit(0));
      return;
    }
    const result = await controller.request(request.method, request.params);
    process.stdout.write(JSON.stringify({ id, result }) + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ id, error: '请求未完成，请检查项目、模型配置和任务状态' }) + '\n');
  }
});
input.on('close', () => void shutdown().finally(() => process.exit(0)));
