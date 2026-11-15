/** Host-private credentials. Never put this object in a playback plan/readout. */
export interface MediaAuthorization {handle:string;origin:string;pathPrefix:string;headers:Record<string,string>}
export interface NativeMediaRequest {type:'native-media-request';requestId:number;handle:string;url:string}
export interface NativeMediaReply {requestId:number;handle:string;url:string;expiresAt:number}
export interface MediaRequestPolicy {
  allows(url:URL):boolean;
  fetch:typeof fetch;
  /** A private copy for a dedicated demux worker, not a UI/telemetry DTO. */
  authorization():MediaAuthorization|undefined;
}
// Plex identifies its playback client with these headers as well as the token.
// Keep the set explicit: no caller-controlled transport or routing headers.
const headerName=/^(accept|authorization|x-plex-token|x-emby-token|x-emby-authorization|x-plex-product|x-plex-version|x-plex-client-identifier|x-plex-platform|x-plex-device-name)$/i;
const urlSecrets=/^(api_key|x-plex-token|x-emby-token|access_token|authorization)$/i;
const aborted=()=>new DOMException('Media authorization retired','AbortError');

export function parseMediaAuthorization(json:string):MediaAuthorization|undefined {
  if(!json)return undefined;
  try{
    if(json.length>16384)throw 0;
    const value=JSON.parse(json) as MediaAuthorization;
    const origin=new URL(value.origin);
    if(!value||typeof value.handle!=='string'||!value.handle||value.handle.length>256||
      !['https:','http:'].includes(origin.protocol)||origin.origin!==value.origin||origin.username||origin.password||
      typeof value.pathPrefix!=='string'||!value.pathPrefix.startsWith('/')||value.pathPrefix.includes('?')||value.pathPrefix.includes('#')||
      /[\\\u0000-\u0020]|%(?:2f|5c|2e)/i.test(value.pathPrefix)||new URL(value.pathPrefix,origin).pathname!==value.pathPrefix||
      !value.headers||Array.isArray(value.headers)||typeof value.headers!=='object')throw 0;
    const entries=Object.entries(value.headers);
    if(entries.length<1||entries.length>8||entries.some(([key,text])=>!headerName.test(key)||typeof text!=='string'||!text||text.length>8192||/[\u0000-\u001f\u007f]/.test(text)))throw 0;
    return{handle:value.handle,origin:origin.origin,pathPrefix:value.pathPrefix,headers:Object.fromEntries(entries)};
  }catch{throw new Error('Invalid media authorization');}
}
function inside(auth:MediaAuthorization,url:URL){
  return url.origin===auth.origin&&(auth.pathPrefix==='/'||url.pathname===auth.pathPrefix||url.pathname.startsWith(auth.pathPrefix.endsWith('/')?auth.pathPrefix:auth.pathPrefix+'/'));
}
export function permittedMediaURL(input:string|URL,authorization?:MediaAuthorization):URL{
  let url:URL;try{url=new URL(String(input),typeof location==='undefined'?undefined:location.href);}catch{throw new Error('Invalid media URL');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||/%(?:2e|2f|5c|25)/i.test(url.pathname)||
    (authorization?!inside(authorization,url):url.origin!==location.origin))throw new Error('Media URL is outside its authorization scope');
  // Some native HLS publishers repeat a persistent token in child URIs even
  // after header-authenticated manifest reads. Strip it only after validating
  // the origin/path, then use the scoped header for the actual request.
  if(authorization)for(const key of [...url.searchParams.keys()])if(urlSecrets.test(key))url.searchParams.delete(key);
  return url;
}
/** This closure can be created inside a dedicated worker from its private DTO.
 * All redirects are refused, including same-origin redirects, so headers can
 * never escape the exact approved origin/base path. Assets use ordinary fetch. */
export function authorizedMediaFetch(auth?:MediaAuthorization,lifetime?:AbortSignal):typeof fetch{
  return async(input,init)=>{
    lifetime?.throwIfAborted();
    const url=permittedMediaURL(input instanceof Request?input.url:String(input),auth);
    const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    if(auth)for(const [name,value]of Object.entries(auth.headers))headers.set(name,value);
    const requestSignal=init?.signal??(input instanceof Request?input.signal:undefined);
    const signal=lifetime?AbortSignal.any([lifetime,...(requestSignal?[requestSignal]:[])]):requestSignal;
    try{
      const response=await fetch(url,{...init,headers,signal,credentials:auth?'omit':'same-origin',redirect:'error',referrerPolicy:'no-referrer'});
      if(response.url)permittedMediaURL(response.url,auth);
      return response;
    }catch(error){if(signal?.aborted)throw aborted();throw new TypeError('Media request failed');}
  };
}
/** Error text is the sole string that may leave a native credential attachment. */
export function redactMediaError(message:string):string{
  return message.replace(/https?:\/\/[^\s<>"']+/gi,text=>{
    try{const url=new URL(text);return url.origin+url.pathname;}catch{return '[media URL]';}
  }).replace(/\b(?:api_key|x-plex-token|x-emby-token|access_token|authorization|token)\s*[=:]\s*[^\r\n]+/gi,'[media credential]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [redacted]');
}

/** One element's in-memory authorization and native-attach requests. */
export class MediaAccess implements MediaRequestPolicy {
  private value:MediaAuthorization|undefined;
  private json='';private retired=new AbortController();private sequence=0;private disposed=false;
  private pending=new Map<number,{handle:string;url:string;resolve:(url:string)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();
  constructor(private readonly request:(event:NativeMediaRequest)=>void){}
  update(json:string):boolean{
    if(this.disposed)throw aborted();if(json===this.json)return false;
    let next:MediaAuthorization|undefined;
    try{next=parseMediaAuthorization(json);}catch(error){this.retired.abort();this.cancel();this.value=undefined;this.json='';throw error;}
    const changed=next?.handle!==this.value?.handle||JSON.stringify(next)!==JSON.stringify(this.value);
    this.retired.abort();this.retired=new AbortController();this.cancel();this.value=next;this.json=json;
    return changed;
  }
  authorization(){return this.value?{...this.value,headers:{...this.value.headers}}:undefined;}
  allows(url:URL){try{permittedMediaURL(url,this.value);return true;}catch{return false;}}
  fetch:typeof fetch=(input,init)=>authorizedMediaFetch(this.value,this.retired.signal)(input,init);
  nativeURL(url:string,signal:AbortSignal):Promise<string>{
    signal.throwIfAborted();this.retired.signal.throwIfAborted();
    const target=permittedMediaURL(url,this.value);if(!this.value)return Promise.resolve(target.href);
    const requestId=++this.sequence,handle=this.value.handle;
    return new Promise((resolve,reject)=>{
      const operation=AbortSignal.any([signal,this.retired.signal,AbortSignal.timeout(10000)]);
      const abort=()=>{cleanup();reject(aborted());};
      const cleanup=()=>{operation.removeEventListener('abort',abort);this.pending.delete(requestId);};
      operation.addEventListener('abort',abort,{once:true});
      this.pending.set(requestId,{handle,url:target.href,resolve,reject,cleanup});
      try{this.request({type:'native-media-request',requestId,handle,url:target.href});}catch{cleanup();reject(new Error('Native media authorization unavailable'));}
    });
  }
  accept(json:string){
    if(!json||this.disposed)return;
    let reply:NativeMediaReply;try{reply=JSON.parse(json);}catch{return;}
    const pending=this.pending.get(reply.requestId);if(!pending)return;
    try{
      if(!this.value||pending.handle!==this.value.handle||reply.handle!==pending.handle||!Number.isFinite(reply.expiresAt)||reply.expiresAt<=Date.now()||reply.expiresAt>Date.now()+600000)throw 0;
      const url=new URL(reply.url),original=new URL(pending.url);
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||!inside(this.value,url)||url.pathname!==original.pathname)throw 0;
      // Query-only credentials are confined to this native-element attachment.
      pending.cleanup();pending.resolve(url.href);
    }catch{pending.cleanup();pending.reject(new Error('Native media authorization unavailable'));}
  }
  private cancel(){for(const item of [...this.pending.values()]){item.cleanup();item.reject(aborted());}}
  dispose(){if(this.disposed)return;this.disposed=true;this.retired.abort();this.cancel();this.value=undefined;this.json='';}
}
