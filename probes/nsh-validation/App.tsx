import { cleanup, List, mount, signal, Text, View } from "nsh";
import { Button, Input, TextView } from "nsh/base";
import { createFixture } from "./model";

function App() {
  const fixture = createFixture();
  const selected = signal(0);
  const draft = signal("");
  const messages = signal([...fixture.sessions[0].messages]);
  const status = signal("空闲");
  const timers = new Map<number, ReturnType<typeof setInterval>>();
  function refresh() {
    const session = fixture.sessions[selected()];
    messages.set(session.messages.map(message => ({ ...message })));
    status.set(session.status);
  }
  function stop() {
    const index = selected();
    fixture.stop(index);
    clearInterval(timers.get(index));
    timers.delete(index);
    refresh();
  }
  function send() {
    const index = selected();
    const token = fixture.start(index, draft());
    if (token === null) return;
    draft.set("");
    refresh();
    timers.set(index, setInterval(() => {
      const running = fixture.tick(index, token);
      if (!running) {
        clearInterval(timers.get(index));
        timers.delete(index);
      }
      if (selected() === index) refresh();
    }, 200));
  }
  cleanup(() => { for (const timer of timers.values()) clearInterval(timer); });
  return (
    <View class="flex-1 bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] px-3 gap-2">
      <Text class="text-xl font-semibold text-foreground">沐码 · NSH 独立验证</Text>
      <Text class="text-sm text-muted-foreground">本地模拟 · 无 PI / 无网络 / 不保存数据</Text>
      <View class="flex-row gap-2">
        <Button testID="session-a" onPress={() => { selected.set(0); refresh(); }} class="rounded bg-primary px-3 py-2 disabled:opacity-40"><Text class="text-primary-foreground">会话 A</Text></Button>
        <Button testID="session-b" onPress={() => { selected.set(1); refresh(); }} class="rounded bg-primary px-3 py-2 disabled:opacity-40"><Text class="text-primary-foreground">会话 B</Text></Button>
        <Button testID="history" disabled={status() === "流式中"} onPress={() => { fixture.history(selected()); refresh(); }} class="rounded bg-primary px-3 py-2 disabled:opacity-40"><Text class="text-primary-foreground">1000 条</Text></Button>
      </View>
      <Text testID="status" class="text-sm text-foreground">{`会话 ${selected() === 0 ? "A" : "B"} · ${status()} · ${messages().length} 条`}</Text>
      <List testID="messages" each={messages()} estimatedItemSize={90} style={{ flex: 1 }}>
        {message => (
          <View testID="message" class="p-3 gap-2 border-b border-border">
            <Text class="text-sm text-muted-foreground">{message().role === "user" ? "你" : "模拟助手"}</Text>
            <TextView markdown={message().body} options={{ streaming: status() === "流式中" }} selectable />
          </View>
        )}
      </List>
      <Input testID="prompt" placeholder="输入测试消息（不会发送到模型）" value={draft()} onChange={event => draft.set(event.value)} onSubmit={send} />
      <View class="flex-row gap-2 pb-3">
        <Button testID="send" disabled={!draft().trim() || status() === "流式中"} onPress={send} class="rounded bg-primary px-3 py-2 disabled:opacity-40"><Text class="text-primary-foreground">模拟发送</Text></Button>
        <Button testID="stop" disabled={status() !== "流式中"} onPress={stop} class="rounded bg-primary px-3 py-2 disabled:opacity-40"><Text class="text-primary-foreground">停止</Text></Button>
      </View>
    </View>
  );
}
mount(App);
