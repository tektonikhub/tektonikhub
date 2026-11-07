import { z } from 'zod';
import type { App } from '@/lib/domain/types';
import { requestJson } from '@/lib/data/http-client';
import { htmlSourceSchema } from './limits';

const sourceSchema = z.object({
  appId: z.uuid(), version: z.number().int().positive(), generatedHtml: htmlSourceSchema.nullable(),
}).strict();

export async function loadSubmissionSource(app: Pick<App, 'id' | 'version'>, fetcher: typeof fetch = globalThis.fetch): Promise<string | null> {
  const params = new URLSearchParams({ appId: app.id, version: String(app.version) });
  const source = sourceSchema.parse(await requestJson(`/api/studio/source?${params}`, {}, fetcher));
  if (source.appId !== app.id || source.version !== app.version) throw new Error('El HTML recuperado no corresponde a la versión del ticket.');
  return source.generatedHtml;
}
