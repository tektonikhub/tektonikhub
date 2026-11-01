import { z } from 'zod';
import { authenticatedContext, workspaceForUser } from '@/lib/server/auth';
import { identityAdminClient } from '@/lib/server/insforge';
import { sendAccountActivation } from '@/lib/server/invitations';
import { databaseError, errorResponse, jsonResponse, readJson, sameOrigin } from '@/lib/server/http';
import { brandSchema } from '@/lib/data/validation';

const uuid = z.uuid();
const natural = z.number().int().nonnegative().safe();
const optionalText = (max: number) => z.string().trim().max(max).optional();
const submission = z.object({
  title: z.string().trim().min(1).max(60), desc: z.string().trim().min(30).max(800), area: z.string().max(64),
  tagline: optionalText(100), impact: optionalText(500), dataNote: optionalText(2000), repoUrl: optionalText(1000),
  aiTool: optionalText(100), generatedHtml: z.string().max(300000).optional(),
  attachments: z.array(z.object({ name: z.string().trim().min(1).max(255), size: natural, type: z.string().max(128) }).strict())
    .max(10).refine(files => files.reduce((total, file) => total + file.size, 0) <= 26214400).optional(),
});
const company = z.object({ name: z.string().trim().min(1).max(120), domain: optionalText(253) });
const organization = company.extend({ email: z.email().max(254), plan: uuid });
const policy = z.object({ name: z.string().trim().min(1).max(120), description: optionalText(3000), enabled: z.boolean() }).strict();
const validators = {
  createSubmission: submission.strict(),
  updateSubmission: submission.strict(),
  saveManagedApp: submission.extend({ orgId: uuid, authorId: uuid, hours: natural, users: natural }).strict(),
  reviewApp: z.object({ action: z.enum(['approved', 'rejected', 'changes_requested']), reason: z.string().trim().max(3000),
    environment: z.string().trim().max(200), checks: z.object({ security: z.boolean(), data: z.boolean() }).strict().optional() }).strict(),
  deleteManagedApp: z.object({}).strict(),
  createOrganization: organization.strict(),
  updateOrganization: organization.extend({ adminId: uuid, members: natural, status: z.enum(['active', 'active-amber', 'pending', 'suspended']) }).strict(),
  deleteOrganization: z.object({}).strict(),
  setOrganizationStatus: z.object({ status: z.enum(['active', 'suspended']) }).strict(),
  saveUser: z.object({ orgId: uuid, role: z.enum(['developer', 'catalog', 'admin', 'superadmin']), name: z.string().trim().min(1).max(120),
    email: z.email().max(254), username: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/), dept: optionalText(120) }).strict(),
  deleteUser: z.object({}).strict(),
  inviteUser: z.object({}).strict(),
  setUserEnabled: z.object({ enabled: z.boolean() }).strict(),
  saveCompanyProfile: company.extend({ bio: optionalText(2000), bannerTitle: optionalText(160), bannerDesc: optionalText(2000) }).strict(),
  deleteCompanyProfile: z.object({}).strict(),
  saveBrand: brandSchema,
  savePlan: z.object({ name: z.string().trim().min(1).max(100), price: z.number().finite().nonnegative().nullable() }).strict(),
  deletePlan: z.object({}).strict(),
  savePolicy: policy, deletePolicy: z.object({}).strict(),
  saveGovernancePolicy: policy, deleteGovernancePolicy: z.object({}).strict(),
};
const commandSchema = z.object({
  action: z.enum(Object.keys(validators)), id: uuid.nullable(), fields: z.unknown(),
  version: z.number().int().positive().optional(),
}).strict();
export async function GET() {
  try { return jsonResponse(await workspaceForUser()); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { client } = await authenticatedContext();
    const input = commandSchema.parse(await readJson(request));
    const key = z.enum([
      'createSubmission', 'updateSubmission', 'saveManagedApp', 'reviewApp', 'deleteManagedApp',
      'createOrganization', 'updateOrganization', 'deleteOrganization', 'setOrganizationStatus',
      'saveUser', 'deleteUser', 'inviteUser', 'setUserEnabled', 'saveCompanyProfile', 'deleteCompanyProfile',
      'saveBrand', 'savePlan', 'deletePlan', 'savePolicy', 'deletePolicy', 'saveGovernancePolicy', 'deleteGovernancePolicy',
    ]).parse(input.action);
    const fields = validators[key].parse(input.fields);
    const result = await client.database.rpc('tk_command', { p_action: key, p_id: input.id, p_fields: fields, p_version: input.version ?? null });
    if (result.error) databaseError(result.error);
    const value = z.object({ id: uuid, invitationUserId: uuid.optional() }).parse(result.data);
    if (value.invitationUserId) await sendAccountActivation(identityAdminClient(), value.invitationUserId);
    return jsonResponse({ id: value.id });
  } catch (error) { return errorResponse(error); }
}
