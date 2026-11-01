import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import dashboardKit from '@/lib/studio/runtime/dashboard-kit.js';
import { record } from '@/lib/studio/draft';
import type { LLMStatus } from '@/lib/studio/llm';
import type { DashboardConfig } from '@/lib/studio/types';
import { authenticatedContext } from './auth';
import { azureClearSchema, azureGenerationSchema, azureOrganizationSchema, azureSaveSchema, azureTestSchema, normalizeAzureEndpoint } from './azure-policy';
import { databaseError, errorResponse, HttpError, jsonResponse, readJson, sameOrigin } from './http';
import { limitedJSONText } from './local-llm-policy';

type Context = Awaited<ReturnType<typeof authenticatedContext>>;
const metadataColumns = 'endpoint,deployment,api_version,version';
const credentialsSchema = z.object({
  endpoint: z.string(),
  deployment: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
  api_version: z.string(),
  version: z.number().int().positive(),
  encrypted_key: z.string().regex(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,683}$/),
});
type Credentials = z.infer<typeof credentialsSchema>;

function encryptionKey(): Buffer {
  const value = process.env.AZURE_SETTINGS_ENCRYPTION_KEY || '';
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex')
    : /^(?:[A-Za-z0-9+/]{43}=?|[A-Za-z0-9_-]{43})$/.test(value) ? Buffer.from(value, 'base64') : null;
  if (!key || key.length !== 32) throw new HttpError(503, 'El servidor no tiene una clave de cifrado Azure válida. Contacta con IT.');
  return key;
}
function authorize(context: Context, orgId: string, admin = false): void {
  if (!['developer', 'admin', 'superadmin'].includes(context.session.role)
    || (admin && !['admin', 'superadmin'].includes(context.session.role))
    || (context.session.role !== 'superadmin' && context.session.orgId !== orgId)) {
    throw new HttpError(403, admin ? 'Solo Administración puede configurar Azure en esta empresa.' : 'No puedes utilizar Azure en esta empresa.');
  }
}
function csrfToken(context: Context): string {
  return createHmac('sha256', encryptionKey())
    .update(`tektonik-azure-csrf-v1:${context.authUserId}:${context.session.userId}:${context.session.orgId}:${context.session.role}`)
    .digest('hex');
}
function validateMutation(request: Request, context: Context): void {
  sameOrigin(request);
  const token = request.headers.get('x-blk-csrf') || '';
  if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(csrfToken(context), 'hex'))) {
    throw new HttpError(403, 'Recarga la página antes de continuar.');
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new HttpError(415, 'Se requiere application/json.');
  }
}
function associatedData(orgId: string, settings: Pick<Credentials, 'endpoint' | 'deployment'>): Buffer {
  return Buffer.from(JSON.stringify(['tektonik-azure-v1', orgId, settings.endpoint, settings.deployment]));
}
function encrypt(apiKey: string, orgId: string, settings: Pick<Credentials, 'endpoint' | 'deployment'>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(associatedData(orgId, settings));
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
function decrypt(settings: Credentials, orgId: string): string {
  const key = encryptionKey();
  try {
    const [, iv, tag, encrypted] = settings.encrypted_key.split('.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(associatedData(orgId, settings));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const apiKey = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
    if (!/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw new Error('InvalidCredential');
    return apiKey;
  } catch {
    console.error('Azure credential decryption failed');
    throw new HttpError(503, 'No se pudo descifrar la clave de esta empresa. Administración debe volver a guardarla.');
  }
}
async function credentials(context: Context, orgId: string): Promise<Credentials | null> {
  const { data, error } = await context.client.database.from('organization_azure')
    .select(`${metadataColumns},encrypted_key`).eq('org_id', orgId).limit(1);
  if (error) databaseError(error);
  if (!Array.isArray(data)) throw new HttpError(503, 'InsForge no devolvió la configuración Azure válida.');
  if (!data.length) return null;
  const parsed = credentialsSchema.safeParse(data[0]);
  if (!parsed.success) throw new HttpError(503, 'La configuración Azure guardada no es válida. Administración debe volver a guardarla.');
  return parsed.data;
}
async function status(context: Context, orgId: string): Promise<LLMStatus> {
  encryptionKey();
  const { data, error } = await context.client.database.from('organization_azure')
    .select(metadataColumns).eq('org_id', orgId).limit(1);
  if (error) databaseError(error);
  if (!Array.isArray(data)) throw new HttpError(503, 'InsForge no devolvió la configuración Azure válida.');
  const parsed = credentialsSchema.omit({ encrypted_key: true }).nullable().safeParse(data[0] ?? null);
  if (!parsed.success) throw new HttpError(503, 'La configuración Azure guardada no es válida.');
  const settings = parsed.data;
  let endpoint = '';
  if (settings) {
    try { endpoint = normalizeAzureEndpoint(settings.endpoint); }
    catch { throw new HttpError(503, 'El endpoint Azure guardado no es válido. Administración debe volver a guardarlo.'); }
  }
  return { available: true, configured: !!settings, endpoint, deployment: settings?.deployment || '', apiVersion: 'v1', version: settings?.version || 0, storage: 'insforge' };
}
async function rpc(context: Context, name: string, fields: Record<string, string | number>): Promise<unknown> {
  const { data, error } = await context.client.database.rpc(name, fields);
  if (error) databaseError(error);
  return data;
}
function dashboard(value: unknown, upstream = false): DashboardConfig {
  try { return dashboardKit.validate(value); }
  catch {
    throw new HttpError(upstream ? 422 : 400, upstream
      ? 'La configuración del modelo no cumple el catálogo de componentes. No se ha creado ninguna versión.'
      : 'La configuración previa del dashboard no es válida.');
  }
}
function outputJSON(value: unknown): unknown {
  if (!record(value) || value.status !== 'completed' || !Array.isArray(value.output)) {
    throw new HttpError(422, 'Azure truncó, filtró o no completó la respuesta. No se ha creado ninguna versión.');
  }
  const text: string[] = [];
  for (const item of value.output) {
    if (!record(item)) throw new HttpError(422, 'Azure devolvió una salida no válida.');
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message' || item.role !== 'assistant' || (item.status !== undefined && item.status !== 'completed') || !Array.isArray(item.content)) {
      throw new HttpError(422, 'Azure devolvió una salida no admitida. Solo se acepta configuración JSON.');
    }
    for (const content of item.content) {
      if (!record(content) || content.type !== 'output_text' || typeof content.text !== 'string') {
        throw new HttpError(422, 'El modelo rechazó la petición o no devolvió texto JSON válido.');
      }
      text.push(content.text);
    }
  }
  try { return JSON.parse(text.join('')); }
  catch { throw new HttpError(422, 'El modelo no devolvió configuración JSON válida. No se ha creado ninguna versión.'); }
}
async function callAzure(request: Request, settings: Credentials, apiKey: string, prompt: string | null, previous: DashboardConfig | null): Promise<unknown> {
  const isTest = prompt === null;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  let endpoint: string;
  try { endpoint = normalizeAzureEndpoint(settings.endpoint); }
  catch { throw new HttpError(503, 'El endpoint Azure guardado no es válido. Administración debe volver a guardarlo.'); }
  const instructions = isTest ? 'Return only the JSON object {"ok":true}.'
    : `You compose Tektonik hub dashboards. Return ONLY one JSON dashboard configuration conforming to the provided schema. Never return HTML, JavaScript, executable expressions, URLs, credentials or extra keys. Data must be synthetic, with at most 100 rows and 12 components. Interpret the user intent and preserve prior data and components unless explicitly asked to change them. Never claim external integrations or real data.\n${JSON.stringify(dashboardKit.context(prompt, previous))}`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        model: settings.deployment, instructions,
        input: isTest ? 'Return {"ok":true}.' : JSON.stringify({ request: prompt, previous }),
        text: { format: { type: 'json_object' } }, max_output_tokens: isTest ? 2048 : 8000, store: false,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new HttpError(502, 'Azure rechazó las credenciales o los permisos del recurso.');
      if (response.status === 429) throw new HttpError(429, 'Azure ha alcanzado su cuota. Inténtalo más tarde.');
      throw new HttpError(502, `Azure rechazó la solicitud (HTTP ${response.status}). Revisa el endpoint, el modelo desplegado y su compatibilidad con Responses y JSON.`);
    }
    if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw new HttpError(502, 'Azure no devolvió una respuesta JSON válida.');
    }
    let body: unknown;
    try { body = JSON.parse(await limitedJSONText(response.body)); }
    catch {
      if (signal.aborted) throw new HttpError(504, 'Petición cancelada o tiempo de espera de Azure agotado.');
      throw new HttpError(502, 'Azure no devolvió JSON válido dentro del límite permitido.');
    }
    return outputJSON(body);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (signal.aborted) throw new HttpError(504, 'Petición cancelada o tiempo de espera de Azure agotado.');
    console.error('Azure request failed', { name: error instanceof Error ? error.name : 'UnknownError' });
    throw new HttpError(502, 'No se pudo conectar con Azure. Revisa la conexión y la configuración del recurso.');
  }
}
async function generate(request: Request, context: Context, orgId: string, prompt: string | null, previous: DashboardConfig | null) {
  const settings = await credentials(context, orgId);
  if (!settings) throw new HttpError(409, 'Configura Azure OpenAI en Admin → LLM Settings.');
  const apiKey = decrypt(settings, orgId);
  const lease = randomUUID();
  if (await rpc(context, 'tk_azure_claim', { p_org: orgId, p_lease: lease }) !== true) {
    throw new HttpError(429, 'Ya hay una petición en curso o se alcanzó el límite de 12 peticiones por minuto de esta empresa.');
  }
  try {
    const current = await credentials(context, orgId);
    if (!current || current.version !== settings.version) throw new HttpError(409, 'La configuración cambió. Vuelve a intentar la generación.');
    const output = await callAzure(request, settings, apiKey, prompt, previous);
    if (prompt === null) {
      if (!record(output) || output.ok !== true || Object.keys(output).length !== 1) throw new HttpError(422, 'El modelo no completó la prueba JSON.');
      return jsonResponse({ ok: true, message: 'Conexión y JSON verificados con Azure Responses v1. La configuración está disponible para esta organización.' });
    }
    return jsonResponse({ config: dashboard(output, true), provider: 'azure-openai', model: settings.deployment });
  } finally {
    await rpc(context, 'tk_azure_release', { p_org: orgId, p_lease: lease });
  }
}
export async function organizationAzure(request: Request, path: string): Promise<Response> {
  try {
    const context = await authenticatedContext();
    if (request.method === 'GET' && path === '/api/session') {
      authorize(context, context.session.orgId);
      return jsonResponse({ csrf: csrfToken(context) });
    }
    if (request.method === 'GET' && path === '/api/llm/settings') {
      const orgId = azureOrganizationSchema.parse(new URL(request.url).searchParams.get('orgId'));
      authorize(context, orgId);
      return jsonResponse(await status(context, orgId));
    }
    if (request.method !== 'POST' || !['/api/llm/settings', '/api/llm/clear', '/api/llm/test', '/api/studio/generate'].includes(path)) {
      throw new HttpError(404, 'Ruta o método no disponibles.');
    }
    validateMutation(request, context);
    const body = await readJson(request, 250_000);
    if (path === '/api/llm/settings') {
      const fields = azureSaveSchema.parse(body);
      authorize(context, fields.orgId, true);
      let apiKey = fields.apiKey;
      if (!apiKey) {
        const current = await credentials(context, fields.orgId);
        if (!current) throw new HttpError(400, 'Introduce una API key para configurar Azure.');
        if (current.version !== fields.version) throw new HttpError(409, 'La configuración cambió. Recarga antes de guardar.');
        apiKey = decrypt(current, fields.orgId);
      }
      await rpc(context, 'tk_azure_save', {
        p_org: fields.orgId, p_endpoint: fields.endpoint, p_deployment: fields.deployment,
        p_api_version: 'v1', p_encrypted_key: encrypt(apiKey, fields.orgId, fields), p_version: fields.version,
      });
      return jsonResponse(await status(context, fields.orgId));
    }
    if (path === '/api/llm/clear') {
      const fields = azureClearSchema.parse(body);
      authorize(context, fields.orgId, true);
      await rpc(context, 'tk_azure_clear', { p_org: fields.orgId, p_version: fields.version });
      return jsonResponse(await status(context, fields.orgId));
    }
    if (path === '/api/llm/test') {
      const { orgId } = azureTestSchema.parse(body);
      authorize(context, orgId, true);
      return await generate(request, context, orgId, null, null);
    }
    const fields = azureGenerationSchema.parse(body);
    authorize(context, fields.orgId);
    const previous = fields.previous === undefined || fields.previous === null ? null : dashboard(fields.previous);
    return await generate(request, context, fields.orgId, fields.prompt, previous);
  } catch (error) { return errorResponse(error); }
}
