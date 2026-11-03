import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

// M01 subprocess boundary: no inherited model keys, user settings or auto-discovered tools.
export class PiRpc {
  constructor({ node, cli, cwd, configDir }) {
    this.events = [];
    this.pending = new Map();
    this.waiters = new Set();
    this.nextId = 0;
    this.child = spawn(node, [cli, '--mode', 'rpc', '--no-session', '--offline',
      '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates',
      '--no-themes', '--no-context-files', '--no-approve', '--tools', 'read',
      '--provider', 'm01', '--model', 'fixture'], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
        PI_CODING_AGENT_DIR: configDir, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    this.stderr = '';
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4096); });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let record;
      try { record = JSON.parse(line); } catch { this.fail(new Error('Invalid PI JSONL')); return; }
      if (record.type === 'response' && this.pending.has(record.id)) {
        const pending = this.pending.get(record.id);
        this.pending.delete(record.id);
        clearTimeout(pending.timer);
        record.success ? pending.resolve(record) : pending.reject(new Error(record.error ?? record.command));
      } else {
        this.events.push(record);
        for (const waiter of this.waiters) {
          if (waiter.predicate(record)) {
            clearTimeout(waiter.timer);
            this.waiters.delete(waiter);
            waiter.resolve(record);
          }
        }
      }
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`PI exited (${code ?? signal})`)));
    this.child.stdin.on('error', error => this.fail(error));
  }
  fail(error) {
    this.failure = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.waiters.clear();
  }
  request(type, data = {}, timeout = 15000) {
    if (this.failure) return Promise.reject(this.failure);
    const id = `m01-${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`PI ${type} timeout`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...data, type, id }) + '\n');
    });
  }
  waitEvent(predicate, timeout = 15000, from = 0) {
    const found = this.events.slice(from).find(predicate);
    if (found) return Promise.resolve(found);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      waiter.timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error('PI event timeout')); }, timeout);
      this.waiters.add(waiter);
    });
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = once(this.child, 'exit');
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(timer); this.lines.close(); }
  }
}
