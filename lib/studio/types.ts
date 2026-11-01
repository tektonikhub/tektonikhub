export type StudioKind = 'dashboard' | 'calculator' | 'form' | 'kanban';
export type Provider = 'demo' | 'azure-openai';
export type DashboardField = 'date' | 'category' | 'label' | 'value' | 'status';
export type JSONData = null | string | number | boolean | JSONData[] | { [key: string]: JSONData };
export interface DashboardRow { date: string; category: string; label: string; value: number; status: string }
export interface DashboardComponent { id: string; type: 'metric' | 'table' | 'chart' | 'filters' | 'text'; title: string; span?: number; field?: DashboardField; aggregation?: 'sum' | 'avg' | 'count'; chartType?: 'bar' | 'line' | 'donut'; groupBy?: 'category' | 'date' | 'status'; columns?: DashboardField[]; pageSize?: number; fields?: Exclude<DashboardField, 'value'>[]; content?: string }
export interface DashboardConfig { version: 1; title: string; description: string; theme: { dark: boolean; accent: string }; template: 'sales' | 'operations' | 'projects'; data: DashboardRow[]; components: DashboardComponent[] }
export interface StudioSpec { kind: StudioKind; title: string; description: string; accent: string; dark: boolean; compact: boolean; chart: boolean; search: boolean; area: string; dashboard?: DashboardConfig }
export interface StudioEngine { createSpec(prompt: string, previous?: StudioSpec | null): StudioSpec; renderHTML(spec: StudioSpec): string; explainChanges(previous: StudioSpec | null, spec: StudioSpec): string }
export interface DashboardKit { createConfig(prompt: string, previous?: DashboardConfig | null): DashboardConfig; validate(input: unknown): DashboardConfig; renderHTML(input: DashboardConfig): string; context(prompt: string, previous?: DashboardConfig | null): { schema: JSONData; components: JSONData; templates: JSONData; previousConfig: DashboardConfig | null; guidance: string[] }; templates: Record<'sales' | 'operations' | 'projects', DashboardConfig>; registry: Record<string, JSONData>; schema: JSONData }
export interface StudioVersion { id: number; spec: StudioSpec; html: string; provider: Provider; model?: string; createdAt: string; parentId?: number }
export interface StudioMessage { role: 'user' | 'assistant'; text: string; versionId?: number }
export interface StudioActivity { id: number; text: string; createdAt: string; versionId?: number }
export interface SubmissionLink { id: string; ticket: string; versionId: number }
export interface EditingLink { id: string; ticket: string; expectedVersion: number }
export interface FileMetadata { name: string; type: string; size: number }
export interface StudioDraft { schemaVersion: 1; messages: StudioMessage[]; versions: StudioVersion[]; selectedId: number | null; nextVersion: number; submission: SubmissionLink | null; activity?: StudioActivity[]; files?: FileMetadata[]; editing?: EditingLink }
export interface StudioScope { orgId: string; userId: string; editId?: string }
/** Future studio_projects/versions/messages/activity persistence implements this boundary. */
export interface StudioPersistence { load(scope: StudioScope): Promise<StudioDraft | null>; save(scope: StudioScope, draft: StudioDraft): Promise<void>; remove(scope: StudioScope): Promise<void> }
export interface StudioProjectRecord { id: string; legacy_id: string | null; org_id: string; owner_id: string; title: string; current_version: number | null; submitted_app_id: string | null; submitted_version: number | null; revision: number; created_at: string; updated_at: string }
export interface StudioVersionRecord { project_id: string; version: number; prompt: string; generated_html: string; dashboard_config: DashboardConfig | null; engine: Provider; model: string | null; template: string | null; spec: StudioSpec; summary: string; created_at: string }
export interface StudioMessageRecord { project_id: string; position: number; role: StudioMessage['role']; body: string; version: number | null }
export interface StudioActivityRecord { project_id: string; action: string; message: string; created_at: string }
