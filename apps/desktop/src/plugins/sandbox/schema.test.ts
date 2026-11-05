import { describe, expect, it } from 'vitest';
import { publicPluginContext, validatePluginView } from './schema';

describe('sandbox schema', () => {
  it('accepts only bounded declarative UI', () => {
    expect(validatePluginView({ type: 'group', children: [{ type: 'text', text: 'safe' }, { type: 'button', text: 'run', action: 'open.panel' }] })).toEqual({ type: 'group', children: [{ type: 'text', text: 'safe' }, { type: 'button', text: 'run', action: 'open.panel' }] });
    expect(() => validatePluginView({ type: 'html', html: '<script>bad()</script>' })).toThrow(/view/i);
    expect(() => validatePluginView({ type: 'group', children: Array.from({ length: 70 }, () => ({ type: 'text', text: 'x' })) })).toThrow(/group|view/i);
  });

  it('removes paths, tool payloads and unknown data from slot context', () => {
    expect(publicPluginContext({ projectId: 'p', projectPath: '/secret', events: [{ payload: 'secret' }], activeTasks: 2 })).toEqual({ projectId: 'p', activeTasks: 2 });
  });
});
