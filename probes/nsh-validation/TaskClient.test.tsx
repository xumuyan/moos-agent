import { expect, test } from "nsh/test";
import { createTaskClient, TransportError } from "./task-client";
const id = "12345678-1234-1234-1234-123456789012";
const token = "a".repeat(64);
const endpoint = "https://localhost:9443";
function answer(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
async function code(fn: () => unknown) {
  try { await fn(); return "no_error"; } catch (error) {
    expect(error instanceof TransportError).toBe(true);
    expect(String(error).includes(token)).toBe(false);
    return (error as TransportError).code;
  }
}
test("task client limits endpoints and input before any network request", async () => {
  for (const url of ["http://localhost:9443", "https://user:pass@localhost", "https://localhost/path", "https://localhost?token=secret", "https://localhost/#x", "bad"]) {
    expect(await code(() => createTaskClient(url, token))).toBe("invalid_endpoint");
  }
  expect(await code(() => createTaskClient(endpoint, "secret"))).toBe("invalid_token");
  let calls = 0;
  const client = createTaskClient(endpoint, token, async () => { calls++; throw new Error("must not call"); });
  expect(await code(() => client.submit("../bad", "write"))).toBe("invalid_input");
  expect(await code(() => client.poll("../escape"))).toBe("invalid_input");
  expect(await code(() => client.poll(id, -1))).toBe("invalid_input");
  expect(await code(() => client.cancel("../escape"))).toBe("invalid_input");
  expect(calls).toBe(0);
});
test("task client uses one attempt, no redirects, safe errors and explicit identical-id retry", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createTaskClient(endpoint, token, async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) throw new Error(`offline ${token}`);
    return answer({ version: 1, task: { id, status: "queued" }, replayed: true });
  });
  expect(await code(() => client.submit("same-id", "write"))).toBe("network_or_tls");
  expect(calls.length).toBe(1);
  expect((await client.submit("same-id", "write")).replayed).toBe(true);
  expect(calls[0].init.body).toBe(calls[1].init.body);
  expect(calls[0].init.redirect).toBe("error");
  expect(calls[0].url).toBe(`${endpoint}/v1/tasks`);
  expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  expect(calls[0].init.signal instanceof AbortSignal).toBe(true);
  for (const [status, expected] of [[401, "unauthorized"], [404, "not_found"], [409, "conflict"], [429, "capacity"], [500, "http_error"]] as const) {
    const bad = createTaskClient(endpoint, token, async () => answer({ secret: token }, status));
    expect(await code(() => bad.poll(id))).toBe(expected);
  }
  const controller = new AbortController(); controller.abort();
  expect(await code(() => client.poll(id, 0, controller.signal))).toBe("aborted");
  const aborted = createTaskClient(endpoint, token, async () => { throw new Error("abort"); });
  expect(await code(() => aborted.poll(id, 0, controller.signal))).toBe("aborted");
});
test("task client validates version, event ownership/order, terminal and cursor before advancing", async () => {
  const base = { version: 1, task: { id, status: "running" }, terminal: false,
    events: [{ id: 11, taskId: id, type: "text_delta", payload: { delta: "中文" } }], cursor: 11, hasMore: false };
  let lastUrl = "";
  const good = createTaskClient(endpoint, token, async url => { lastUrl = url; return answer(base); });
  const snapshot = await good.poll(id, 10);
  expect(snapshot.cursor).toBe(11); expect(snapshot.events[0].payload.delta).toBe("中文");
  expect(lastUrl).toBe(`${endpoint}/v1/tasks/${id}?after=10`);
  for (const bad of [{ ...base, version: 2 }, { ...base, terminal: true }, { ...base, cursor: 12 },
    { ...base, events: [{ ...base.events[0], taskId: "other" }] },
    { ...base, events: [{ ...base.events[0], id: 10 }] },
    { ...base, events: [base.events[0], base.events[0]] },
    { ...base, events: [], cursor: 10, hasMore: true }]) {
    const client = createTaskClient(endpoint, token, async () => answer(bad));
    expect(await code(() => client.poll(id, 10))).toBe(bad.version === 2 ? "protocol_version" : "invalid_response");
  }
  const cancel = createTaskClient(endpoint, token, async (url, init) => {
    expect(url).toBe(`${endpoint}/v1/tasks/${id}/cancel`); expect(init.body).toBe("{}");
    return answer({ version: 1, task: { id, status: "cancelled" } });
  });
  expect((await cancel.cancel(id)).status).toBe("cancelled");
});
test("task client bounds response bytes and rejects non-JSON responses", async () => {
  const huge = createTaskClient(endpoint, token, async () => new Response("x".repeat(1024 * 1024 + 1), { headers: { "content-type": "application/json" } }));
  expect(await code(() => huge.poll(id))).toBe("response_too_large");
  const html = createTaskClient(endpoint, token, async () => new Response("<html>private</html>"));
  expect(await code(() => html.poll(id))).toBe("invalid_response");
  const broken = createTaskClient(endpoint, token, async () => new Response("{", { headers: { "content-type": "application/json" } }));
  expect(await code(() => broken.poll(id))).toBe("invalid_response");
});
