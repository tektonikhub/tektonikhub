import { z } from 'zod';
import { OFFLINE_CSP } from './engines';
import { MAX_PORTABLE_FILE_BYTES, LEGACY_PORTABLE_JSON_BYTES } from './limits';

export interface PortableFile { name: string; content: string; type: 'text/html' | 'application/json' }
const BUNDLE_LIMIT = 25 * 1024 * 1024;
const encoder = new TextEncoder();

// Conservative portable basenames avoid URL decoding, Windows aliases and HTML attributes.
function safeName(name: string): boolean {
  return name.length <= 120 && /^[a-z0-9][a-z0-9_. -]*\.(html|json)$/i.test(name)
    && !name.includes('..') && !/[. ]\./.test(name)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[. ]|$)/i.test(name);
}
const filesSchema = (jsonLimit: number) => z.array(z.object({
  name: z.string().refine(safeName, 'Use a safe HTML or JSON basename.'),
  content: z.string(),
  type: z.enum(['text/html', 'application/json']),
}).strict()).min(1).max(10).superRefine((files, ctx) => {
  let htmlCount = 0, total = 0;
  const names = new Set<string>();
  for (const [index, file] of files.entries()) {
    const issue = (message: string, field = 'content') => ctx.addIssue({ code: 'custom', path: [index, field], message });
    const name = file.name.toLowerCase();
    if (names.has(name)) issue('Filenames must be unique ignoring case.', 'name');
    names.add(name);
    if (file.type === 'text/html') htmlCount++;
    const limit = file.type === 'text/html' ? MAX_PORTABLE_FILE_BYTES : jsonLimit;
    if (file.content.length > limit) {
      issue('File exceeds the UTF-8 byte limit (2 MB for new uploads).');
      continue;
    }
    const size = encoder.encode(file.content).length;
    total += size + encoder.encode(file.name).length + encoder.encode(file.type).length;
    if (size > limit) {
      issue('File exceeds the UTF-8 byte limit (2 MB for new uploads).');
      continue;
    }
    if (file.type === 'text/html') {
      if (!name.endsWith('.html')) issue('HTML requires an .html extension.', 'name');
      if (!file.content.trim()) issue('HTML must be nonempty.');
    } else {
      if (!name.endsWith('.json')) issue('JSON requires a .json extension.', 'name');
      try { JSON.parse(file.content); } catch { issue('Invalid JSON.'); }
    }
  }
  if (htmlCount !== 1) ctx.addIssue({ code: 'custom', message: 'Exactly one HTML file is required.' });
  if (total > BUNDLE_LIMIT) ctx.addIssue({ code: 'custom', message: 'Bundle exceeds 25 MiB of UTF-8 data.' });
});

export const portableFilesSchema = filesSchema(MAX_PORTABLE_FILE_BYTES);
const storedFilesSchema = filesSchema(LEGACY_PORTABLE_JSON_BYTES);
export function validatePortableFiles(input: unknown): PortableFile[] { return portableFilesSchema.parse(input); }
export function validateStoredPortableFiles(input: unknown): PortableFile[] { return storedFilesSchema.parse(input); }

const runtime = String.raw`
(() => {
  'use strict';
  const files = __PORTABLE_DATA__;
  const data = new Map(files.map(file => [file.name.toLowerCase(), file]));
  const base = (() => {
    try { new URL('.', document.baseURI); return document.baseURI; }
    catch { return 'https://portable.invalid/'; }
  })();
  const error = () => new TypeError('Offline bundle: only linked JSON GET/HEAD requests are allowed.');
  function lookup(input, isRequest = false) {
    const name = String(input);
    if (!isRequest && (/^[a-z][a-z0-9+.-]*:/i.test(name) || !/^(?:\.\/)?[^\\/]+$/.test(name.split(/[?#]/)[0]))) throw error();
    const url = new URL(name, base);
    for (const file of files) {
      const linked = new URL(file.name, base);
      if (url.origin === linked.origin && url.pathname === linked.pathname) return {file, url};
    }
    throw error();
  }
  function aborted(signal) {
    if (signal && signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  }
  Object.defineProperty(window, 'fetch', { configurable: false, writable: false, value: async function(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const signal = init.signal === undefined ? request && request.signal : init.signal;
    aborted(signal);
    const method = String(init.method || (request && request.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' || init.body != null || request && request.body !== null) throw error();
    const {file, url} = lookup(request ? request.url : input, !!request);
    await Promise.resolve();
    aborted(signal);
    const response = new Response(method === 'HEAD' ? null : file.content, {status: 200, headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(new TextEncoder().encode(file.content).length)
    }});
    Object.defineProperty(response, 'url', {value: url.href});
    return response;
  }});
  class OfflineXHR extends EventTarget {
    constructor() {
      super();
      this._state = 0; this._status = 0; this._body = ''; this._type = ''; this._url = '';
      this._sent = false; this._timer = null; this._generation = 0; this._timeout = 0;
      this.withCredentials = false; this.upload = new EventTarget();
    }
    get readyState() { return this._state; }
    get status() { return this._status; }
    get statusText() { return this._status ? 'OK' : ''; }
    get responseURL() { return this._status ? this._url : ''; }
    get responseType() { return this._type; }
    set responseType(value) {
      if (this._state >= 3 || this._sent) throw new DOMException('Request already sent', 'InvalidStateError');
      if (!['', 'text', 'json', 'arraybuffer', 'blob', 'document'].includes(value)) throw new TypeError('Unsupported responseType');
      this._type = value;
    }
    get timeout() { return this._timeout; }
    set timeout(value) { this._timeout = Math.max(0, Number(value) || 0); }
    get responseText() {
      if (this._type && this._type !== 'text') throw new DOMException('Not a text response', 'InvalidStateError');
      return this._state >= 3 ? this._body : '';
    }
    get responseXML() { return null; }
    get response() {
      if (!this._type || this._type === 'text') return this.responseText;
      if (this._state !== 4 || !this._status) return null;
      if (this._type === 'json') return this._body ? JSON.parse(this._body) : null;
      if (this._type === 'blob') return new Blob([this._body], {type: 'application/json'});
      if (this._type === 'arraybuffer') return new TextEncoder().encode(this._body).buffer;
      return null;
    }
    _event(type, progress = false) {
      const event = progress ? new ProgressEvent(type, {lengthComputable: !!this._status, loaded: this._body.length, total: this._body.length}) : new Event(type);
      this.dispatchEvent(event);
      if (typeof this['on' + type] === 'function') this['on' + type].call(this, event);
    }
    _stateChange(state) { this._state = state; this._event('readystatechange'); }
    open(method, url, async = true, username, password) {
      if (username != null || password != null) throw error();
      method = String(method).toUpperCase();
      if (!/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/.test(method)) throw new DOMException('Invalid method', 'SyntaxError');
      if (['CONNECT', 'TRACE', 'TRACK'].includes(method)) throw new DOMException('Forbidden method', 'SecurityError');
      clearTimeout(this._timer); this._generation++; this._sent = false;
      this._method = method; this._input = String(url); this._async = !!async;
      this._status = 0; this._body = ''; this._url = ''; this._stateChange(1);
    }
    setRequestHeader(name, value) {
      if (this._state !== 1 || this._sent) throw new DOMException('Not opened', 'InvalidStateError');
      new Headers([[name, value]]);
    }
    overrideMimeType() { if (this._state >= 3) throw new DOMException('Too late', 'InvalidStateError'); }
    getAllResponseHeaders() { return this._state >= 2 && this._status ? 'content-type: application/json; charset=utf-8\r\n' : ''; }
    getResponseHeader(name) { return String(name).toLowerCase() === 'content-type' && this._state >= 2 && this._status ? 'application/json; charset=utf-8' : null; }
    send() {
      if (this._state !== 1 || this._sent) throw new DOMException('Not opened', 'InvalidStateError');
      this._sent = true;
      const generation = this._generation;
      const active = () => this._generation === generation && this._sent;
      const finish = () => {
        if (!active()) return;
        let linked;
        try {
          if (!['GET', 'HEAD'].includes(this._method)) throw error();
          linked = lookup(this._input);
        } catch (failure) {
          this._sent = false; this._stateChange(4);
          if (!this._async) throw failure;
          this._event('error', true); this._event('loadend', true); return;
        }
        this._status = 200; this._url = linked.url.href;
        this._stateChange(2); if (!active()) return;
        this._body = this._method === 'HEAD' ? '' : linked.file.content;
        this._stateChange(3); if (!active()) return;
        this._event('progress', true); if (!active()) return;
        this._stateChange(4); if (!active()) return;
        this._sent = false; this._event('load', true); this._event('loadend', true);
      };
      this._event('loadstart', true);
      if (!active()) return;
      if (this._async) this._timer = setTimeout(finish, 0); else finish();
    }
    abort() {
      clearTimeout(this._timer); this._generation++;
      const pending = this._sent;
      this._sent = false; this._status = 0; this._body = '';
      if (pending) { this._stateChange(4); this._event('abort', true); this._event('loadend', true); }
      this._state = 0;
    }
  }
  for (const [name, value] of Object.entries({UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4})) {
    Object.defineProperty(OfflineXHR, name, {value}); Object.defineProperty(OfflineXHR.prototype, name, {value});
  }
  Object.defineProperty(window, 'XMLHttpRequest', {value: OfflineXHR, writable: false, configurable: false});
  function storage() {
    const entries = new Map();
    const api = {
      get length() { return entries.size; },
      key(index) { return Array.from(entries.keys())[Number(index) >>> 0] ?? null; },
      getItem(key) { return entries.get(String(key)) ?? null; },
      setItem(key, value) {
        key = String(key); value = String(value);
        const copy = new Map(entries); copy.set(key, value);
        let size = 0; for (const [k, v] of copy) size += (k.length + v.length) * 2;
        if (size > 5 * 1024 * 1024) throw new DOMException('Memory storage full', 'QuotaExceededError');
        entries.set(key, value);
      },
      removeItem(key) { entries.delete(String(key)); }, clear() { entries.clear(); }
    };
    return new Proxy(api, {
      get(target, key) { return key in target || typeof key === 'symbol' ? Reflect.get(target, key) : target.getItem(key) ?? undefined; },
      set(target, key, value) { target.setItem(key, value); return true; },
      deleteProperty(target, key) { target.removeItem(key); return true; },
      ownKeys() { return Array.from(entries.keys()); },
      getOwnPropertyDescriptor(target, key) { return entries.has(key) ? {value: entries.get(key), writable: true, enumerable: true, configurable: true} : undefined; }
    });
  }
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {value: storage(), configurable: false});
  Object.defineProperty(window, 'TektonikFiles', {value: Object.freeze({
    list: () => files.map(file => file.name),
    read: name => { const file = data.get(String(name).toLowerCase()); if (!file) throw error(); return JSON.parse(file.content); },
    exportJSON: (name, value) => {
      name = String(name);
      if (!/^[a-z0-9][a-z0-9_. -]*\.json$/i.test(name) || name.includes('..') || /[. ]\./.test(name) || name.length > 120 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[. ]|$)/i.test(name)) throw new TypeError('Use a safe JSON basename.');
      const content = JSON.stringify(value, null, 2);
      if (content === undefined) throw new TypeError('Value is not JSON serializable.');
      const blob = new Blob([content], {type: 'application/json'});
      if (blob.size > 5 * 1024 * 1024) throw new RangeError('JSON exceeds 5 MiB.');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }), configurable: false});
})();
`;

/** Render only in an iframe sandbox="allow-scripts allow-downloads" (never allow-same-origin).
 * Original HTML is kept verbatim; CSP and runtime precede every uploaded element/script.
 * Data/storage live only in this frame. FileReader inputs and blob downloads remain native.
 * No parent messaging, credentials or network fallback. XHR supports local GET/HEAD snapshots,
 * text/json/blob/arraybuffer responses and cancellation, not uploads, HTTP caches or timeout simulation.
 */
export function portableHTML(files: PortableFile[]): string {
  const validated = validateStoredPortableFiles(files);
  const html = validated.find(file => file.type === 'text/html')!.content;
  const json = JSON.stringify(validated.filter(file => file.type === 'application/json'))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const prelude = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}"><script>${runtime.replace('__PORTABLE_DATA__', () => json)}</script>`;
  // Only an initial doctype is moved ahead of the prelude; no regex-based HTML rewriting.
  const start = /^(?:\uFEFF)?\s*<!doctype\s+html\s*>/i.exec(html)?.[0] ?? '';
  return start + prelude + html.slice(start.length);
}
