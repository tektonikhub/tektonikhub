import type { StudioActivityRecord, StudioDraft, StudioMessageRecord, StudioProjectRecord, StudioScope, StudioVersionRecord } from './types';
export interface StudioDatabaseSnapshot { project: StudioProjectRecord; versions: StudioVersionRecord[]; messages: StudioMessageRecord[]; activity: StudioActivityRecord[] }
export interface StudioDatabaseIdentity { projectId: string; orgId: string; ownerId: string; revision: number; createdAt: string; submittedAppId?: string; submittedAppVersion?: number }
/** IDs supplied here must already be resolved to backend UUIDs; ticket and Studio version numbers are not app versions. */
export function databaseSnapshot(scope:StudioScope,draft:StudioDraft,identity:StudioDatabaseIdentity):StudioDatabaseSnapshot {
  if((identity.submittedAppId===undefined)!==(identity.submittedAppVersion===undefined))throw new Error('App y versión del ticket deben mapearse juntas.');
  if(!Number.isSafeInteger(identity.revision)||identity.revision<1)throw new Error('Revisión de proyecto inválida.');
  const current=draft.versions.find(version=>version.id===draft.selectedId),now=new Date().toISOString();
  const promptFor=(versionId:number)=>{let prompt='';for(const message of draft.messages){if(message.role==='user')prompt=message.text;if(message.versionId===versionId)return prompt.slice(0,2000);}return '';};
  return {
    project:{id:identity.projectId,legacy_id:`blkunit:studio:v1:${scope.orgId}:${scope.userId}:${scope.editId||'new'}`,org_id:identity.orgId,owner_id:identity.ownerId,title:(current?.spec.title||'Proyecto sin título').slice(0,120),current_version:draft.selectedId,submitted_app_id:identity.submittedAppId||null,submitted_version:identity.submittedAppVersion??null,revision:identity.revision,created_at:identity.createdAt,updated_at:now},
    versions:draft.versions.map(version=>({project_id:identity.projectId,version:version.id,prompt:promptFor(version.id),generated_html:version.html,dashboard_config:version.spec.dashboard||null,engine:version.provider,model:version.model||null,template:version.spec.dashboard?.template||version.spec.kind,spec:version.spec,summary:draft.messages.find(message=>message.versionId===version.id)?.text||'',created_at:version.createdAt})),
    messages:draft.messages.map((message,position)=>({project_id:identity.projectId,position,role:message.role,body:message.text,version:message.versionId&&draft.versions.some(version=>version.id===message.versionId)?message.versionId:null})),
    activity:(draft.activity||[]).map(item=>({project_id:identity.projectId,action:item.versionId?'version_completed':'generation_status',message:item.text,created_at:item.createdAt}))
  };
}
