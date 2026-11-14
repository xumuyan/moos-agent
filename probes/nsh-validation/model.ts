/** In-memory fixture only: no PI, network, filesystem, credentials or shell. */
export type Message = { id: number; role: "user" | "assistant"; body: string };
export type Session = { messages: Message[]; status: "空闲" | "流式中" | "已停止" | "已完成" };
export const reply = "## NSH 原生流式验证\n\n这是**本地模拟响应**，不是模型输出，也没有执行工具。\n\n```ts\nconst platform = 'native';\n```\n\n- 中文输入与 Markdown\n- 会话切换和停止\n\n验证完成：未访问正式沐码数据。";
export function createFixture() {
  let id = 0;
  let generation = 0;
  const sessions: Session[] = [0, 1].map(() => ({ messages: [], status: "空闲" }));
  const active = new Map<number, { token: number; offset: number; message: Message }>();
  return {
    sessions,
    start(index: number, prompt: string) {
      const session = sessions[index];
      if (!prompt.trim() || active.has(index)) return null;
      const message: Message = { id: ++id, role: "assistant", body: "" };
      session.messages.push({ id: ++id, role: "user", body: prompt.trim() }, message);
      session.status = "流式中";
      const token = ++generation;
      active.set(index, { token, offset: 0, message });
      return token;
    },
    tick(index: number, token: number) {
      const run = active.get(index);
      if (!run || run.token !== token) return false;
      run.offset = Math.min(reply.length, run.offset + 6);
      run.message.body = reply.slice(0, run.offset);
      if (run.offset === reply.length) {
        active.delete(index);
        sessions[index].status = "已完成";
        return false;
      }
      return true;
    },
    stop(index: number) {
      if (!active.delete(index)) return;
      sessions[index].status = "已停止";
    },
    history(index: number) {
      if (active.has(index)) return false;
      sessions[index].messages = Array.from({ length: 1000 }, (_, n) => ({
        id: ++id, role: "assistant", body: `历史条目 ${n + 1} · 本地合成数据，验证列表回收。`,
      }));
      sessions[index].status = "空闲";
      return true;
    },
  };
}
