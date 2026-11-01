import { organizationAzure } from '@/lib/server/azure';
export const runtime = 'nodejs';
export async function GET(request: Request) { return organizationAzure(request, '/api/session'); }
