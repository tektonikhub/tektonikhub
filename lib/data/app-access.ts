import { z } from 'zod';
import type { App } from '@/lib/domain/types';
import { requestJson } from './http-client';

const sourceSchema = z.object({
  appId: z.uuid(), version: z.number().int().positive(), generatedHtml: z.string().min(1).max(300000),
}).strict();

export function applicationHref(pathname: string, params: Pick<URLSearchParams, 'toString'>, appId?: string): string {
  const path = pathname === '/mi-flow' ? '/mi-flow' : '/catalog';
  const query = new URLSearchParams(params.toString());
  if (appId === undefined) query.delete('open');
  else query.set('open', appId);
  return query.size ? `${path}?${query}` : path;
}

export async function loadApplicationSource(app: Pick<App, 'id' | 'version'>, fetcher: typeof fetch = globalThis.fetch): Promise<string> {
  const params = new URLSearchParams({ appId: app.id, version: String(app.version) });
  const source = sourceSchema.parse(await requestJson(`/api/apps/source?${params}`, {}, fetcher));
  if (source.appId !== app.id || source.version !== app.version) throw new Error('El HTML recuperado no corresponde a la versión aprobada de esta aplicación.');
  return source.generatedHtml;
}
