/** Pre-pairing transport primitive. No discovery, trust override, stored keys or automatic replay. */
export type Scenario = "write" | "hold";
export type Task = { id: string; status: string };
export type Event = { id: number; taskId: string; type: string; payload: Record<string, unknown> };
export type Snapshot = { task: Task; terminal: boolean; events: Event[]; cursor: number; hasMore: boolean };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const statuses = new Set(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]);
const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const MAX_BYTES = 1024 * 1024;
export class TransportError extends Error {
  constructor(public readonly code: string) { super(`N01 transport: ${code}`); }
}
function fail(code = "invalid_response"): never { throw new TransportError(code); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function task(value: unknown, expected?: string): Task {
  const result = record(value);
  if (typeof result.id !== "string" || !UUID.test(result.id) || (expected && expected !== result.id)
    || typeof result.status !== "string" || !statuses.has(result.status)) fail();
  return { id: result.id, status: result.status };
}
function taskId(id: string) { if (typeof id !== "string" || !UUID.test(id)) fail("invalid_input"); return id; }

/** Endpoint/token must come from a future authenticated pairing layer, NOT an untrusted URL/QR alone.
 * Supplying an endpoint does not pin its certificate. Trust remains the platform's responsibility.
 * io is injectable for deterministic tests; production callers leave it as the native fetch.
 */
export function createTaskClient(endpoint: string, token: string, io: Fetch = fetch) {
  if (typeof endpoint !== "string") fail("invalid_endpoint");
  let url: URL;
  try { url = new URL(endpoint); } catch { fail("invalid_endpoint"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/"
    || url.search || url.hash || !url.hostname) fail("invalid_endpoint");
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) fail("invalid_token");
  const origin = url.origin;
  async function request(path: string, body?: unknown, signal?: AbortSignal) {
    if (signal?.aborted) fail("aborted");
    let response: Response;
    try {
      response = await io(origin + path, { method: body === undefined ? "GET" : "POST",
        redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { fail(signal?.aborted ? "aborted" : "network_or_tls"); }
    // Do not include endpoint, token, network diagnostics or response bodies in errors/UI logs.
    if (response.status !== 200) {
      await response.body?.cancel();
      fail(response.status === 401 ? "unauthorized" : response.status === 404 ? "not_found"
        : response.status === 409 ? "conflict" : response.status === 429 ? "capacity" : "http_error");
    }
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (mime !== "application/json") { await response.body?.cancel(); fail(); }
    const reader = response.body?.getReader();
    if (!reader) fail();
    const decoder = new TextDecoder(); let size = 0; let text = "";
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > MAX_BYTES) fail("response_too_large");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      if (error instanceof TransportError) throw error;
      fail(signal?.aborted ? "aborted" : "network_or_tls");
    } finally { try { await reader.cancel(); } catch { /* preserve original failure */ } reader.releaseLock(); }
    let value: Record<string, unknown>;
    try { value = record(JSON.parse(text)); } catch { fail(); }
    if (value.version !== 1) fail("protocol_version");
    return value;
  }
  return {
    async submit(requestId: string, scenario: Scenario, signal?: AbortSignal) {
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)
        || !["write", "hold"].includes(scenario)) fail("invalid_input");
      // Exactly one attempt: ambiguous network failure must retain requestId for explicit retry.
      const value = await request("/v1/tasks", { requestId, scenario }, signal);
      if (typeof value.replayed !== "boolean") fail();
      return { task: task(value.task), replayed: value.replayed };
    },
    async poll(id: string, after = 0, signal?: AbortSignal): Promise<Snapshot> {
      taskId(id); if (!Number.isSafeInteger(after) || after < 0 || after > 999999999999999) fail("invalid_input");
      const value = await request(`/v1/tasks/${id}?after=${after}`, undefined, signal);
      const current = task(value.task, id);
      if (typeof value.terminal !== "boolean" || value.terminal !== terminal.has(current.status)
        || typeof value.hasMore !== "boolean" || !Array.isArray(value.events) || value.events.length > 100
        || !Number.isSafeInteger(value.cursor)) fail();
      let cursor = after;
      const events = value.events.map(item => {
        const event = record(item);
        if (!Number.isSafeInteger(event.id) || (event.id as number) <= cursor || event.taskId !== id
          || typeof event.type !== "string") fail();
        cursor = event.id as number;
        return { id: cursor, taskId: id, type: event.type, payload: record(event.payload) };
      });
      if (value.cursor !== cursor || (value.hasMore && !events.length)) fail();
      return { task: current, terminal: value.terminal, events, cursor, hasMore: value.hasMore };
    },
    async cancel(id: string, signal?: AbortSignal) {
      const value = await request(`/v1/tasks/${taskId(id)}/cancel`, {}, signal);
      return task(value.task, id);
    },
  };
}
