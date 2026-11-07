import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import dashboardKit from '@/lib/studio/runtime/dashboard-kit.js';
import { record } from '@/lib/studio/draft';
import type { LLMStatus } from '@/lib/studio/llm';
import type { DashboardConfig } from '@/lib/studio/types';
import { STUDIO_GENERATION_TIMEOUT, type StudioCompletion } from '@/lib/studio/generation';
import { generateHTMLApplication, type PreviousStudioApplication } from '@/lib/studio/html-generation';
import { validateGeneratedHTML } from '@/lib/studio/html-validation';
import { generationStream, GENERATION_STREAM_TYPE, type GenerationStage } from '@/lib/studio/generation-stream';
import { authenticatedContext } from './auth';
import { azureClearSchema, azureGenerationSchema, azureOrganizationSchema, azureRequestError, azureSaveSchema, azureTestSchema, normalizeAzureEndpoint } from './azure-policy';
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
  if (!Array.isArray(data)) throw new HttpError(503, 'No se pudo leer la configuración Azure.');
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
  if (!Array.isArray(data)) throw new HttpError(503, 'No se pudo leer la configuración Azure.');
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
function abortedAzure(signal: AbortSignal): HttpError {
  return signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    ? new HttpError(504, 'Azure agotó el plazo de generación. Inténtalo de nuevo; si se repite, IT debe revisar la latencia y la cuota del deployment.')
    : new HttpError(499, 'La petición fue cancelada por el cliente.');
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
async function callAzure(settings: Credentials, apiKey: string, completion: Pick<StudioCompletion, 'instructions' | 'input' | 'maxOutputTokens'>, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  let endpoint: string;
  try { endpoint = normalizeAzureEndpoint(settings.endpoint); }
  catch { throw new HttpError(503, 'El endpoint Azure guardado no es válido. Administración debe volver a guardarlo.'); }
  try {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        model: settings.deployment, instructions: completion.instructions, input: completion.input,
        text: { format: { type: 'json_object' } }, max_output_tokens: completion.maxOutputTokens, store: false,
      }),
    });
    if (!response.ok) {
      if ([401, 403, 429].includes(response.status)) {
        await response.body?.cancel();
        if (response.status === 429) throw new HttpError(429, 'Azure ha alcanzado su cuota. Inténtalo más tarde.');
        throw new HttpError(502, 'Azure rechazó las credenciales o los permisos del recurso.');
      }
      let details: unknown;
      try { details = JSON.parse(await limitedJSONText(response.body, 16_384)); }
      catch (error) {
        if (signal.aborted) throw abortedAzure(signal);
        console.warn('Azure error response could not be read', { status: response.status, name: error instanceof Error ? error.name : 'UnknownError' });
      }
      throw new HttpError(502, azureRequestError(response.status, details));
    }
    if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw new HttpError(502, 'Azure no devolvió una respuesta JSON válida.');
    }
    let body: unknown;
    try { body = JSON.parse(await limitedJSONText(response.body, 2_600_000)); }
    catch {
      if (signal.aborted) throw abortedAzure(signal);
      throw new HttpError(502, 'Azure no devolvió JSON válido dentro del límite permitido.');
    }
    return outputJSON(body);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (signal.aborted) throw abortedAzure(signal);
    console.error('Azure request failed', { name: error instanceof Error ? error.name : 'UnknownError' });
    throw new HttpError(502, 'No se pudo conectar con Azure. Revisa la conexión y la configuración del recurso.');
  }
}
async function generate(request: Request, context: Context, orgId: string, prompt: string | null, previous: PreviousStudioApplication | null) {
  const settings = await credentials(context, orgId);
  if (!settings) throw new HttpError(409, 'Configura Azure OpenAI en Admin → LLM Settings.');
  const apiKey = decrypt(settings, orgId);
  const lease = randomUUID();
  if (await rpc(context, 'tk_azure_claim', { p_org: orgId, p_lease: lease }) !== true) {
    throw new HttpError(429, 'Ya hay una petición en curso o se alcanzó el límite de 12 peticiones por minuto de esta empresa.');
  }
  const run = async (progress: (stage: GenerationStage) => void, cancellation: AbortSignal) => {
    // The 240-second model budget fits inside both the 300-second lease and hosting limit.
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(prompt === null ? 30_000 : STUDIO_GENERATION_TIMEOUT)]);
    const started = Date.now();
    let stage: GenerationStage = 'expand';
    try {
      signal.throwIfAborted();
      const current = await credentials(context, orgId);
      if (!current || current.version !== settings.version) throw new HttpError(409, 'La configuración cambió. Vuelve a intentar la generación.');
      if (prompt === null) {
        const output = await callAzure(settings, apiKey, { instructions: 'Return only the JSON object {"ok":true}.', input: 'Return only the JSON object {"ok":true}.', maxOutputTokens: 2048 }, signal);
        if (!record(output) || output.ok !== true || Object.keys(output).length !== 1) throw new HttpError(422, 'El modelo no completó la prueba JSON.');
        return { ok: true, message: 'Conexión y JSON verificados con Azure Responses v1. La configuración está disponible para esta organización.' };
      }
      const result = await generateHTMLApplication(prompt, previous, async completion => {
        stage = completion.stage;
        progress(stage);
        const callStarted = Date.now();
        const output = await callAzure(settings, apiKey, completion, signal);
        console.info('Studio Azure phase completed', { operation: lease, stage, durationMs: Date.now() - callStarted });
        return output;
      }, validateGeneratedHTML);
      stage = 'validate';
      progress(stage);
      signal.throwIfAborted();
      return { ...result, provider: 'azure-openai', model: settings.deployment };
    } catch (error) {
      console.warn('Studio Azure operation failed', { operation: lease, stage, elapsedMs: Date.now() - started, status: error instanceof HttpError ? error.status : undefined, aborted: signal.aborted });
      if (signal.aborted) throw abortedAzure(signal);
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, 'No se pudo completar una aplicación válida con el alcance diseñado. No se ha creado ninguna versión; la anterior se conserva.');
    } finally {
      try { await rpc(context, 'tk_azure_release', { p_org: orgId, p_lease: lease }); }
      catch { console.error('Studio Azure lease release failed', { operation: lease }); }
    }
  };
  if (prompt !== null && request.headers.get('accept')?.includes(GENERATION_STREAM_TYPE)) {
    return generationStream(run, request.signal, error => error instanceof HttpError
      ? { status: error.status, error: error.message }
      : { status: 503, error: 'No se pudo completar la generación.' });
  }
  return jsonResponse(await run(() => {}, request.signal));
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
    // JSON escaping can expand a 200 KB prior HTML document to over one megabyte.
    const body = await readJson(request, path === '/api/studio/generate' ? 1_300_000 : 250_000);
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
    let previous: PreviousStudioApplication | null = null;
    if (fields.previous !== undefined && fields.previous !== null) {
      if (record(fields.previous) && fields.previous.format === 'html') {
        try { previous = validateGeneratedHTML(fields.previous); }
        catch { throw new HttpError(400, 'La aplicación HTML previa no es válida. La versión anterior se conserva.'); }
      } else previous = dashboard(fields.previous);
    }
    return await generate(request, context, fields.orgId, fields.prompt, previous);
  } catch (error) { return errorResponse(error); }
}
