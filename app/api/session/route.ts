import { forwardLocalLLM } from '@/lib/server/local-llm';
export const runtime = 'nodejs';
export async function GET(request: Request) { return forwardLocalLLM(request, '/api/session'); }
