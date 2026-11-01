import { organizationAzure } from '@/lib/server/azure';
export const runtime = 'nodejs';
export const maxDuration = 90;
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context) { const { path } = await context.params; return organizationAzure(request, `/api/llm/${path.join('/')}`); }
export const GET = handler;
export const POST = handler;
