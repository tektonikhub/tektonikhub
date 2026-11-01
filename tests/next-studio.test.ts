import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { addVersion, blankDraft, branchVersion, bytes, draftKey, localPersistence, MAX_MESSAGES, MAX_VERSIONS, parseDraft, restoreVersion, validateFiles } from '../lib/studio/draft';
import { checkAbort, OFFLINE_CSP, parseDashboardJSON, specForKind, waitForGeneration, withDashboard } from '../lib/studio/engines';
import { databaseSnapshot } from '../lib/studio/persistence-map';
import { abortableResponse, llm, validateDashboardIteration } from '../lib/studio/llm';
import { loadSubmissionSource } from '../lib/studio/source';
import type { DashboardKit, StudioDraft, StudioEngine, StudioVersion } from '../lib/studio/types';
const require=createRequire(import.meta.url);
const kit:DashboardKit=require(resolve('lib','studio','runtime','dashboard-kit.js'));
const engine:StudioEngine=require(resolve('lib','studio','runtime','studio-engine.js'));
function version(parentId?:number):Omit<StudioVersion,'id'>{const config=kit.validate(kit.createConfig('Dashboard de ventas'));return {spec:withDashboard(engine.createSpec('dashboard'),config),html:kit.renderHTML(config),provider:'demo',createdAt:'2026-10-25T09:00:00Z',...(parentId?{parentId}:{})};}
function complete():StudioDraft{return addVersion(blankDraft(),version(),'Primera versión sintética.');}
test('legacy key is isolated by organization, user and editing ticket',()=>{assert.equal(draftKey({orgId:'company',userId:'user'}),'blkunit:studio:v1:company:user:new');assert.notEqual(draftKey({orgId:'a',userId:'user'}),draftKey({orgId:'b',userId:'user'}));assert.equal(draftKey({orgId:'a',userId:'u',editId:'ticket'}),'blkunit:studio:v1:a:u:ticket');});
test('normalized draft roundtrip preserves complete dashboard data',()=>{const draft=complete(),restored=parseDraft(JSON.stringify(draft),kit);assert.deepEqual(restored,draft);assert.deepEqual(restored.versions[0].spec.dashboard?.data,draft.versions[0].spec.dashboard?.data);});
test('legacy v1 draft without new metadata remains compatible',()=>{const draft=complete();delete draft.activity;delete draft.files;const restored=parseDraft(JSON.stringify(draft),kit);assert.equal(restored.selectedId,1);assert.equal(restored.activity,undefined);assert.deepEqual(restored.files,[]);});
test('new drafts and branches do not record project activity; legacy activity remains readable',()=>{
  const initial=complete(),branch=branchVersion(initial,1);
  assert.equal(initial.activity,undefined);
  assert.equal(branch.activity,undefined);
  const activity=[{id:1,text:'Evento anterior',createdAt:'2026-10-25T09:00:00Z',versionId:1}];
  const legacy=parseDraft(JSON.stringify({...initial,activity}),kit);
  assert.deepEqual(legacy.activity,activity);
  assert.deepEqual(branchVersion(legacy,1).activity,activity);
});
test('eight versions and forty messages are retained with monotonic ids',()=>{let draft=blankDraft();for(let i=0;i<45;i++)draft=addVersion(draft,version(draft.selectedId||undefined),'Version '+i);assert.equal(draft.versions.length,MAX_VERSIONS);assert.equal(draft.messages.length,MAX_MESSAGES);assert.equal(draft.nextVersion,46);assert.equal(draft.versions[0].id,38);assert.equal(draft.selectedId,45);assert.doesNotThrow(()=>parseDraft(JSON.stringify(draft),kit));});
test('restore and branch do not mutate previous snapshots',()=>{const original=complete();const two=addVersion(original,version(1),'Segunda versión');const restored=restoreVersion(two,1);const branch=branchVersion(restored,1);assert.equal(original.versions.length,1);assert.equal(two.selectedId,2);assert.equal(branch.selectedId,3);assert.equal(branch.versions[2].parentId,1);assert.equal(branch.versions[2].html,original.versions[0].html);assert.deepEqual(branch.versions[2].spec.dashboard?.data,original.versions[0].spec.dashboard?.data);assert.throws(()=>restoreVersion(branch,900));});
test('corrupt JSON, excessive versions, unknown roles and broken selection are rejected',()=>{assert.throws(()=>parseDraft('{',kit));assert.throws(()=>parseDraft(JSON.stringify({...complete(),selectedId:900}),kit));assert.throws(()=>parseDraft(JSON.stringify({...complete(),nextVersion:1}),kit));assert.throws(()=>parseDraft(JSON.stringify({...complete(),messages:[{role:'system',text:'x'}]}),kit));assert.throws(()=>parseDraft(JSON.stringify({...complete(),versions:Array(9).fill(complete().versions[0])}),kit));});
test('duplicate ids, invalid dates/provider/model and unknown dashboard fields rejected',()=>{const draft=complete(),item=draft.versions[0];for(const changed of [{...item,provider:'unknown'},{...item,provider:['demo']},{...item,spec:{...item.spec,kind:['dashboard']}},{...item,createdAt:'invalid'},{...item,model:'x'.repeat(129)},{...item,spec:{...item.spec,dashboard:{...item.spec.dashboard,script:'alert(1)'}}}])assert.throws(()=>parseDraft(JSON.stringify({...draft,versions:[changed]}),kit));assert.throws(()=>parseDraft(JSON.stringify({...draft,versions:[item,item]}),kit));});
test('message, HTML and UTF-8 draft limits are enforced without changing selection',()=>{const draft=complete();assert.throws(()=>parseDraft(JSON.stringify({...draft,messages:[{role:'user',text:'x'.repeat(4001)}]}),kit));assert.throws(()=>addVersion(draft,{...version(),html:'é'.repeat(100_001)},'too big'));assert.equal(draft.selectedId,1);assert.equal(bytes('é'),2);assert.throws(()=>parseDraft('é'.repeat(1_500_001),kit),/demasiado grande/);});
test('ticket and expected version survive restores and branches',()=>{const draft={...complete(),editing:{id:'app',ticket:'APP-2026-1',expectedVersion:3},submission:{id:'app',ticket:'APP-2026-1',versionId:1}};const restored=parseDraft(JSON.stringify(branchVersion(draft,1)),kit);assert.equal(restored.editing?.expectedVersion,3);assert.equal(restored.editing?.ticket,'APP-2026-1');assert.equal(restored.submission?.versionId,1);assert.throws(()=>parseDraft(JSON.stringify({...draft,editing:{...draft.editing,expectedVersion:0}}),kit));});
test('file metadata accepts inert names and rejects traversal, duplicates, limits and invalid size',()=>{assert.deepEqual(validateFiles([{name:'demo.csv',type:'text/csv',size:23}],2,30),[{name:'demo.csv',type:'text/csv',size:23}]);for(const files of [[{name:'..\\file',type:'',size:1}],[{name:'file',type:'',size:-1}],[{name:'a',type:'',size:31}],[{name:'a',type:'',size:1},{name:'a',type:'',size:1}]])assert.throws(()=>validateFiles(files,2,30));assert.throws(()=>validateFiles([{name:'a',type:'',size:1}],0,30));});
test('dashboard JSON is normalized and rejects markup/code/extra fields',()=>{const config=kit.createConfig('ventas');assert.deepEqual(parseDashboardJSON(JSON.stringify(config),kit),kit.validate(config));assert.throws(()=>parseDashboardJSON('<script>evil</script>',kit));assert.throws(()=>parseDashboardJSON(JSON.stringify({...config,onclick:'evil'}),kit));assert.throws(()=>parseDashboardJSON(' '.repeat(120001),kit));});
test('explicit type selection cannot be displaced by words in first prompt',()=>{assert.equal(specForKind(engine,'calculadora de tendencias','dashboard',null).kind,'dashboard');assert.equal(specForKind(engine,'dashboard para tareas','form',null).kind,'form');assert.equal(specForKind(engine,'añade buscador','kanban',engine.createSpec('dashboard')).kind,'kanban');});
test('dashboard followups preserve synthetic rows and declarative offline CSP',()=>{const config=kit.createConfig('ventas'),changed=kit.validate(kit.createConfig('tema oscuro y añade gráfico de líneas',config));assert.deepEqual(changed.data,config.data);const html=kit.renderHTML(changed);assert.match(html,/id="blk-dashboard-config"/);assert.match(html,/connect-src 'none'/);assert.match(OFFLINE_CSP,/default-src 'none'/);assert.ok(!html.includes('https://fonts.googleapis.com'));});
test('Azure followups reject changed rows without explicit one-generation consent',()=>{const previous=kit.createConfig('ventas'),visual=kit.createConfig('tema oscuro',previous);assert.deepEqual(validateDashboardIteration(visual,previous,kit).data,previous.data);const changed={...visual,data:visual.data.map((row,index)=>({...row,value:row.value+(index===0?1:0)}))};assert.throws(()=>validateDashboardIteration(changed,previous,kit),/Autoriza explícitamente/);assert.deepEqual(validateDashboardIteration(changed,previous,kit,true).data,changed.data);assert.equal(previous.data[0].value,visual.data[0].value);assert.throws(()=>validateDashboardIteration({...changed,script:'evil'},previous,kit,true));});
test('cancel prevents incomplete versions and removes pending timers',async()=>{const draft=complete(),abort=new AbortController();const promise=waitForGeneration(abort.signal,10000);abort.abort();await assert.rejects(promise,{name:'AbortError'});assert.throws(()=>checkAbort(abort.signal),{name:'AbortError'});await assert.rejects(waitForGeneration(abort.signal),{name:'AbortError'});await waitForGeneration(new AbortController().signal,1);assert.equal(draft.versions.length,1);assert.equal(draft.selectedId,1);});
test('cancel immediately releases a generation waiting on a shared CSRF request',async()=>{const abort=new AbortController(),pending=new Promise<string>(()=>{}),response=abortableResponse(pending,abort.signal);abort.abort();await assert.rejects(response,{name:'AbortError'});assert.equal(await abortableResponse(Promise.resolve('ready'),new AbortController().signal),'ready');await assert.rejects(abortableResponse(Promise.reject(new Error('failed')),new AbortController().signal),/failed/);});
class MemoryStorage implements Storage { private data=new Map<string,string>();length=0;fail=false;clear(){this.data.clear();this.length=0;}getItem(key:string){if(this.fail)throw new Error('blocked');return this.data.get(key)??null;}key(index:number){return Array.from(this.data.keys())[index]??null;}removeItem(key:string){if(this.fail)throw new Error('blocked');this.data.delete(key);this.length=this.data.size;}setItem(key:string,value:string){if(this.fail)throw new Error('quota');this.data.set(key,value);this.length=this.data.size;}}
test('persistence propagates corruption/quota/removal failures and does not silently reset',async()=>{const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{const scope={orgId:'org',userId:'user'},adapter=localPersistence(kit);assert.equal(await adapter.load(scope),null);await adapter.save(scope,complete());assert.equal((await adapter.load(scope))?.selectedId,1);storage.setItem(draftKey(scope),'{broken');await assert.rejects(adapter.load(scope));assert.equal(storage.getItem(draftKey(scope)),'{broken');storage.fail=true;await assert.rejects(adapter.save(scope,blankDraft()));await assert.rejects(adapter.remove(scope));storage.fail=false;assert.equal(storage.getItem(draftKey(scope)),'{broken');await adapter.remove(scope);assert.equal(await adapter.load(scope),null);}finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else Reflect.deleteProperty(globalThis,'localStorage');}});
test('database map uses exact PostgreSQL columns and distinguishes ticket version from Studio version',()=>{const draft=complete();draft.submission={id:'legacy-app',ticket:'APP-1',versionId:1};const snapshot=databaseSnapshot({orgId:'legacy-org',userId:'legacy-user'},draft,{projectId:'uuid-project',orgId:'uuid-org',ownerId:'uuid-user',revision:2,createdAt:'2026-10-25T09:00:00Z',submittedAppId:'uuid-app',submittedAppVersion:4});assert.equal(snapshot.project.submitted_version,4);assert.equal(snapshot.project.current_version,1);assert.equal(snapshot.versions[0].version,1);assert.equal(snapshot.versions[0].engine,'demo');assert.equal(snapshot.messages[0].body,'Primera versión sintética.');assert.throws(()=>databaseSnapshot({orgId:'o',userId:'u'},draft,{projectId:'p',orgId:'o',ownerId:'u',revision:1,createdAt:'date',submittedAppId:'app'}));});
test('workspace is native React; only isolated generated preview uses iframe',()=>{const source=readFileSync(resolve('components','studio','studio-workspace.tsx'),'utf8');assert.match(source,/sandbox="allow-scripts"/);assert.match(source,/srcDoc=\{source\}/);assert.ok(!source.includes('allow-same-origin'));assert.ok(!source.includes('dangerouslySetInnerHTML'));assert.ok(!source.includes('create-app.html'));});
test('Studio starts from a description without provider controls or project activity',()=>{
  const workspace=readFileSync(resolve('components','studio','studio-workspace.tsx'),'utf8');
  for(const removed of ['generationMode','studio.provider','Azure','Motor','Demo local','Actividad del proyecto','studio-history','Mis proyectos'])assert.ok(!workspace.includes(removed),removed);
  assert.match(workspace,/Describe tu aplicación en el chat/);
  assert.match(workspace,/await studio\.generate\(text\)/);
  const hook=readFileSync(resolve('hooks','use-studio.ts'),'utf8');
  assert.match(hook,/await llm\.generate\(orgId,prompt,prior/);
  assert.ok(!hook.includes('setProvider'));
  assert.match(hook,/await llm\.status\(orgId,/);
  assert.ok(!hook.includes('kit.createConfig'));
  assert.ok(!hook.includes('engine.renderHTML'));
  assert.ok(!hook.includes('activity:'));
});
test('minimal Studio toolbar keeps attachments and verified LLM status without a large heading or JSON export',()=>{
  const workspace=readFileSync(resolve('components','studio','studio-workspace.tsx'),'utf8');
  for(const removed of ['PageHeading','De idea a herramienta','studio-files"','Archivos · solo metadatos','studio.exportDraft','studio-starters','studio-quick-edits'])assert.ok(!workspace.includes(removed),removed);
  assert.match(workspace,/className="studio-toolbar"/);
  assert.match(workspace,/data-state=\{studio\.llmConnection\.status\}/);
  assert.match(workspace,/aria-describedby="studio-llm-tooltip"/);
  assert.match(workspace,/role="tooltip"/);
  assert.match(workspace,/fileInput\.current\?\.click\(\)/);
  assert.match(workspace,/studio\.setFiles\(event\.target\.files\);event\.target\.value=''/);
  assert.match(workspace,/aria-label=\{`Quitar \$\{file\.name\}`\}/);
  const hook=readFileSync(resolve('hooks','use-studio.ts'),'utf8');
  assert.match(hook,/llmConnection\?\.orgId===orgId&&llmConnection\?\.userId===userId/);
  assert.match(hook,/if\(controller\.signal\.aborted\)return/);
  assert.match(hook,/result\.configured\?'configured':'unconfigured'/);
  assert.ok(!hook.includes('exportDraft:'));
});
test('LLM status confirms configuration using the exact organization, no-store and cancellation',async()=>{
  const original=globalThis.fetch,controller=new AbortController();
  const response={available:true,configured:true,endpoint:'https://organization.openai.azure.com',deployment:'organization-model',apiVersion:'2024-10-21',storage:'server-memory'};
  try{
    globalThis.fetch=async(input,options)=>{
      assert.equal(String(input),'/api/llm/settings?orgId=org%20one');
      assert.equal(options?.cache,'no-store');
      assert.equal(options?.credentials,'same-origin');
      assert.equal(options?.signal,controller.signal);
      return Response.json(response);
    };
    assert.equal((await llm.status('org one',controller.signal)).configured,true);
    globalThis.fetch=async()=>Response.json({...response,configured:false});
    assert.equal((await llm.status('org one')).configured,false);
    for(const changed of [{configured:'true'},{available:false},{storage:'browser'},{deployment:undefined}]){
      globalThis.fetch=async()=>Response.json({...response,...changed});
      await assert.rejects(llm.status('org one'),/Respuesta de configuración inválida/);
    }
    globalThis.fetch=async()=>Response.json({error:'disabled'},{status:503});
    await assert.rejects(llm.status('org one',controller.signal,'No se pudo comprobar el LLM de la organización.'),/No se pudo comprobar el LLM de la organización/);
    globalThis.fetch=async()=>{throw new DOMException('Cancelled','AbortError');};
    await assert.rejects(llm.status('org one',controller.signal),{name:'AbortError'});
  }finally{globalThis.fetch=original;}
});
test('organization generation errors create no demo response and preserve the prior data',async()=>{
  const original=globalThis.fetch,previous=kit.createConfig('ventas'),snapshot=JSON.stringify(previous);
  const calls:string[]=[];
  try{
    for(const failure of ['unavailable','offline','invalid','demo']){
      calls.length=0;
      globalThis.fetch=async(input)=>{
        const url=String(input);calls.push(url);
        if(url==='/api/session')return Response.json({csrf:'a'.repeat(64),localOnly:true});
        if(failure==='offline')throw new Error('Offline');
        if(failure==='unavailable')return Response.json({error:'disabled'},{status:503});
        if(failure==='invalid')return new Response('<html>Invalid response</html>');
        return Response.json({config:previous,provider:'demo',model:'unexpected'});
      };
      await assert.rejects(llm.generate('organization','Mi descripción',previous,kit,new AbortController().signal),failure==='demo'?/Respuesta de generación inválida/:/servicio.*organización/);
      assert.equal(calls.filter(url=>url==='/api/studio/generate').length,1);
      assert.ok(calls.every(url=>url==='/api/session'||url==='/api/studio/generate'));
      assert.equal(JSON.stringify(previous),snapshot);
    }
  }finally{globalThis.fetch=original;}
});
test('submission source is a bounded no-store read tied to the exact ticket version',async()=>{
  const app={id:'00000000-0000-4000-8000-000000000300',version:3};
  const fetcher:typeof fetch=async(input,options)=>{
    const url=new URL(String(input),'http://127.0.0.1');
    assert.equal(url.pathname,'/api/studio/source');
    assert.equal(url.searchParams.get('appId'),app.id);
    assert.equal(url.searchParams.get('version'),'3');
    assert.equal(options?.cache,'no-store');
    assert.equal(options?.credentials,'same-origin');
    return Response.json({appId:app.id,version:3,generatedHtml:'<html>Saved source</html>'});
  };
  assert.equal(await loadSubmissionSource(app,fetcher),'<html>Saved source</html>');
  assert.equal(await loadSubmissionSource(app,async()=>Response.json({appId:app.id,version:3,generatedHtml:null})),null);
  for(const response of [
    {appId:app.id,version:4,generatedHtml:'stale'},
    {appId:'00000000-0000-4000-8000-000000000301',version:3,generatedHtml:'wrong ticket'},
    {appId:app.id,version:3,generatedHtml:42},
    {appId:app.id,version:3,generatedHtml:'x'.repeat(300001)},
    {appId:app.id,version:3},
  ])await assert.rejects(loadSubmissionSource(app,async()=>Response.json(response)));
  await assert.rejects(loadSubmissionSource(app,async()=>Response.json({error:'Version conflict'},{status:409})),/Version conflict/);
  await assert.rejects(loadSubmissionSource(app,async()=>{throw new Error('Offline');}),/No se confirmó/);
});
test('Azure client uses CSRF protocol, validates JSON and never silently falls back',async()=>{const original=globalThis.fetch;const calls:{url:string;options?:RequestInit}[]=[];globalThis.fetch=async(input:RequestInfo|URL,options?:RequestInit)=>{const url=String(input);calls.push({url,options});if(url==='/api/session')return Response.json({csrf:'a'.repeat(64),localOnly:true});if(url==='/api/studio/generate')return Response.json({config:kit.createConfig('ventas'),provider:'azure-openai',model:'demo-deployment'});return Response.json({error:'disabled'},{status:503});};try{const generated=await llm.generate('org','ventas',null,kit,new AbortController().signal);assert.equal(generated.model,'demo-deployment');const call=calls.find(c=>c.url==='/api/studio/generate');assert.equal(new Headers(call?.options?.headers).get('X-BLK-CSRF'),'a'.repeat(64));assert.deepEqual(JSON.parse(String(call?.options?.body)),{prompt:'ventas',previous:null,orgId:'org'});assert.equal(call?.options?.credentials,'same-origin');await assert.rejects(llm.status('org'),/BLK_ENABLE_LOCAL_LLM=true/);const abort=new AbortController();abort.abort();await assert.rejects(llm.generate('org','ventas',null,kit,abort.signal),{name:'AbortError'});}finally{globalThis.fetch=original;}});
