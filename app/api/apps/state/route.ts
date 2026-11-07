import { z } from 'zod';
import { authenticatedContext } from '@/lib/server/auth';
import { databaseError, errorResponse, jsonResponse, readJson, sameOrigin } from '@/lib/server/http';
import { appStateSchema, appStateResultSchema } from '@/lib/studio/app-state';

const target = z.object({ appId: z.uuid(), version: z.coerce.number().int().positive().max(2147483647) }).strict();
const command = target.extend({ state: appStateSchema, revision: z.number().int().nonnegative().max(2147483646) }).strict();
export async function GET(request: Request) {
  try {
    const { client } = await authenticatedContext();
    const { appId, version } = target.parse(Object.fromEntries(new URL(request.url).searchParams));
    const response = await client.database.rpc('tk_app_state_read', { p_id: appId, p_version: version });
    if (response.error) databaseError(response.error);
    return jsonResponse(appStateResultSchema.parse(response.data));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { client } = await authenticatedContext();
    const { appId, version, state, revision } = command.parse(await readJson(request, 250000));
    const response = await client.database.rpc('tk_app_state_save', { p_id: appId, p_version: version, p_state: state, p_revision: revision });
    if (response.error) databaseError(response.error);
    return jsonResponse(appStateResultSchema.parse(response.data));
  } catch (error) { return errorResponse(error); }
}
