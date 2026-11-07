import type { DashboardConfig, DashboardKit, StudioEngine, StudioKind, StudioSpec } from './types';
import { appStorageScript, type AppState } from './app-state';
declare global { interface Window { BLKStudioEngine?: StudioEngine; BLKDashboardKit?: DashboardKit } }
let singleton: Promise<{ engine: StudioEngine; kit: DashboardKit }> | undefined;
function script(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script'); element.src = src; element.async = true;
    element.onload = () => resolve(); element.onerror = () => { element.remove(); reject(new Error('No se pudo cargar el motor Tektonik hub. Comprueba public/engines y vuelve a intentar.')); };
    document.head.appendChild(element);
  });
}
export function loadEngines() {
  if (!singleton) singleton = (async () => {
    if (!window.BLKStudioEngine) await script('/engines/studio-engine.js');
    if (!window.BLKDashboardKit) await script('/engines/dashboard-kit.js');
    const engine = window.BLKStudioEngine, kit = window.BLKDashboardKit;
    if (!engine || !kit || typeof engine.createSpec !== 'function' || typeof kit.validate !== 'function') throw new Error('Motores Tektonik hub incompletos.');
    return { engine, kit };
  })().catch(error => { singleton = undefined; throw error; });
  return singleton;
}
export const OFFLINE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'";
export function isolatedHTML(html: string, storage?: { state: AppState; channel: string }): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (storage) {
    const script = doc.createElement('script'); script.textContent = appStorageScript(storage.state, storage.channel); doc.head.prepend(script);
  }
  const meta = doc.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = OFFLINE_CSP; doc.head.prepend(meta);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
export function dashboardFromHTML(html: string, kit: Pick<DashboardKit, 'validate'>): DashboardConfig | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const embedded = doc.querySelector('script#blk-dashboard-config[type="application/json"]');
  if (!embedded) return null;
  return parseDashboardJSON(embedded.textContent || '', kit);
}
export function parseDashboardJSON(text: string, kit: Pick<DashboardKit,'validate'>): DashboardConfig {
  if (new TextEncoder().encode(text).length > 120_000) throw new Error('Configuración dashboard demasiado grande.');
  const input: unknown = JSON.parse(text); return kit.validate(input);
}
export function generatedDocument(html: string, provider: 'demo' | 'azure-openai', model?: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const [name, content] of [['blk-generator',provider],['blk-model',model||'']]) {
    const meta = doc.createElement('meta'); meta.name = name; meta.content = content; doc.head.appendChild(meta);
  }
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
export function provenanceFromHTML(html: string): {provider: 'demo'|'azure-openai'; model?: string} {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const provider = doc.querySelector('meta[name="blk-generator"]')?.getAttribute('content') === 'azure-openai' ? 'azure-openai' : 'demo';
  const model = doc.querySelector('meta[name="blk-model"]')?.getAttribute('content')?.slice(0,128);
  return {provider,...(model?{model}:{})};
}
export function withDashboard(spec: StudioSpec, config: DashboardConfig): StudioSpec {
  return { ...spec, kind: 'dashboard', title: config.title, description: config.description, dark: config.theme.dark, accent: config.theme.accent, dashboard: config };
}
export function specForKind(engine: StudioEngine, prompt: string, kind: StudioKind, previous: StudioSpec | null): StudioSpec {
  const labels: Record<StudioKind, string> = { dashboard: 'dashboard', calculator: 'calculadora', form: 'formulario', kanban: 'kanban' };
  const base = previous || engine.createSpec(labels[kind]);
  const selected = base.kind === kind ? base : engine.createSpec('Convierte a ' + labels[kind], base);
  return engine.createSpec(prompt, selected);
}
export function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw new DOMException('Generación detenida', 'AbortError'); }
export function waitForGeneration(signal: AbortSignal, ms = 80): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Generación detenida', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Generación detenida', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
