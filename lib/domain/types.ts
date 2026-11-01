export type Role = 'developer' | 'catalog' | 'admin' | 'superadmin';
export type ReviewStatus = 'pending_review' | 'changes_requested' | 'rejected' | 'approved';
export type ReviewAction = Exclude<ReviewStatus, 'pending_review'>;
export type OrganizationStatus = 'active' | 'active-amber' | 'suspended' | 'pending';
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
export type BrandTokens = { accent: string; bg: string; card: string; fg: string; fgSoft: string; line: string; green: string; amber: string; displayFont: string; bodyFont: string; rCard: string; rSm: string };
export interface Session { userId: string; orgId: string; role: Role }
export type DemoSession = Session;
export interface User { id: string; orgId: string; role: Role; name: string; initials: string; dept: string; email?: string; username?: string; enabled?: boolean; accountStatus?: 'reserved' | 'sent' | 'failed' | 'active'; deletedAt?: string | null }
export interface CompanyProfile { bio: string; bannerTitle: string; bannerDesc: string }
export interface Organization { id: string; name: string; initials: string; plan: string; members: number; compliance: number | null; status: OrganizationStatus; adminId: string; createdAt: string; date: string; domain: string; lastAccess: string; brand?: BrandTokens; profile?: CompanyProfile; apps?: number; pending?: number; system?: boolean }
export interface Attachment { name: string; size: number; type: string }
export interface App { id: string; orgId: string; authorId: string; title: string; area: string; desc: string; longDesc?: string; tagline: string; impact: string; dataNote: string; repoUrl: string; tech: string[]; attachments: Attachment[]; tags: string[]; security: string[]; metrics: { hours: number; users: number; rating: string | number }; reviewStatus: ReviewStatus; maturity: string; version: number; ticket: string; createdAt: string; updatedAt: string; generatedHtml?: string; environment?: string; certificate?: string }
export interface ReviewChecks { security: boolean; data: boolean }
export interface Review { id: string; appId: string; reviewerId: string; reviewerName?: string; action: ReviewAction; reason: string; environment: string; version: number; createdAt: string; checks?: ReviewChecks }
export interface DataEvent { id: string; orgId: string; appId?: string; actorId: string; actorName?: string; action: string; createdAt: string }
export interface Plan { id: string; name: string; price: number | null }
export interface Policy { id: string; name: string; description: string; enabled: boolean; orgId?: string; version?: number; createdAt?: string; updatedAt?: string }
export interface FlowEntry { appId: string; favorite: boolean; createdAt: string }
export interface Dataset { schemaVersion: 1; datasetVersion: string; revision: number; config: { defaultOrgId: string; defaultAuthorId: string; demoRoles: Record<Role, string>; upload: { maxFiles: number; maxBytes: number }; brandDefaults: BrandTokens; brandPresets: Record<string, BrandTokens>; statusLabels: Record<ReviewStatus, string> }; categories: { id: string; label: string }[]; content: Record<string, JSONValue>; organizations: Organization[]; users: User[]; apps: App[]; reviews: Review[]; events: DataEvent[]; plans: Plan[]; policies: Policy[]; myFlow: FlowEntry[] }
export interface SubmissionFields { title: string; desc: string; area: string; tagline?: string; impact?: string; dataNote?: string; repoUrl?: string; aiTool?: string; attachments?: Attachment[]; generatedHtml?: string }
export interface ManagedAppFields extends SubmissionFields { orgId: string; authorId: string; hours: number; users: number }
export interface UserFields { orgId: string; role: Role; name: string; email: string; username?: string; dept?: string }
export interface OrganizationFields { name: string; email: string; domain?: string; plan: string; adminId?: string; members?: number; status?: OrganizationStatus }
export interface CompanyProfileFields { name: string; domain?: string; bio?: string; bannerTitle?: string; bannerDesc?: string }
export interface PolicyFields { name: string; description?: string; enabled: boolean }
export interface PlanFields { name: string; price: number | null }
