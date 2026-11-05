import { describe, expect, it } from 'vitest';
import { PLUGIN_SLOTS, validatePluginManifest } from './manifest';

const valid = { id: 'dev.moos.insights', name: 'Insights', version: '1.0.0', type: 'ui',
  moosVersion: '^0.1.0', entry: 'builtin:insights', slots: ['usage.metric'], permissions: ['ui:slots'] };

describe('plugin manifest', () => {
  it('accepts only the ten approved slots and a compatible built-in manifest', () => {
    expect(PLUGIN_SLOTS).toHaveLength(10);
    expect(validatePluginManifest(valid).id).toBe(valid.id);
    expect(() => validatePluginManifest({ ...valid, slots: ['conversation.secret'] })).toThrow(/slot/i);
    expect(() => validatePluginManifest({ ...valid, moosVersion: '^0.2.0' })).toThrow(/compatible/i);
  });

  it('rejects executable, remote, malformed and over-permissioned manifests', () => {
    expect(() => validatePluginManifest({ ...valid, entry: 'https://evil.test/plugin.js' })).toThrow(/entry/i);
    expect(() => validatePluginManifest({ ...valid, version: 'latest' })).toThrow(/version/i);
    expect(() => validatePluginManifest({ ...valid, permissions: ['shell'] })).toThrow(/permission/i);
  });
});
