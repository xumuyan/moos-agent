import type { PluginManifest, PluginSlot } from '../manifest';
import { publicPluginContext, validatePluginView, type PluginView } from './schema';

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_SECOND = 200;
const BOOT_TIMEOUT_MS = 2000;
const RENDER_TIMEOUT_MS = 1000;
const HEALTH_INTERVAL_MS = 2000;
const HEALTH_TIMEOUT_MS = 1000;

export const SANDBOX_POLICY = "dedicated Worker; no DOM/Tauri; network, nested workers, cross-context channels and browser persistence removed; CSP denies eval and remote scripts";
const DENIED_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'Worker', 'SharedWorker', 'importScripts', 'BroadcastChannel', 'indexedDB', 'caches', 'navigator', 'postMessage', '__TAURI__', '__TAURI_INTERNALS__'];

export function workerSource(token: string, manifest: PluginManifest, source: string) {
  if (/\bimport\s*(?:\(|Scripts\b)/.test(source)) throw new Error('Plugin imports are not allowed');
  return `(()=>{const send=self.postMessage.bind(self);const listen=self.addEventListener.bind(self);const token=${JSON.stringify(token)};const renderers=new Map();const actions=new Map();const pending=new Map();let seq=0;for(const name of ${JSON.stringify(DENIED_GLOBALS)}){try{Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false})}catch{}}const emit=(kind,payload={})=>send({token,kind,...payload});const allowedSlots=new Set(${JSON.stringify(manifest.slots)});const permissions=new Set(${JSON.stringify(manifest.permissions)});const api=Object.freeze({version:1,registerSlot(slot,renderer){if(!allowedSlots.has(slot)||typeof renderer!=="function")throw new Error("slot denied");renderers.set(slot,renderer);emit("registered",{slot});},registerAction(action,handler){if(typeof action!=="string"||typeof handler!=="function")throw new Error("invalid action");actions.set(action,handler);},notify(text){if(!permissions.has("ui:notifications"))throw new Error("permission denied");emit("notify",{text:String(text).slice(0,500)});},getConfig(){if(!permissions.has("storage:private"))return Promise.reject(new Error("permission denied"));const id=++seq;emit("config-get",{requestId:id});return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));},setConfig(value){if(!permissions.has("storage:private"))return Promise.reject(new Error("permission denied"));const id=++seq;emit("config-set",{requestId:id,value});return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}});Object.defineProperty(globalThis,"moos",{value:api,writable:false,configurable:false});listen("message",async event=>{const message=event.data;if(!message||message.token!==token)return;if(message.kind==="health")emit("health");else if(message.kind==="render"){try{const renderer=renderers.get(message.slot);emit("view",{requestId:message.requestId,slot:message.slot,view:renderer?await renderer(message.context):null});}catch{emit("plugin-error",{code:"render_failed"});}}else if(message.kind==="action"){try{const handler=actions.get(message.action);if(handler)await handler();}catch{emit("plugin-error",{code:"action_failed"});}}else if(message.kind==="config-result"){const item=pending.get(message.requestId);if(item){pending.delete(message.requestId);message.ok?item.resolve(message.value):item.reject(new Error("config failed"));}}});emit("ready")})();\n${source}`;
}

type Listener = () => void;
export interface SandboxOptions {
  manifest: PluginManifest;
  source: string;
  onFailure: (reason: string) => void;
  onNotify: (text: string) => void;
  getConfig: () => Promise<unknown>;
  setConfig: (value: unknown) => Promise<void>;
}

export class SandboxMessageBudget {
  private messages: number[] = [];
  accept(size: number, now = Date.now()) {
    this.messages = this.messages.filter(time => now - time < 1000); this.messages.push(now);
    return size <= MAX_MESSAGE_BYTES && this.messages.length <= MAX_MESSAGES_PER_SECOND;
  }
}

export class PluginSandbox {
  private worker?: Worker;
  private workerUrl?: string;
  private token = crypto.randomUUID();
  private views = new Map<PluginSlot, PluginView | null>();
  private listeners = new Map<PluginSlot, Set<Listener>>();
  private budget = new SandboxMessageBudget();
  private request = 0;
  private contexts = new Map<PluginSlot, unknown>();
  private registered = new Set<PluginSlot>();
  private pending = new Map<number, number>();
  private stopped = false;
  private timeout?: number;
  private healthTimer?: number;
  private healthDeadline?: number;
  constructor(private options: SandboxOptions) {}

  start() {
    if (this.worker || this.stopped) return;
    try {
      this.workerUrl = URL.createObjectURL(new Blob([workerSource(this.token, this.options.manifest, this.options.source)], { type: 'text/javascript' }));
      this.worker = new Worker(this.workerUrl); this.worker.onmessage = this.onMessage; this.worker.onerror = () => this.fail('worker_crash'); this.worker.onmessageerror = () => this.fail('invalid_message');
      this.timeout = window.setTimeout(() => this.fail('startup_timeout'), BOOT_TIMEOUT_MS);
    } catch { this.fail('worker_start_failed'); }
  }

  stop() { if (this.stopped) return; this.stopped = true; if (this.timeout) clearTimeout(this.timeout); if (this.healthTimer) clearTimeout(this.healthTimer); if (this.healthDeadline) clearTimeout(this.healthDeadline); for (const timer of this.pending.values()) clearTimeout(timer); this.pending.clear(); this.worker?.terminate(); this.worker = undefined; if (this.workerUrl) URL.revokeObjectURL(this.workerUrl); this.workerUrl = undefined; this.listeners.clear(); }
  subscribe(slot: PluginSlot, listener: Listener) { const set = this.listeners.get(slot) ?? new Set(); set.add(listener); this.listeners.set(slot, set); return () => set.delete(listener); }
  view(slot: PluginSlot) { return this.views.get(slot) ?? null; }
  render(slot: PluginSlot, context: unknown) { this.contexts.set(slot, context); if (this.registered.has(slot)) this.sendRender(slot, context); }
  action(slot: PluginSlot, action: string) { this.post({ kind: 'action', slot, action }); }
  private post(message: Record<string, unknown>) { this.worker?.postMessage({ token: this.token, ...message }); }
  private fail(reason: string) { if (this.stopped) return; this.options.onFailure(reason); this.stop(); }
  private onMessage = (event: MessageEvent) => {
    let size = 0; try { size = JSON.stringify(event.data).length; } catch { this.fail('invalid_message'); return; }
    if (!this.budget.accept(size)) { this.fail('message_limit'); return; }
    if (!event.data || typeof event.data !== 'object' || event.data.token !== this.token) return;
    if (event.data.kind === 'ready') return;
    if (event.data.kind === 'health') { if (this.healthDeadline) clearTimeout(this.healthDeadline); this.healthDeadline = undefined; this.healthTimer = window.setTimeout(() => this.checkHealth(), HEALTH_INTERVAL_MS); return; }
    if (event.data.kind === 'registered' && this.options.manifest.slots.includes(event.data.slot)) {
      this.registered.add(event.data.slot); const context = this.contexts.get(event.data.slot); if (context !== undefined) this.sendRender(event.data.slot, context);
      if (this.registered.size === this.options.manifest.slots.length && this.timeout) { clearTimeout(this.timeout); this.timeout = undefined; this.healthTimer = window.setTimeout(() => this.checkHealth(), HEALTH_INTERVAL_MS); }
      return;
    }
    if (event.data.kind === 'view' && this.options.manifest.slots.includes(event.data.slot)) {
      if (typeof event.data.requestId === 'number') { const timer = this.pending.get(event.data.requestId); if (timer) clearTimeout(timer); this.pending.delete(event.data.requestId); }
      try { this.views.set(event.data.slot, event.data.view == null ? null : validatePluginView(event.data.view)); this.listeners.get(event.data.slot)?.forEach(listener => listener()); }
      catch { this.fail('invalid_view'); }
    } else if (event.data.kind === 'notify' && this.options.manifest.permissions.includes('ui:notifications') && typeof event.data.text === 'string') this.options.onNotify(event.data.text.slice(0, 500));
    else if (event.data.kind === 'config-get' || event.data.kind === 'config-set') void this.handleConfig(event.data);
    else if (event.data.kind === 'plugin-error') this.fail(typeof event.data.code === 'string' ? event.data.code : 'plugin_error');
  };
  private sendRender(slot: PluginSlot, context: unknown) {
    const requestId = ++this.request;
    this.post({ kind: 'render', requestId, slot, context: this.options.manifest.permissions.includes('context:read') ? publicPluginContext(context) : {} });
    this.pending.set(requestId, window.setTimeout(() => this.fail('render_timeout'), RENDER_TIMEOUT_MS));
  }
  private checkHealth() { if (this.stopped) return; this.post({ kind: 'health' }); this.healthDeadline = window.setTimeout(() => this.fail('worker_unresponsive'), HEALTH_TIMEOUT_MS); }
  private async handleConfig(message: Record<string, unknown>) {
    const requestId = message.requestId; if (typeof requestId !== 'number' || !this.options.manifest.permissions.includes('storage:private')) return;
    try { const value = message.kind === 'config-get' ? await this.options.getConfig() : (await this.options.setConfig(message.value), null); this.post({ kind: 'config-result', requestId, ok: true, value }); }
    catch { this.post({ kind: 'config-result', requestId, ok: false }); }
  }
}
