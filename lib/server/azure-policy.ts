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

const azureErrorSchema = z.object({
  error: z.object({ code: z.unknown().optional(), param: z.unknown().optional() }),
});
export function azureRequestError(status: number, value: unknown): string {
  const prefix = `Azure rechazó la solicitud (HTTP ${status}).`;
  const parsed = azureErrorSchema.safeParse(value);
  const error = parsed.success ? parsed.data.error : undefined;
  if (status === 404 || error?.code === 'DeploymentNotFound' || error?.code === 'model_not_found') {
    return `${prefix} Comprueba que el endpoint corresponde al recurso correcto y que «Modelo desplegado» contiene el nombre exacto de un deployment de ese recurso.`;
  }
  if (error?.code === 'OperationNotSupported' || error?.code === 'unsupported_model') {
    return `${prefix} El modelo desplegado no admite esta operación. Usa un deployment compatible con Azure Responses v1 y JSON mode.`;
  }
  switch (error?.param) {
    case 'model':
      return `${prefix} Revisa «Modelo desplegado»: debe ser el nombre exacto del deployment en este recurso de Azure, no la URL ni el nombre del recurso.`;
    case 'text.format':
    case 'text.format.type':
      return `${prefix} El modelo desplegado rechazó el formato JSON (text.format). Usa un deployment compatible con Responses v1 y JSON mode.`;
    case 'input':
      return `${prefix} Azure rechazó el contenido de input. La entrada debe pedir JSON explícitamente y respetar los límites del modelo.`;
    case 'instructions':
      return `${prefix} El modelo desplegado rechazó el parámetro instructions. Comprueba su compatibilidad con Azure Responses v1.`;
    case 'max_output_tokens':
      return `${prefix} Azure rechazó max_output_tokens. Revisa los límites de salida del modelo desplegado.`;
    case 'store':
      return `${prefix} Azure rechazó store:false. Comprueba que el recurso admite Responses sin almacenar las respuestas.`;
    default:
      return `${prefix} Revisa el endpoint, el modelo desplegado y su compatibilidad con Responses y JSON.`;
  }
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
  allowDataChanges: z.boolean().optional(),
}).strict();
