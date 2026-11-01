import type { App, BrandTokens, CompanyProfileFields, Dataset, DemoSession, ManagedAppFields, OrganizationFields, OrganizationStatus, PlanFields, PolicyFields, ReviewAction, ReviewChecks, Role, SubmissionFields, User, UserFields } from '../domain/types';
export type * from '../domain/types';

/** Production identity and permissions are verified by the server and PostgreSQL. */
export interface BLKRepository {
  initialize(): Promise<void>;
  getSnapshot(): Dataset;
  getSession(): DemoSession | null;
  getError(): Error | null;
  subscribe(listener: () => void): () => void;
  destroy(): void;
  clearSession(): Promise<void>;
  setRole(role: Role, orgId?: string): Promise<User>;
  reset(): Promise<void>;
  exportData(): Dataset;
  createSubmission(fields: SubmissionFields): Promise<App>;
  updateSubmission(id: string, fields: SubmissionFields, expectedVersion: number): Promise<App>;
  reviewApp(id: string, action: ReviewAction, reason: string, environment: string, expectedVersion: number, checks?: ReviewChecks): Promise<void>;
  createOrganization(fields: OrganizationFields): Promise<string>;
  updateOrganization(id: string, fields: OrganizationFields): Promise<void>;
  deleteOrganization(id: string): Promise<void>;
  setOrganizationStatus(id: string, status: OrganizationStatus): Promise<void>;
  saveUser(id: string | null, fields: UserFields): Promise<string>;
  deleteUser(id: string): Promise<void>;
  inviteUser(id: string): Promise<void>;
  setUserEnabled(id: string, enabled: boolean): Promise<void>;
  saveCompanyProfile(id: string, fields: CompanyProfileFields): Promise<void>;
  deleteCompanyProfile(id: string): Promise<void>;
  saveManagedApp(id: string | null, fields: ManagedAppFields, expectedVersion?: number): Promise<string>;
  deleteManagedApp(id: string, version: number): Promise<void>;
  savePlan(id: string | null, fields: PlanFields): Promise<string>;
  deletePlan(id: string): Promise<void>;
  savePolicy(id: string | null, fields: PolicyFields): Promise<string>;
  deletePolicy(id: string): Promise<void>;
  saveGovernancePolicy(id: string | null, fields: PolicyFields, expectedVersion?: number): Promise<string>;
  deleteGovernancePolicy(id: string, version: number): Promise<void>;
  saveBrand(tokens: BrandTokens): Promise<void>;
}
export interface RepositoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface RepositoryStorageEvent { key: string | null }
export interface RepositoryEventTarget { addEventListener(type: 'storage', listener: (event: RepositoryStorageEvent) => void): void; removeEventListener(type: 'storage', listener: (event: RepositoryStorageEvent) => void): void }
export interface LocalRepositoryOptions { storage: RepositoryStorage; sessionStorage: RepositoryStorage; eventTarget?: RepositoryEventTarget; fetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>; clock?: () => Date; uuid?: () => string }
