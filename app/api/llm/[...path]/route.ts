import { forwardLocalLLM } from '@/lib/server/local-llm';
export const runtime = 'nodejs';
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context) { const { path } = await context.params; return forwardLocalLLM(request, `/api/llm/${path.join('/')}`); }
export const GET = handler;
export const POST = handler;
