import { authenticatedContext } from '@/lib/server/auth';
import { errorResponse, jsonResponse } from '@/lib/server/http';
export async function GET() {
  try { return jsonResponse((await authenticatedContext()).session); }
  catch (error) { return errorResponse(error); }
}
