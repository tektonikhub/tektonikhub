import { organizationAzure } from '@/lib/server/azure';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) { return organizationAzure(request, '/api/studio/generate'); }
