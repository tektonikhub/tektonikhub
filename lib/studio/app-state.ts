import { z } from 'zod';

export const MAX_APP_STATE_BYTES = 200_000;
export const appStateSchema = z.record(z.string().max(120), z.string()).superRefine((state, context) => {
  if (Object.keys(state).length > 100 || new TextEncoder().encode(JSON.stringify(state)).length + Object.keys(state).length * 3 > MAX_APP_STATE_BYTES) {
    context.addIssue({ code: 'custom', message: 'El estado de la aplicación supera 200 KB o 100 claves.' });
  }
});
export type AppState = z.infer<typeof appStateSchema>;
export const appStateResultSchema = z.object({ state: appStateSchema, revision: z.number().int().nonnegative().max(2147483647) }).strict();
export type AppStateResult = z.infer<typeof appStateResultSchema>;

export function stateMessage(input: unknown, channel: string): AppState | null {
  const message = z.object({ type: z.literal('tektonik:state'), channel: z.literal(channel), state: appStateSchema }).strict().safeParse(input);
  return message.success ? message.data.state : null;
}

async function result(response: Response): Promise<AppStateResult> {
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new Error(error.success ? error.data.error : 'No se pudo guardar el estado de la aplicación.');
  }
  return appStateResultSchema.parse(data);
}
export async function loadAppState(appId: string, version: number, signal?: AbortSignal): Promise<AppStateResult> {
  return result(await fetch(`/api/apps/state?appId=${encodeURIComponent(appId)}&version=${version}`, { credentials: 'same-origin', cache: 'no-store', signal }));
}
export async function saveAppState(appId: string, version: number, state: AppState, revision: number): Promise<AppStateResult> {
  return result(await fetch('/api/apps/state', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId, version, state: appStateSchema.parse(state), revision }) }));
}

export function appStorageScript(state: AppState, channel: string): string {
  const payload = JSON.stringify({ state: appStateSchema.parse(state), channel }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return String.raw`(() => {
    'use strict';
    const initial = ${payload};
    const encode = new TextEncoder();
    function storage(persistent) {
      const entries = new Map(Object.entries(persistent ? initial.state : {}));
      const snapshot = () => Object.fromEntries(entries);
      function changed() {
        if (persistent) parent.postMessage({type: 'tektonik:state', channel: initial.channel, state: snapshot()}, '*');
      }
      const api = {
        get length() { return entries.size; },
        key(index) { return Array.from(entries.keys())[Number(index) >>> 0] ?? null; },
        getItem(key) { return entries.get(String(key)) ?? null; },
        setItem(key, value) {
          key = String(key); value = String(value);
          const next = new Map(entries); next.set(key, value);
          if (key.length > 120 || next.size > 100 || encode.encode(JSON.stringify(Object.fromEntries(next))).length + next.size * 3 > ${MAX_APP_STATE_BYTES}) throw new DOMException('App storage full', 'QuotaExceededError');
          if (entries.get(key) === value) return;
          entries.set(key, value); changed();
        },
        removeItem(key) { if (entries.delete(String(key))) changed(); },
        clear() { if (entries.size) { entries.clear(); changed(); } }
      };
      return new Proxy(api, {
        get(target, name) { if (typeof name === 'symbol') return Reflect.get(target, name); if (name in target) { const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value; } return entries.get(name); },
        set(target, name, value) { if (typeof name === 'symbol' || name in target) return false; target.setItem(name, value); return true; },
        deleteProperty(target, name) { if (typeof name !== 'string' || name in target) return false; target.removeItem(name); return true; },
        ownKeys() { return Array.from(entries.keys()).filter(name => !(name in api)); },
        getOwnPropertyDescriptor(target, name) { if (entries.has(name) && !(name in api)) return {value: entries.get(name), enumerable: true, configurable: true, writable: true}; }
      });
    }
    Object.defineProperty(window, 'TektonikState', {value: Object.freeze({version: 1}), configurable: false});
    Object.defineProperty(window, 'localStorage', {value: storage(true), configurable: false});
    Object.defineProperty(window, 'sessionStorage', {value: storage(false), configurable: false});
  })();`;
}
