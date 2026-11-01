import { record } from './draft';
import type { DashboardConfig, DashboardKit } from './types';
export interface LLMStatus { available: boolean; configured: boolean; endpoint: string; deployment: string; apiVersion: string; storage: 'server-memory' }
export interface LLMFields { endpoint: string; deployment: string; apiVersion: string; apiKey: string }
const BRIDGE_HELP = 'Azure local no disponible. Activa BLK_ENABLE_LOCAL_LLM=true en .env.local, inicia npm run dev:llm y reinicia Next en desarrollo. Azure está deshabilitado en producción.';
class RequestError extends Error { constructor(message:string, readonly status:number){ super(message); } }
let session: Promise<string> | undefined;
async function request(url:string, options:RequestInit={}):Promise<unknown>{
  let response:Response;
  try{response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store'});}catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw new Error(BRIDGE_HELP);}
  if([404,503].includes(response.status))throw new RequestError(BRIDGE_HELP,response.status);
  let result:unknown;try{result=await response.json();}catch{throw new Error('El bridge local no devolvió JSON válido. '+BRIDGE_HELP);}
  if(!response.ok)throw new RequestError(record(result)&&typeof result.error==='string'?result.error:'La operación Azure ha fallado.',response.status);
  return result;
}
async function csrf():Promise<string>{
  if(!session)session=request('/api/session').then(result=>{if(!record(result)||typeof result.csrf!=='string'||!/^[a-f0-9]{64}$/.test(result.csrf))throw new Error('Sesión CSRF inválida.');return result.csrf;}).catch(error=>{session=undefined;throw error;});
  return session;
}
export function abortableResponse<T>(pending:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return pending;
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Detenido','AbortError'));
    pending.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
  });
}
async function post(url:string,orgId:string,fields:Record<string,unknown>,signal?:AbortSignal,retry=true):Promise<unknown>{
  if(signal?.aborted)throw new DOMException('Detenido','AbortError');
  const token=await abortableResponse(csrf(),signal);
  if(signal?.aborted)throw new DOMException('Detenido','AbortError');
  try{return await request(url,{method:'POST',signal,headers:{'Content-Type':'application/json','X-BLK-CSRF':token},body:JSON.stringify({...fields,orgId})});}
  catch(error){if(retry&&error instanceof RequestError&&error.status===403){session=undefined;return post(url,orgId,fields,signal,false);}throw error;}
}
function status(result:unknown):LLMStatus{
  if(!record(result)||typeof result.configured!=='boolean'||result.available!==true||typeof result.endpoint!=='string'||typeof result.deployment!=='string'||typeof result.apiVersion!=='string'||result.storage!=='server-memory')throw new Error('Respuesta de configuración inválida.');
  return {available:true,configured:result.configured,endpoint:result.endpoint,deployment:result.deployment,apiVersion:result.apiVersion,storage:'server-memory'};
}
export function validateDashboardIteration(input:unknown,previous:DashboardConfig|null,kit:Pick<DashboardKit,'validate'>,allowDataChanges=false):DashboardConfig{
  const config=kit.validate(input);
  if(previous&&!allowDataChanges){
    const same=config.data.length===previous.data.length&&config.data.every((row,index)=>{
      const prior=previous.data[index];return row.date===prior.date&&row.category===prior.category&&row.label===prior.label&&row.value===prior.value&&row.status===prior.status;
    });
    if(!same)throw new Error('Azure intentó cambiar los datos existentes. Autoriza explícitamente el cambio de datos sintéticos y vuelve a solicitarlo, o pide conservarlos.');
  }
  return config;
}
export const llm={
  async status(orgId:string){return status(await request('/api/llm/settings?orgId='+encodeURIComponent(orgId)));},
  async save(orgId:string,fields:LLMFields,signal?:AbortSignal){return status(await post('/api/llm/settings',orgId,{...fields},signal));},
  async clear(orgId:string,signal?:AbortSignal){return status(await post('/api/llm/clear',orgId,{},signal));},
  async test(orgId:string,signal?:AbortSignal){const result=await post('/api/llm/test',orgId,{},signal);if(!record(result)||result.ok!==true)throw new Error('No se verificó la conexión Azure.');return typeof result.message==='string'?result.message:'Conexión JSON verificada con Azure.';},
  async generate(orgId:string,prompt:string,previous:DashboardConfig|null,kit:Pick<DashboardKit,'validate'|'context'>,signal:AbortSignal,allowDataChanges=false){
    kit.context(prompt,previous);
    const result=await post('/api/studio/generate',orgId,{prompt,previous},signal);
    if(!record(result)||result.provider!=='azure-openai'||typeof result.model!=='string'||result.model.length>128)throw new Error('Respuesta de generación inválida.');
    return {config:validateDashboardIteration(result.config,previous,kit,allowDataChanges),model:result.model};
  }
};
