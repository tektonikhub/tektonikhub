import type { DashboardKit, FileMetadata, StudioDraft, StudioPersistence, StudioScope, StudioSpec, StudioVersion, StudioMessage } from './types';
export const MAX_VERSIONS = 8, MAX_MESSAGES = 40, MAX_HTML_BYTES = 200_000, MAX_DRAFT_BYTES = 3_000_000;
export const bytes = (text: string) => new TextEncoder().encode(text).length;
export function blankDraft(): StudioDraft { return { schemaVersion: 1, messages: [], versions: [], selectedId: null, nextVersion: 1, submission: null, files: [] }; }
export function draftKey(scope: StudioScope) { return `blkunit:studio:v1:${scope.orgId}:${scope.userId}:${scope.editId || 'new'}`; }
export function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function spec(value: unknown, kit: Pick<DashboardKit, 'validate'>): StudioSpec {
  if (!record(value) || typeof value.kind!=='string' || !['dashboard','calculator','form','kanban'].includes(value.kind) || !text(value.title,160) || !text(value.description,800) || !text(value.area,80) || !text(value.accent,16) || !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value.accent)) throw new Error('Especificación de versión inválida.');
  for (const key of ['dark','compact','chart','search']) if (typeof value[key] !== 'boolean') throw new Error('Opciones de versión inválidas.');
  return { kind: value.kind as StudioSpec['kind'], title:value.title,description:value.description,area:value.area,accent:value.accent,dark:value.dark === true,compact:value.compact === true,chart:value.chart === true,search:value.search === true, ...(value.dashboard ? { dashboard: kit.validate(value.dashboard) } : {}) };
}
export function validateFiles(input: unknown, maxFiles = 12, maxBytes = 25_000_000): FileMetadata[] {
  if (!Array.isArray(input) || input.length > maxFiles) throw new Error('Demasiados adjuntos.');
  let total = 0;
  const files = input.map((file: unknown) => {
    if (!record(file) || !text(file.name,180) || !file.name.trim() || /[\\/\u0000-\u001f]/.test(file.name) || !text(file.type,120) || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Metadatos de archivo inválidos.');
    total += file.size; return { name:file.name,type:file.type,size:file.size };
  });
  if (total > maxBytes) throw new Error('El tamaño total supera el límite de adjuntos.');
  if (new Set(files.map(file=>file.name)).size !== files.length) throw new Error('Hay nombres de archivo duplicados.');
  return files;
}
export function parseDraft(raw: string, kit: Pick<DashboardKit, 'validate'>): StudioDraft {
  if (bytes(raw) > MAX_DRAFT_BYTES) throw new Error('Borrador demasiado grande.');
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.versions) || value.versions.length > MAX_VERSIONS || !Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES || !integer(value.nextVersion)) throw new Error('Borrador no compatible.');
  const nextVersion = value.nextVersion;
  const versions = value.versions.map((version: unknown): StudioVersion => {
    if (!record(version) || !integer(version.id) || !text(version.html,300_000) || bytes(version.html) > 300_000 || !text(version.createdAt,80) || !Number.isFinite(Date.parse(version.createdAt)) || (version.provider !== undefined && (typeof version.provider!=='string'||!['demo','azure-openai'].includes(version.provider))) || (version.model !== undefined && !text(version.model,128)) || (version.parentId !== undefined && !integer(version.parentId))) throw new Error('Versión inválida.');
    return {id:version.id,html:version.html,spec:spec(version.spec,kit),createdAt:version.createdAt,provider:version.provider === 'azure-openai' ? 'azure-openai':'demo',...(typeof version.model === 'string'?{model:version.model}:{}),...(typeof version.parentId === 'number'?{parentId:version.parentId}:{})};
  });
  if (new Set(versions.map(v=>v.id)).size !== versions.length || versions.some(v=>v.id >= nextVersion)) throw new Error('Numeración inválida.');
  if (value.selectedId !== null && (!integer(value.selectedId) || !versions.some(v=>v.id === value.selectedId))) throw new Error('Versión seleccionada inexistente.');
  const messages = value.messages.map((message: unknown): StudioMessage => {
    if (!record(message) || (message.role !== 'user' && message.role !== 'assistant') || !text(message.text,4000) || (message.versionId !== undefined && !integer(message.versionId))) throw new Error('Conversación inválida.');
    return {role:message.role,text:message.text,...(typeof message.versionId === 'number'?{versionId:message.versionId}:{})};
  });
  const draft: StudioDraft = {schemaVersion:1,versions,messages,selectedId:value.selectedId as number|null,nextVersion:value.nextVersion,submission:null,files:validateFiles(value.files ?? [])};
  if (value.submission != null) { const link=value.submission; if (!record(link) || !text(link.id,100) || !text(link.ticket,100) || !integer(link.versionId)) throw new Error('Ticket inválido.'); draft.submission={id:link.id,ticket:link.ticket,versionId:link.versionId}; }
  if (value.editing !== undefined) { const edit=value.editing; if (!record(edit)||!text(edit.id,100)||!text(edit.ticket,100)||!integer(edit.expectedVersion)) throw new Error('Edición inválida.'); draft.editing={id:edit.id,ticket:edit.ticket,expectedVersion:edit.expectedVersion}; }
  if (value.activity !== undefined) { if (!Array.isArray(value.activity)||value.activity.length>40) throw new Error('Actividad inválida.'); draft.activity=value.activity.map((item:unknown)=>{if(!record(item)||!integer(item.id)||!text(item.text,1000)||!text(item.createdAt,80)||!Number.isFinite(Date.parse(item.createdAt))||(item.versionId!==undefined&&!integer(item.versionId)))throw new Error('Actividad inválida.');return{id:item.id,text:item.text,createdAt:item.createdAt,...(typeof item.versionId==='number'?{versionId:item.versionId}:{})};}); }
  return draft;
}
export function addVersion(draft: StudioDraft, version: Omit<StudioVersion,'id'>, explanation: string): StudioDraft {
  if (bytes(version.html)>MAX_HTML_BYTES) throw new Error('El HTML supera 200 KB.');
  const id=draft.nextVersion;
  return {...draft,nextVersion:id+1,selectedId:id,versions:[...draft.versions,{...version,id}].slice(-MAX_VERSIONS),messages:[...draft.messages,{role:'assistant' as const,text:explanation.slice(0,4000),versionId:id}].slice(-MAX_MESSAGES)};
}
export function restoreVersion(draft: StudioDraft, id: number): StudioDraft { if (!draft.versions.some(v=>v.id===id)) throw new Error('Versión no disponible.'); return {...draft,selectedId:id}; }
export function branchVersion(draft: StudioDraft, id: number): StudioDraft {
  const source=draft.versions.find(version=>version.id===id);if(!source)throw new Error('Versión no disponible.');
  return addVersion(draft,{spec:source.spec,html:source.html,provider:source.provider,...(source.model?{model:source.model}:{}),parentId:id,createdAt:new Date().toISOString()},`Rama creada desde v${id}. La configuración y los datos se conservan sin cambios.`);
}
export function localPersistence(kit: Pick<DashboardKit,'validate'>): StudioPersistence {
  return {async load(scope){const raw=localStorage.getItem(draftKey(scope));return raw===null?null:parseDraft(raw,kit);},async save(scope,draft){const raw=JSON.stringify(draft);if(bytes(raw)>MAX_DRAFT_BYTES)throw new Error('Borrador demasiado grande.');localStorage.setItem(draftKey(scope),raw);},async remove(scope){localStorage.removeItem(draftKey(scope));}};
}
