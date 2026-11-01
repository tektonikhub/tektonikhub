import { forwardLocalLLM } from '@/lib/server/local-llm';
export const runtime = 'nodejs';
export async function POST(request: Request) { return forwardLocalLLM(request, '/api/studio/generate'); }
