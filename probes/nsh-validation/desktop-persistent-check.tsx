// Two launches of the same build, using its fixed synthetic profile and real PI.
import { host, mount } from 'nsh';
import { DesktopView, type DesktopActions } from './DesktopView';

let actions: DesktopActions | undefined;
let stage = 'startup';
const checks: string[] = [];
const measured = new Set<string>();
const firstText = 'N01_RESTART_FIRST';
const firstReply = `本地夹具响应：${firstText}`;
function check(ok: unknown, name: string) {
  stage = name;
  if (!ok) throw Error('check failed');
  checks.push(name);
}
async function until(name: string, ready: () => unknown) {
  stage = name;
  const until = Date.now() + 10000;
  while (!ready()) {
    if (Date.now() >= until) throw Error('deadline');
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
}
mount(() => <DesktopView persistentHistory ready={ui => { actions = ui; }}
  onGeometry={(name, { size }) => { if (size.width > 0 && size.height > 0) measured.add(name); }} />);

async function run() {
  await until('initial history page', () => actions?.history());
  const ui = actions!, view = ui.controller, initial = view.current!;
  const scope = initial.scope;
  const page = ui.history()!;
  await until('rendered messages region', () => measured.has('messages'));
  const restart = page.messages.length !== 0;
  if (restart) {
    check(page.messages.length === 2 && page.messages[0].role === 'user' && page.messages[0].text === firstText &&
      page.messages[1].role === 'assistant' && page.messages[1].text === firstReply && page.before === null &&
      initial.rows.length === 0 && initial.task === null, 'restored history without replay');
    await ui.project(view.projects[1].id);
    await until('other project history', () => ui.history());
    check(ui.history()?.messages.length === 0 && ui.history()?.projectId !== scope.projectId, 'other project stays empty');
    measured.delete('message-你'); measured.delete('message-PI 公开文本');
    await ui.project(scope.projectId);
    check(view.current?.scope.sessionId === scope.sessionId, 'same session selected again');
    await until('original history reload', () => ui.history()?.messages.length === 2);
    await until('rendered old messages', () => measured.has('message-你') && measured.has('message-PI 公开文本'));
    check(true, 'old user and assistant rows laid out');
    stage = 'capture old messages';
    const snapshot = await host.call<{ captured: boolean }>('piui.capture', {});
    check(snapshot.captured, 'old messages captured before Send');
  } else {
    check(initial.rows.length === 0 && page.before === null, 'fresh profile is empty');
  }
  ui.type(restart ? 'N01_RESTART_CONTINUE' : firstText); ui.send();
  await until('turn drained', () => initial.task && initial.drained);
  check(initial.task?.status === 'succeeded' && initial.rows.filter(r => r.role === '你').length === 1 &&
    initial.rows.find(r => r.role === 'PI 公开文本')?.body === (restart ? 'N01_CONTEXT_PRESERVED' : firstReply),
    restart ? 'PI continuation uses old context' : 'first turn complete');
  check(ui.history()?.messages.length === (restart ? 2 : 0), 'live turn excluded from historical page');
  await host.call('piui.report', { passed: true, stage: 'complete', checks, scope, restart });
}
void run().catch(async () => { await host.call('piui.report', { passed: false, stage, checks }); });
