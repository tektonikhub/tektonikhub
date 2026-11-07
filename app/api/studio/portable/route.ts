import { z } from 'zod';
import { authenticatedContext } from '@/lib/server/auth';
import { databaseError, errorResponse, HttpError, jsonResponse, readJson, sameOrigin } from '@/lib/server/http';
import { pendingPortableFiles, portableManifest } from '@/lib/server/portable';
import { portableMetadataListSchema } from '@/lib/studio/portable-manifest';
import { studioRoles } from '@/lib/auth/policy';

const versionSchema = z.number().int().positive().max(2147483647);
const fieldsSchema = z.object({
  title: z.string().trim().min(1).max(60), desc: z.string().trim().min(30).max(800), area: z.string().min(1).max(64),
  tagline: z.string().trim().max(100).optional(), impact: z.string().trim().max(500).optional(),
  dataNote: z.string().trim().max(2000).optional(), repoUrl: z.string().trim().max(1000).optional(),
}).strict();
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reserve'), files: portableMetadataListSchema }).strict(),
  z.object({ action: z.literal('submit'), uploadId: z.uuid(), fields: fieldsSchema, id: z.uuid().optional(), version: versionSchema.optional() }).strict()
    .refine(value => Boolean(value.id) === Boolean(value.version), 'La corrección necesita el ID y la versión actual.'),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { client, session } = await authenticatedContext();
    if (!studioRoles.includes(session.role)) throw new HttpError(403, 'Esta cuenta no tiene acceso a Studio.');
    const input = inputSchema.parse(await readJson(request, 20000));
    if (input.action === 'reserve') {
      const result = await client.database.rpc('tk_portable_reserve', { p_files: input.files });
      if (result.error) databaseError(result.error);
      return jsonResponse(z.object({ id: z.uuid() }).parse(result.data));
    }
    const files = await pendingPortableFiles(client, input.uploadId);
    const html = files.find(file => file.type === 'text/html')!;
    const result = await client.database.rpc('tk_portable_submit', {
      p_upload: input.uploadId, p_fields: { ...input.fields, generatedHtml: html.content },
      p_id: input.id ?? null, p_version: input.version ?? null,
    });
    if (result.error) databaseError(result.error);
    return jsonResponse(z.object({ id: z.uuid() }).parse(result.data));
  } catch (error) { return errorResponse(error); }
}
export async function GET(request: Request) {
  try {
    const { client, session } = await authenticatedContext();
    if (!studioRoles.includes(session.role)) throw new HttpError(403, 'Esta cuenta no tiene acceso a Studio.');
    const query = z.object({ appId: z.uuid(), version: z.coerce.number().int().positive().max(2147483647) }).strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const app = await client.database.from('apps').select('version,author_id,review_status')
      .eq('id', query.appId).is('deleted_at', null).maybeSingle();
    if (app.error) databaseError(app.error);
    if (!app.data) throw new HttpError(404, 'Aplicación no disponible.');
    if (app.data.version !== query.version) throw new HttpError(409, 'La aplicación cambió de versión. Recarga para revisarla.');
    if (session.role === 'developer' && (app.data.author_id !== session.userId || app.data.review_status !== 'changes_requested')) {
      throw new HttpError(403, 'Solo puedes recuperar tus aplicaciones pendientes de corrección.');
    }
    const manifest = await portableManifest(client, query.appId, query.version);
    if (!manifest) throw new HttpError(404, 'Esta versión no contiene un bundle HTML / JSON portable.');
    return jsonResponse(manifest);
  } catch (error) { return errorResponse(error); }
}
