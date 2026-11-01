import { z } from 'zod';
import { authenticatedContext } from '@/lib/server/auth';
import { databaseError, errorResponse, HttpError, jsonResponse } from '@/lib/server/http';

const querySchema = z.object({ appId: z.uuid(), version: z.coerce.number().int().positive().max(2147483647) }).strict();
const appSchema = z.object({ version: z.number().int().positive(), review_status: z.literal('approved') });
const sourceSchema = z.object({ generated_html: z.string().max(300000).nullable() });

export async function GET(request: Request) {
  try {
    const { client, session } = await authenticatedContext();
    const { appId, version } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const available = await client.database.rpc('tk_can_use_flow_app', { p_id: appId });
    if (available.error) databaseError(available.error);
    if (typeof available.data !== 'boolean') {
      console.error('InsForge returned an invalid catalog availability result');
      throw new HttpError(503, 'InsForge no confirmó la disponibilidad de la aplicación.');
    }
    if (!available.data) throw new HttpError(404, 'Esta aplicación ya no está disponible en el catálogo de tu organización.');
    const app = await client.database.from('apps').select('version,review_status')
      .eq('id', appId).eq('org_id', session.orgId).eq('review_status', 'approved').is('deleted_at', null).maybeSingle();
    if (app.error) databaseError(app.error);
    if (!app.data) throw new HttpError(404, 'Esta aplicación ya no está disponible en el catálogo de tu organización.');
    const current = appSchema.safeParse(app.data);
    if (!current.success) {
      console.error('InsForge returned an invalid approved app record');
      throw new HttpError(503, 'InsForge no devolvió una versión válida de la aplicación.');
    }
    if (current.data.version !== version) throw new HttpError(409, 'La aplicación cambió de versión. Recarga para abrir la versión aprobada.');
    const source = await client.database.from('app_versions').select('generated_html')
      .eq('app_id', appId).eq('org_id', session.orgId).eq('version', version).maybeSingle();
    if (source.error) databaseError(source.error);
    if (!source.data) throw new HttpError(409, 'La versión aprobada ya no está disponible. Recarga la aplicación.');
    const document = sourceSchema.safeParse(source.data);
    if (!document.success) {
      console.error('InsForge returned an invalid approved app source');
      throw new HttpError(503, 'InsForge no devolvió un HTML válido de la aplicación.');
    }
    if (!document.data.generated_html?.trim()) throw new HttpError(409, 'Esta aplicación no tiene HTML guardado. Su creador debe enviar una versión desde Studio.');
    return jsonResponse({ appId, version, generatedHtml: document.data.generated_html });
  } catch (error) { return errorResponse(error); }
}
