import { z } from 'zod';
import type { BLKRepository } from './repository';
import type { App, BrandTokens, CompanyProfileFields, Dataset, ManagedAppFields, OrganizationFields, OrganizationStatus, PlanFields, PolicyFields, ReviewAction, ReviewChecks, Role, Session, SubmissionFields, User, UserFields } from '@/lib/domain/types';
import { validateDataset, validateSession } from './validation';
import type { WorkspaceState } from './workspace';
import { ApiError, announceAuthChange, requestJson } from './http-client';

export class RemoteBLKRepository implements BLKRepository {
  private data: Dataset;
  private session: Session | null;
  private error: Error | null = null;
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private destroyed = false;
  private initialized = false;
  constructor(initial: WorkspaceState, private readonly fetcher: typeof fetch = globalThis.fetch) {
    this.data = validateDataset(initial.data, { scoped: true });
    this.session = validateSession(initial.session);
  }
  private emit() { if (!this.destroyed) for (const listener of this.listeners) listener(); }
  private invalidate() {
    this.session = null;
    this.data = { ...this.data, organizations: [], users: [], apps: [], reviews: [], events: [], plans: [], policies: [], myFlow: [] };
    this.emit();
  }
  private async request(url: string, init?: RequestInit) {
    try { return await requestJson(url, init, this.fetcher); }
    catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'ACCOUNT_BLOCKED')) this.invalidate();
      throw error;
    }
  }
  async refresh(): Promise<void> {
    const raw = z.object({ data: z.unknown(), session: z.unknown() }).parse(await this.request('/api/workspace'));
    const data = validateDataset(raw.data, { scoped: true });
    const session = validateSession(raw.session);
    if (!data.users.some(user => user.id === session.userId && user.orgId === session.orgId && user.role === session.role && user.enabled !== false && !user.deletedAt)) {
      throw new Error('El servidor devolvió una cuenta inconsistente.');
    }
    if (this.destroyed) return;
    this.data = data; this.session = session; this.error = null; this.emit();
  }
  private readonly probe = async () => {
    if (document.visibilityState !== 'visible' || this.destroyed) return;
    try {
      const session = validateSession(await this.request('/api/auth/session'));
      if (session.userId !== this.session?.userId || session.orgId !== this.session.orgId || session.role !== this.session.role) window.location.reload();
    } catch (error) {
      if (this.session) { this.error = error instanceof Error ? error : new Error('No se pudo comprobar la sesión.'); this.emit(); }
    }
  };
  async initialize(): Promise<void> {
    if (this.destroyed) throw new Error('Repositorio destruido.');
    if (this.initialized) return;
    this.initialized = true;
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.probe);
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('tektonik-session');
        this.channel.onmessage = event => {
          const message = z.object({ type: z.enum(['auth_changed', 'workspace_changed']) }).safeParse(event.data);
          if (!message.success) return;
          if (message.data.type === 'auth_changed') window.location.reload();
          else void this.refresh().catch(error => { this.error = error instanceof Error ? error : new Error('No se pudieron cargar los cambios.'); this.emit(); });
        };
      }
    }
  }
  getSnapshot(): Dataset { return this.data; }
  getSession(): Session | null { return this.session; }
  getError(): Error | null { return this.error; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  destroy(): void {
    this.destroyed = true; this.listeners.clear(); this.channel?.close();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.probe);
  }
  async clearSession(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST' });
    this.invalidate();
    announceAuthChange();
  }
  async setRole(role: Role, orgId?: string): Promise<User> { void role; void orgId; throw new Error('El rol y la empresa se obtienen de la cuenta verificada; no se pueden seleccionar.'); }
  async reset(): Promise<void> { throw new Error('Los datos reales no se restablecen desde el navegador.'); }
  exportData(): Dataset { return structuredClone(this.data); }
  private async command(action: string, id: string | null, fields: unknown = {}, version?: number) {
    let result: { id: string };
    try {
      result = z.object({ id: z.string() }).parse(await this.request('/api/workspace', {
        method: 'POST', body: JSON.stringify({ action, id, fields, ...(version === undefined ? {} : { version }) }),
      }));
    } catch (error) {
      if (error instanceof ApiError && [409, 502].includes(error.status) && this.session) await this.refresh();
      throw error;
    }
    await this.refresh();
    this.channel?.postMessage({ type: 'workspace_changed' });
    return result.id;
  }
  private app(id: string): App {
    const value = this.data.apps.find(app => app.id === id);
    if (!value) throw new Error('El envío se guardó, pero no se pudo recuperar. Recarga el espacio.');
    return value;
  }
  async createSubmission(fields: SubmissionFields) { return this.app(await this.command('createSubmission', null, fields)); }
  async updateSubmission(id: string, fields: SubmissionFields, version: number) { return this.app(await this.command('updateSubmission', id, fields, version)); }
  async reviewApp(id: string, action: ReviewAction, reason: string, environment: string, version: number, checks?: ReviewChecks) { await this.command('reviewApp', id, { action, reason, environment, checks }, version); }
  createOrganization(fields: OrganizationFields) { return this.command('createOrganization', null, fields); }
  async updateOrganization(id: string, fields: OrganizationFields) { await this.command('updateOrganization', id, fields); }
  async deleteOrganization(id: string) { await this.command('deleteOrganization', id); }
  async setOrganizationStatus(id: string, status: OrganizationStatus) { await this.command('setOrganizationStatus', id, { status }); }
  saveUser(id: string | null, fields: UserFields) { return this.command('saveUser', id, fields); }
  async deleteUser(id: string) { await this.command('deleteUser', id); }
  async inviteUser(id: string) { await this.command('inviteUser', id); }
  async setUserEnabled(id: string, enabled: boolean) { await this.command('setUserEnabled', id, { enabled }); }
  async saveCompanyProfile(id: string, fields: CompanyProfileFields) { await this.command('saveCompanyProfile', id, fields); }
  async deleteCompanyProfile(id: string) { await this.command('deleteCompanyProfile', id); }
  saveManagedApp(id: string | null, fields: ManagedAppFields, version?: number) { return this.command('saveManagedApp', id, fields, version); }
  async deleteManagedApp(id: string, version: number) { await this.command('deleteManagedApp', id, {}, version); }
  savePlan(id: string | null, fields: PlanFields) { return this.command('savePlan', id, fields); }
  async deletePlan(id: string) { await this.command('deletePlan', id); }
  savePolicy(id: string | null, fields: PolicyFields) { return this.command('savePolicy', id, fields); }
  async deletePolicy(id: string) { await this.command('deletePolicy', id); }
  saveGovernancePolicy(id: string | null, fields: PolicyFields, version?: number) { return this.command('saveGovernancePolicy', id, fields, version); }
  async deleteGovernancePolicy(id: string, version: number) { await this.command('deleteGovernancePolicy', id, {}, version); }
  async saveBrand(tokens: BrandTokens) { await this.command('saveBrand', null, tokens); }
  async addToFlow(appId: string) { await this.command('addToFlow', appId); }
  async removeFromFlow(appId: string) { await this.command('removeFromFlow', appId); }
  async setFlowFavorite(appId: string, favorite: boolean) { await this.command('setFlowFavorite', appId, { favorite }); }
}
