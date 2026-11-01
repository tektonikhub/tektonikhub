'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBLK } from '@/hooks/use-blk';
import { addVersion, branchVersion, blankDraft, bytes, draftKey, localPersistence, MAX_MESSAGES, restoreVersion, validateFiles } from '@/lib/studio/draft';
import { checkAbort, dashboardFromHTML, generatedDocument, provenanceFromHTML, isolatedHTML, loadEngines, specForKind, waitForGeneration, withDashboard } from '@/lib/studio/engines';
import { llm } from '@/lib/studio/llm';
import { loadSubmissionSource } from '@/lib/studio/source';
import type { App, SubmissionFields } from '@/lib/domain/types';
import type { DashboardKit, StudioDraft, StudioEngine, StudioPersistence, StudioScope } from '@/lib/studio/types';
type LLMConnection = {orgId:string;userId:string;revision:number;status:'checking'|'configured'|'unconfigured'|'unavailable';message:string};
export function downloadText(text:string,name:string,type='text/html;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function useStudio(){
  const blk=useBLK(), router=useRouter(), searchParams=useSearchParams();
  const editId=searchParams.get('edit')||undefined;
  const [draft,setDraft]=useState<StudioDraft>(blankDraft),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saveState,setSaveState]=useState('Cargando borrador…'),[storageBlocked,setStorageBlocked]=useState(false),[editing,setEditing]=useState<App|null>(null),[allowDataChanges,setAllowDataChanges]=useState(false),[generationStatus,setGenerationStatus]=useState(''),[initialization,setInitialization]=useState(0);
  const draftRef=useRef(draft),runtime=useRef<{engine:StudioEngine;kit:DashboardKit}|null>(null),persistence=useRef<StudioPersistence|null>(null),scope=useRef<StudioScope|null>(null),blocked=useRef(false),job=useRef<AbortController|null>(null),sessionRevision=useRef(0),saveQueue=useRef<Promise<void>>(Promise.resolve()),editingRef=useRef<App|null>(null);
  const orgId=blk.org?.id,userId=blk.user?.id;
  const [llmConnection,setLLMConnection]=useState<LLMConnection|null>(null),[llmRevision,setLLMRevision]=useState(0);
  const refreshLLM=useCallback(()=>setLLMRevision(revision=>revision+1),[]);
  useEffect(()=>{
    if(!orgId||!userId)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      setLLMConnection({orgId,userId,revision:llmRevision,status:'checking',message:'Comprobando el LLM de la organización…'});
      try{
        const result=await llm.status(orgId,AbortSignal.any([controller.signal,AbortSignal.timeout(10_000)]),'No se pudo comprobar el LLM de la organización. Pulsa para reintentar.');
        if(controller.signal.aborted)return;
        setLLMConnection({orgId,userId,revision:llmRevision,status:result.configured?'configured':'unconfigured',message:result.configured?'El LLM de la organización está correctamente configurado.':'El LLM de la organización aún no está configurado. Contacta con IT.'});
      }catch(statusError){
        if(controller.signal.aborted)return;
        setLLMConnection({orgId,userId,revision:llmRevision,status:'unavailable',message:statusError instanceof Error?statusError.message:'No se pudo comprobar el LLM de la organización. Pulsa para reintentar.'});
      }
    },0);
    window.addEventListener('focus',refreshLLM);
    return()=>{clearTimeout(timer);controller.abort();window.removeEventListener('focus',refreshLLM);};
  },[orgId,userId,llmRevision,refreshLLM]);
  const connection=llmConnection?.orgId===orgId&&llmConnection?.userId===userId&&llmConnection?.revision===llmRevision?llmConnection:{status:'checking' as const,message:'Comprobando el LLM de la organización…'};
  const update=useCallback((next:StudioDraft)=>{draftRef.current=next;setDraft(next);},[]);
  const persist=useCallback((next:StudioDraft)=>{
    const adapter=persistence.current,currentScope=scope.current,revision=sessionRevision.current;
    if(!adapter||!currentScope||blocked.current){setSaveState('Sin guardar · exporta antes de salir');return;}
    setSaveState('Guardando…');
    saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{
      if(revision!==sessionRevision.current||blocked.current)return;
      try{await adapter.save(currentScope,next);if(revision===sessionRevision.current)setSaveState('✓ Guardado en este navegador');}
      catch{if(revision===sessionRevision.current){blocked.current=true;setStorageBlocked(true);setSaveState('Sin guardar · exporta antes de salir');setError('No se pudo guardar. El borrador sigue en memoria; exporta el HTML y reintenta el almacenamiento antes de salir.');}}
    });
  },[]);
  const commit=useCallback((next:StudioDraft)=>{update(next);persist(next);},[update,persist]);
  useEffect(()=>{
    if(!orgId||!userId)return;
    const revision=++sessionRevision.current;job.current?.abort();job.current=null;
    scope.current={orgId,userId,...(editId?{editId}:{})};
    const edit=editId?blk.data.apps.find(app=>app.id===editId&&app.orgId===orgId&&app.authorId===userId):null;
    editingRef.current=edit||null;
    (async()=>{
      await Promise.resolve();if(revision!==sessionRevision.current)return;
      update(blankDraft());setReady(false);setBusy(false);setError('');blocked.current=false;setStorageBlocked(false);setSaveState('Cargando borrador…');setAllowDataChanges(false);setGenerationStatus('');setEditing(edit||null);
      try{
        if(editId&&(!edit||edit.reviewStatus!=='changes_requested'))throw new Error('Solo puedes editar tus propios envíos con cambios solicitados.');
        const engines=await loadEngines();if(revision!==sessionRevision.current)return;runtime.current=engines;
        const adapter=localPersistence(engines.kit);persistence.current=adapter;
        let next=blankDraft();
        try{const saved=await adapter.load({orgId,userId,...(editId?{editId}:{})});if(saved)next=saved;}
        catch(loadError){if(revision!==sessionRevision.current)return;blocked.current=true;setStorageBlocked(true);setError(`No se pudo restaurar el borrador: ${loadError instanceof Error?loadError.message:'datos inválidos'}. El original NO se sobrescribirá. Exporta el JSON almacenado o reinicia explícitamente.`);}
        if(revision!==sessionRevision.current)return;
        if(edit&&!blocked.current){
          if(next.editing&&(next.editing.id!==edit.id||next.editing.ticket!==edit.ticket))throw new Error('El borrador no corresponde a este ticket.');
          if(!next.editing)next.editing={id:edit.id,ticket:edit.ticket,expectedVersion:edit.version};
          if(!next.versions.length){
            const html=edit.generatedHtml??await loadSubmissionSource(edit);
            if(revision!==sessionRevision.current)return;
            if(html){
              const config=dashboardFromHTML(html,engines.kit);
              let spec={...engines.engine.createSpec(edit.desc),title:edit.title};if(config)spec=withDashboard(spec,config);
              next={...next,versions:[{id:1,spec,html,...provenanceFromHTML(html),createdAt:edit.updatedAt}],selectedId:1,nextVersion:2,messages:[{role:'assistant' as const,text:`IT ha solicitado cambios en ${edit.title}. Conservamos el ticket ${edit.ticket}. Itera y vuelve a enviar.`}],files:edit.attachments.filter(file=>file.name!=='index.html')};
            }else{
              setError('Este envío no contiene HTML generado. Crea una versión en Studio para enviar la corrección.');
            }
          }
        }
        update(next);setReady(true);setSaveState(blocked.current?'Restauración fallida · original protegido':next.versions.length?'Borrador restaurado':'Nuevo borrador');
      }catch(initError){if(revision!==sessionRevision.current)return;setError(initError instanceof Error?initError.message:'No se pudo abrir Studio.');setSaveState('No se pudo abrir el borrador');}
    })();
    return()=>{sessionRevision.current=revision+1;job.current?.abort();};
  // Data updates after submission must not replace the active draft or expectedVersion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[orgId,userId,editId,initialization,update]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(job.current||blocked.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
  const generate=async(raw:string)=>{
    const prompt=raw.trim(),engines=runtime.current;if(!ready||job.current||!engines||!orgId)return;
    if(!prompt||prompt.length>2000){setError('Describe tu idea en 1–2000 caracteres.');return;}
    const controller=new AbortController(),revision=sessionRevision.current;job.current=controller;setBusy(true);setError('');
    const initial=draftRef.current,previous=initial.versions.find(v=>v.id===initial.selectedId),authorizedDataChanges=allowDataChanges;setAllowDataChanges(false);
    commit({...initial,messages:[...initial.messages,{role:'user' as const,text:prompt}].slice(-MAX_MESSAGES)});
    try{
      setGenerationStatus('Generando a partir de tu descripción…');
      const prior=previous?.spec.dashboard||null;
      if(previous&&!prior)throw new Error('Esta versión antigua no es un dashboard compatible. Exporta tu trabajo y reinicia el borrador antes de crear con el LLM.');
      const result=await llm.generate(orgId,prompt,prior,engines.kit,controller.signal,authorizedDataChanges);
      const config=engines.kit.validate(result.config),model=result.model;
      const spec=withDashboard(specForKind(engines.engine,prompt,'dashboard',previous?.spec||null),config);
      checkAbort(controller.signal);setGenerationStatus('Preparando la vista previa…');await waitForGeneration(controller.signal);
      const html=generatedDocument(engines.kit.renderHTML(config),'azure-openai',model);
      checkAbort(controller.signal);if(revision!==sessionRevision.current)return;
      const explanation=`Dashboard creado a partir de tu descripción: ${config.components.length} componentes validados. Revisa la vista previa y describe los cambios que necesites. Los datos son sintéticos y el HTML está aislado, sin conexión a la red.`;
      commit(addVersion(draftRef.current,{spec,html,provider:'azure-openai',model,createdAt:new Date().toISOString(),...(previous?{parentId:previous.id}:{})},explanation));
    }catch(generationError){
      if(revision!==sessionRevision.current)return;
      const aborted=generationError instanceof Error&&generationError.name==='AbortError';const message=aborted?'Generación detenida. La última versión completa se conserva.':`No se creó ninguna versión: ${generationError instanceof Error?generationError.message:'error inesperado'}. La versión anterior se conserva.`;
      if(!aborted)setError(message);commit({...draftRef.current,messages:[...draftRef.current.messages,{role:'assistant' as const,text:message.slice(0,4000)}].slice(-MAX_MESSAGES)});
    }finally{if(revision===sessionRevision.current){job.current=null;setBusy(false);setGenerationStatus('');}}
  };
  const restore=(id:number)=>{if(busy)return;try{commit(restoreVersion(draftRef.current,id));}catch(restoreError){setError(restoreError instanceof Error?restoreError.message:'No se pudo restaurar.');}};
  const retryStorage=async()=>{
    const adapter=persistence.current,currentScope=scope.current,revision=sessionRevision.current,next=draftRef.current;
    if(!adapter||!currentScope||busy)return false;setBusy(true);
    try{await saveQueue.current;if(revision!==sessionRevision.current)return false;await adapter.save(currentScope,next);if(revision!==sessionRevision.current)return false;blocked.current=false;setStorageBlocked(false);setError('');setSaveState('✓ Guardado en este navegador');return true;}
    catch{if(revision===sessionRevision.current)setError('Almacenamiento todavía no disponible. Exporta el borrador antes de salir.');return false;}
    finally{if(revision===sessionRevision.current)setBusy(false);}
  };
  const exportStored=()=>{try{if(!scope.current)return;const raw=localStorage.getItem(draftKey(scope.current));if(raw===null){setError('No existe un borrador almacenado.');return;}downloadText(raw,'studio-original.json','application/json');}catch{setError('No se pudo leer el almacenamiento. Puedes exportar el HTML de la versión en memoria.');}};
  const reset=async()=>{
    const adapter=persistence.current,currentScope=scope.current,revision=sessionRevision.current;
    if(busy||!adapter||!currentScope)return false;setBusy(true);
    try{await saveQueue.current;if(revision!==sessionRevision.current)return false;await adapter.remove(currentScope);if(revision!==sessionRevision.current)return false;blocked.current=false;setStorageBlocked(false);update(blankDraft());editingRef.current=null;setEditing(null);setAllowDataChanges(false);setError('');setSaveState('Borrador reiniciado · aún sin guardar');if(editId){setReady(false);router.replace('/studio');}return true;}
    catch{if(revision===sessionRevision.current)setError('No se pudo borrar el borrador. No se ha reiniciado el proyecto.');return false;}
    finally{if(revision===sessionRevision.current)setBusy(false);}
  };
  const setFiles=(input:FileList|null)=>{if(!input||busy)return;try{const files=validateFiles([...draftRef.current.files||[],...Array.from(input,file=>({name:file.name,type:file.type,size:file.size}))],blk.data.config.upload.maxFiles-1,blk.data.config.upload.maxBytes);commit({...draftRef.current,files});setError('');}catch(fileError){setError(fileError instanceof Error?fileError.message:'Adjuntos inválidos.');}};
  const submit=async(fields:SubmissionFields)=>{
    const current=draftRef.current.versions.find(v=>v.id===draftRef.current.selectedId);if(!current||busy||draftRef.current.submission)return false;
    const adapterEdit=draftRef.current.editing;if(editingRef.current&&!adapterEdit){setError('No se pudo recuperar la versión esperada del ticket. Reinicia explícitamente y vuelve a abrir /studio?edit=ID.');return false;}
    setBusy(true);setError('');const revision=sessionRevision.current;
    try{
      const attachments=validateFiles([...(draftRef.current.files||[]).filter(file=>file.name!=='index.html'),{name:'index.html',type:'text/html',size:bytes(current.html)}],blk.data.config.upload.maxFiles,blk.data.config.upload.maxBytes);
      const payload={...fields,attachments,generatedHtml:current.html,aiTool:'Tektonik hub Studio'};
      const result=await blk.action(()=>adapterEdit?blk.repository.updateSubmission(adapterEdit.id,payload,adapterEdit.expectedVersion):blk.repository.createSubmission(payload));
      if(revision!==sessionRevision.current)return false;
      if(!result.ok){setError('El envío a IT falló. No se ha marcado como enviado. Revisa los campos y, si hubo un cambio concurrente, vuelve a abrir el ticket tras exportar tu trabajo.');return false;}
      const app=result.value;commit({...draftRef.current,submission:{id:app.id,ticket:app.ticket,versionId:current.id},messages:[...draftRef.current.messages,{role:'assistant' as const,text:`v${current.id} enviada a IT · ${app.ticket}. Todavía no publicada.`}].slice(-MAX_MESSAGES)});return true;
    }catch(submitError){if(revision===sessionRevision.current)setError(submitError instanceof Error?submitError.message:'No se pudo enviar a IT.');return false;}finally{if(revision===sessionRevision.current)setBusy(false);}
  };
  const current=draft.versions.find(v=>v.id===draft.selectedId)||null;
  return {blk,draft,current,ready,busy,error,setError,saveState,storageBlocked,editing,llmConnection:connection,refreshLLM,allowDataChanges,setAllowDataChanges,generationStatus,generate,stop:()=>job.current?.abort(),restore,branch:()=>{if(current&&!busy)try{commit(branchVersion(draftRef.current,current.id));}catch(error){setError(error instanceof Error?error.message:'No se pudo crear la rama.');}},reset,retryStorage,exportStored,setFiles,removeFile:(name:string)=>{if(!busy)commit({...draftRef.current,files:(draftRef.current.files||[]).filter(file=>file.name!==name)});},submit,retryInitialization:()=>setInitialization(value=>value+1),isolatedHTML};
}
