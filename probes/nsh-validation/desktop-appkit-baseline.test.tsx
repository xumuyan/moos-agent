import { expect, open, test } from 'nsh/test';

test('stock AppKit probe renders a failed call, not a successful PI response', async () => {
  const app = await open('./desktop-appkit-baseline.tsx', { host: { params: { hold: true }, handlers: {} } });
  await app.press('Check host');
  await app.waitUntil(() => app.texts().includes('APPKIT_BASELINE true ERR_NSH_HOST_ERROR'));
  expect(app.texts().join('\n')).not.toContain('unexpected-success');
});
