import { expect, open, test } from "nsh/test";
import { createFixture, reply } from "./model";

test("fixture rejects empty/duplicate starts and stale events after stop", () => {
  const model = createFixture();
  expect(model.start(0, "  ")).toBeNull();
  const first = model.start(0, "hello")!;
  expect(model.start(0, "duplicate")).toBeNull();
  expect(model.history(0)).toBe(false);
  model.tick(0, first);
  model.stop(0);
  const partial = model.sessions[0].messages[1].body;
  expect(model.tick(0, first)).toBe(false);
  expect(model.sessions[0].messages[1].body).toBe(partial);
  const second = model.start(0, "again")!;
  expect(model.tick(0, first)).toBe(false);
  while (model.tick(0, second)) { /* deterministic fixture */ }
  expect(model.sessions[0].status).toBe("已完成");
  expect(model.sessions[0].messages[3].body).toBe(reply);
  expect(model.sessions[1].messages).toHaveLength(0);
});

test("native chat streams Chinese and renders Markdown", async () => {
  const app = await open("./App.tsx");
  expect(app.enabled("id:send")).toBe(false);
  expect(app.enabled("id:stop")).toBe(false);
  await app.type("id:prompt", "你好，验证中文与代码");
  await app.press("id:send");
  await app.waitFor("text:会话 A · 已完成 · 2 条", { timeout: 10000 });
  await app.waitFor("text:验证完成：未访问正式沐码数据。");
  expect(app.value("id:prompt")).toBe("");
});

test("stop freezes response and switching sessions keeps independent state", async () => {
  const app = await open("./App.tsx");
  await app.type("id:prompt", "stop test");
  await app.press("id:send");
  await app.press("id:stop");
  await app.waitFor("text:会话 A · 已停止 · 2 条");
  const frozen = app.texts();
  await app.wait(500);
  expect(app.texts()).toEqual(frozen);
  expect(app.enabled("id:stop")).toBe(false);
  await app.press("id:session-b");
  await app.waitFor("text:会话 B · 空闲 · 0 条");
  await app.press("id:session-a");
  await app.waitFor("text:会话 A · 已停止 · 2 条");
});

test("1000 fixture rows recycle and scroll without creating 1000 views", async () => {
  const app = await open("./App.tsx");
  await app.press("id:history");
  await app.waitFor("text:会话 A · 空闲 · 1000 条");
  expect(app.count("id:message")).toBeGreaterThan(0);
  expect(app.count("id:message")).toBeLessThan(100);
  await app.scroll("id:messages", 1000);
  expect(app.count("id:message")).toBeLessThan(100);
});
