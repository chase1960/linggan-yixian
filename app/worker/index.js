import {captureRoutes} from './capture.js';
import {validateState,escapeHTML} from '../public/engine.js';
import {applyWorkspaceOps} from '../public/ops.js';
// ASSETS is injected by scripts/build.mjs. No private material enters this bundle.

const STATE_KEY='owner/digital-self-v2/workspace.json';
const LEARNING_KEY='learning/public-records-v1.json';
const MAX_BYTES=2_000_000;
const SECURITY={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com; base-uri 'self'; object-src 'none'"};
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie, Authorization',...headers}});}
function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length||!a.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0;}
function serviceAuthorized(request,env){const auth=request.headers.get('Authorization')||'';return equalSecret(auth,env.WORKSPACE_SERVICE_TOKEN?'Bearer '+env.WORKSPACE_SERVICE_TOKEN:'');}
function userIdentity(request,env){
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 const signedIn=Boolean(userId&&email),owner=signedIn&&Boolean(env.WORKSPACE_OWNER_EMAIL)&&email.trim().toLowerCase()===env.WORKSPACE_OWNER_EMAIL.trim().toLowerCase();
 let name='我的空间';if(owner&&request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{name=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')||'我的空间');}catch{}}
 return {signedIn,owner,displayName:owner?name:null,modelAnalysis:'not_connected',analysisMode:'evidence_compiler'};
}
async function parseBody(request){if(Number(request.headers.get('Content-Length')||0)>MAX_BYTES)throw Error('资料超过本版 2 MB 上限。');const raw=await request.text();if(new TextEncoder().encode(raw).length>MAX_BYTES)throw Error('资料超过本版 2 MB 上限。');return validateState(JSON.parse(raw));}
function quoteEtag(obj){return '"'+obj.etag+'"';}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,started=Date.now(),rid=(request.headers.get('X-Request-Id')||'').slice(0,64)||crypto.randomUUID();
  let response;
  try{response=await handleRequest(request,env,ctx,url,path);}
  catch(error){response=handleFailure(error);}
  const headers=new Headers(response.headers);
  headers.set('X-Request-Id',rid);
  headers.set('Server-Timing','app;dur='+(Date.now()-started));
  console.log(JSON.stringify({event:'request',request_id:rid,method:request.method,path,status:response.status,duration_ms:Date.now()-started}));
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
};
function handleFailure(error){
 if(error instanceof SyntaxError)return json({message:'资料格式不是有效的 JSON。'},400);
 if(/资料|数据|记录|字段|编号|集合/.test(error.message||''))return json({message:error.message},400);
 console.error('workspace_request_failed',error?.name||'Error');
 return json({message:'暂时无法完成操作，已保存的资料不会被覆盖。'},500);
}
async function handleRequest(request,env,ctx,url,path){
 try{
  // 健康检查只返回布尔能力，不暴露任何凭证或资料内容。
  if(path==='/api/health'&&['GET','HEAD'].includes(request.method))return json({ok:true,version:'4.1.1',time:new Date().toISOString(),timezone:'Asia/Shanghai',storage:{database:Boolean(env.DB),bucket:Boolean(env.BUCKET)}},200,{'Cache-Control':'no-store'});
   const capture=await captureRoutes(request,env,{json,userIdentity,serviceAuthorized,STATE_KEY,LEARNING_KEY,escapeHTML});if(capture)return capture;
   if(path==='/learning')return Response.redirect(url.origin+'/learning/'+url.search,308);
   if(path==='/learning/feed.json'&&request.method==='GET'){
    const stored=await env.BUCKET?.get(LEARNING_KEY);
    if(stored)return new Response(stored.body,{headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','ETag':quoteEtag(stored)}});
    const seed=ASSETS['/learning/records.json'];
    return new Response(Uint8Array.from(atob(seed.body),c=>c.charCodeAt(0)),{headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
   }
   if(path==='/api/learning-authoring'){
    const service=equalSecret(request.headers.get('Authorization')||'',env.LEARNING_SERVICE_TOKEN?'Bearer '+env.LEARNING_SERVICE_TOKEN:'');
    if(!service)return json({message:'学习分支写入需要授权。'},401);
    if(!env.BUCKET)return json({message:'学习存储尚未配置。'},503);
    const existing=await env.BUCKET.get(LEARNING_KEY);
    if(request.method==='GET')return existing?new Response(existing.body,{headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','ETag':quoteEtag(existing)}}):json({message:'尚未初始化。'},404);
    if(request.method!=='PUT')return json({message:'仅支持读取或保存。'},405);
    if(existing&&request.headers.get('If-Match')!==quoteEtag(existing))return json({message:'版本已变化，请重新读取并合并。'},409);
    if(!existing&&request.headers.get('If-None-Match')!=='*')return json({message:'初始化需要显式防覆盖条件。'},428);
    const raw=await request.text();if(new TextEncoder().encode(raw).length>MAX_BYTES)return json({message:'资料超过上限。'},413);
    const value=JSON.parse(raw);
    if(value.schemaVersion!==1||!Array.isArray(value.articles)||!Array.isArray(value.methods)||!Array.isArray(value.history)||value.articles.length>1000)return json({message:'学习资料格式不正确。'},400);
    const ids=new Set();for(const a of value.articles){if(typeof a.id!=='string'||ids.has(a.id)||typeof a.title!=='string'||!Array.isArray(a.summary)||typeof a.url!=='string'||!a.url.startsWith('https://'))return json({message:'文章字段不正确或编号重复。'},400);ids.add(a.id);}
    if(existing){const old=await existing.json();if(old.articles.some(a=>!ids.has(a.id)))return json({message:'请保留已有文章，使用版本记录标记被替代内容。'},409);}
    const saved=await env.BUCKET.put(LEARNING_KEY,JSON.stringify(value),{onlyIf:existing?{etagMatches:existing.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
    if(!saved)return json({message:'并发更新，本次没有覆盖。'},409);
    return json({status:'saved',articles:value.articles.length,methods:value.methods.length},200,{'ETag':quoteEtag(saved)});
   }
   if(path==='/api/identity'){
    if(request.method!=='GET')return json({message:'此接口仅支持读取。'},405);
    return json(userIdentity(request,env));
   }
   if(path.startsWith('/api/')){
    const service=serviceAuthorized(request,env),identity=userIdentity(request,env);
    if(!service&&!identity.owner)return json({message:identity.signedIn?'当前账号无权读取此个人空间。':'请登录创建此空间的账号。'},401);
    if(!env.BUCKET)return json({message:'个人云端存储尚未配置，资料没有写入。'},503);
    if(!['GET','HEAD'].includes(request.method)&&!service&&request.headers.get('Origin')!==url.origin)return json({message:'请求来源不一致。'},403);
    if(path==='/api/bootstrap'){
     if(!service||request.method!=='POST')return json({message:'无权初始化。'},403);
     const existing=await env.BUCKET.head(STATE_KEY);if(existing)return json({message:'个人资料已存在；初始化不会覆盖它。'},409);
     const state=await parseBody(request);state.mode='personal';state.revision=1;state.updatedAt=new Date().toISOString();
     const result=await env.BUCKET.put(STATE_KEY,JSON.stringify(state),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
     if(!result)return json({message:'资料已被另一个请求初始化。'},409);
     return json({status:'saved',revision:1,records:state.records.length,sources:state.sources.length},201,{'ETag':quoteEtag(result)});
    }
    if(path==='/api/workspace/apply'){
     if(request.method!=='POST')return json({message:'此接口仅支持提交修改。'},405);
     if(Number(request.headers.get('Content-Length')||0)>MAX_BYTES)return json({message:'资料超过本版 2 MB 上限。'},413);
     const raw=await request.text();if(new TextEncoder().encode(raw).length>MAX_BYTES)return json({message:'资料超过本版 2 MB 上限。'},413);
     let payload;try{payload=JSON.parse(raw);}catch{return json({message:'修改内容不是有效的 JSON。'},400);}
     const ops=payload?.ops;
     if(payload?.baseRevision!=null&&!Number.isInteger(Number(payload.baseRevision)))return json({message:'版本号不正确。'},400);
     // 操作集合可能被并发写入打断，重试读取最新版本再合并，最多 5 次。
     for(let attempt=0;attempt<5;attempt++){
      const existing=await env.BUCKET.get(STATE_KEY);
      if(!existing)return json({message:'个人空间尚未初始化，请先完成第一次保存。'},409);
      const old=await existing.json();
      let state;try{state=applyWorkspaceOps(old,ops);}catch(error){return json({message:error.message||'修改内容不正确。'},400);}
      state.mode='personal';state.revision=(old.revision||1)+1;state.updatedAt=new Date().toISOString();
      validateState(state);
      const saved=await env.BUCKET.put(STATE_KEY,JSON.stringify(state),{onlyIf:{etagMatches:existing.etag},httpMetadata:{contentType:'application/json'}});
      if(saved)return json({status:'saved',revision:state.revision,ops:Array.isArray(ops)?ops.length:0,attempts:attempt+1},200);
     }
     return json({message:'检测到另一处正在写入，本次没有覆盖。你的修改仍保留在本页，可以稍后重试同步。'},409);
    }
    if(path==='/api/workspace'){
     if(request.method==='GET'){
      const stored=await env.BUCKET.get(STATE_KEY);if(!stored)return json({message:'个人资料尚未完成初始化。'},404);
      return new Response(stored.body,{status:200,headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie, Authorization','ETag':quoteEtag(stored)}});
     }
     if(request.method==='PUT'){
      const match=request.headers.get('If-Match');if(!match)return json({message:'请先读取当前版本，再保存修改。'},428);
      const existing=await env.BUCKET.get(STATE_KEY);
      if(!existing){
       if(match!=='new')return json({message:'请先读取个人空间，再保存第一条记录。'},428);
       const state=await parseBody(request);state.mode='personal';state.revision=1;state.updatedAt=new Date().toISOString();
       const saved=await env.BUCKET.put(STATE_KEY,JSON.stringify(state),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
       if(!saved)return json({message:'另一个页面已创建个人空间，请刷新后合并。'},409);
       return json({status:'saved',revision:1,updatedAt:state.updatedAt},201,{'ETag':quoteEtag(saved)});
      }
      if(match!==quoteEtag(existing))return json({message:'其他页面已更新这份资料。请先导出本页记录，再刷新合并，避免覆盖。'},409);
      const state=await parseBody(request),old=await existing.json();
      for(const k of ['records','sources','skills','actions','feedback','reviews','events','profiles']){const ids=new Set(state[k].map(x=>x.id));if(old[k].some(x=>!ids.has(x.id)))return json({message:'请保留已有资料与历史，使用停用或修订标记变化。'},409);}
      if(old.lab){if(!state.lab)return json({message:'当前页面版本过旧，请刷新后再保存。'},409);for(const k of ['models','observations','scenarios','states','experiments']){const ids=new Set(state.lab[k].map(x=>x.id));if(old.lab[k].some(x=>!ids.has(x.id)))return json({message:'模型与实验历史需要保留，请先合并当前资料。'},409);}}
      state.mode='personal';state.revision=(old.revision||1)+1;state.updatedAt=new Date().toISOString();
      const saved=await env.BUCKET.put(STATE_KEY,JSON.stringify(state),{onlyIf:{etagMatches:existing.etag},httpMetadata:{contentType:'application/json'}});
      if(!saved)return json({message:'检测到另一处更新，本次未覆盖。请导出本页记录后刷新合并。'},409);
      return json({status:'saved',revision:state.revision,updatedAt:state.updatedAt},200,{'ETag':quoteEtag(saved)});
     }
     return json({message:'不支持的资料操作。'},405);
    }
    return json({message:'找不到这个接口。'},404);
   }
   if(!['GET','HEAD'].includes(request.method))return json({message:'不支持的请求。'},405);
   let assetPath=path==='/'?'/index.html':path==='/learning'||path==='/learning/'?'/learning/index.html':path==='/guide'||path==='/guide/'?'/guide/index.html':path;
   if(assetPath.startsWith('/downloads/'))assetPath='/guide'+assetPath;
   const asset=ASSETS[assetPath];if(!asset)return new Response('页面不存在。',{status:404,headers:SECURITY});
   const bytes=Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0));
   return new Response(request.method==='HEAD'?null:bytes,{headers:{...SECURITY,'Content-Type':asset.type,'Cache-Control':/\.(html|js|css)$/.test(assetPath)?'no-cache':'public, max-age=300'}});
  }catch(error){throw error;}
 }
