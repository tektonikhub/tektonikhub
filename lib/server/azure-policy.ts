import { z } from 'zod';

const azureHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:openai\.azure\.com|services\.ai\.azure\.com)$/;
const azurePaths = new Set(['/', '/openai/v1', '/openai/v1/', '/openai/v1/responses', '/openai/v1/responses/']);

export function normalizeAzureEndpoint(value: string): string {
  let endpoint: URL;
  try { endpoint = new URL(value.trim()); }
  catch { throw new Error('Introduce un endpoint HTTPS de Azure OpenAI.'); }
  if (endpoint.protocol !== 'https:' || !azureHost.test(endpoint.hostname) || endpoint.port
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !azurePaths.has(endpoint.pathname)) {
    throw new Error('Usa un recurso openai.azure.com o services.ai.azure.com con la ruta /openai/v1/responses, sin puertos ni parámetros.');
  }
  return `${endpoint.origin}/openai/v1/responses`;
}

export const azureOrganizationSchema = z.uuid();
export const azureVersionSchema = z.number().int().min(0).max(2147483647);
export const azureSaveSchema = z.object({
  orgId: azureOrganizationSchema,
  endpoint: z.string().trim().min(1).max(300).transform((value, context) => {
    try { return normalizeAzureEndpoint(value); }
    catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Endpoint Azure inválido.' });
      return z.NEVER;
    }
  }),
  deployment: z.string().trim().regex(/^[a-zA-Z0-9._-]{1,128}$/, 'Introduce el nombre del modelo desplegado en Azure.'),
  apiKey: z.string().trim().max(512).refine(value => value === '' || /^[\x21-\x7e]{8,512}$/.test(value), 'Introduce una API key válida.'),
  version: azureVersionSchema,
}).strict();
export const azureClearSchema = z.object({ orgId: azureOrganizationSchema, version: azureVersionSchema }).strict();
export const azureTestSchema = z.object({ orgId: azureOrganizationSchema }).strict();
export const azureGenerationSchema = z.object({
  orgId: azureOrganizationSchema,
  prompt: z.string().trim().min(1).max(2000),
  previous: z.unknown().optional(),
}).strict();
