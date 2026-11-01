import { z } from 'zod';
import { authenticatedContext } from '@/lib/server/auth';
import { databaseError, errorResponse, HttpError, jsonResponse } from '@/lib/server/http';

const querySchema = z.object({ appId: z.uuid(), version: z.coerce.number().int().positive().max(2147483647) }).strict();
const appSchema = z.object({ version: z.number().int().positive(), review_status: z.string() });
const sourceSchema = z.object({ generated_html: z.string().max(300000).nullable() });

export async function GET(request: Request) {
  try {
    const { client, session } = await authenticatedContext();
    if (session.role !== 'developer') throw new HttpError(403, 'Solo el creador puede recuperar un envío para corregirlo.');
    const { appId, version } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const app = await client.database.from('apps').select('version,review_status')
      .eq('id', appId).eq('org_id', session.orgId).eq('author_id', session.userId).is('deleted_at', null).maybeSingle();
    if (app.error) databaseError(app.error);
    if (!app.data) throw new HttpError(404, 'El envío no existe o no pertenece a tu cuenta.');
    const currentResult = appSchema.safeParse(app.data);
    if (!currentResult.success) {
      console.error('InsForge returned an invalid Studio app record');
      throw new HttpError(503, 'InsForge no devolvió una versión válida del envío.');
    }
    const current = currentResult.data;
    if (current.version !== version) throw new HttpError(409, 'El envío cambió de versión. Recarga Studio antes de corregirlo.');
    if (current.review_status !== 'changes_requested') throw new HttpError(409, 'Este envío ya no tiene cambios solicitados.');
    const source = await client.database.from('app_versions').select('generated_html')
      .eq('app_id', appId).eq('org_id', session.orgId).eq('author_id', session.userId).eq('version', version).maybeSingle();
    if (source.error) databaseError(source.error);
    if (!source.data) throw new HttpError(409, 'No se pudo recuperar la versión del envío. Recarga Studio.');
    const sourceResult = sourceSchema.safeParse(source.data);
    if (!sourceResult.success) {
      console.error('InsForge returned an invalid Studio source record');
      throw new HttpError(503, 'InsForge no devolvió un HTML válido del envío.');
    }
    return jsonResponse({ appId, version, generatedHtml: sourceResult.data.generated_html });
  } catch (error) { return errorResponse(error); }
}
