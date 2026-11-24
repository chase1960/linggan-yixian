import {captureRoutes} from './capture.js';
import {validateState,escapeHTML} from '../public/engine.js';
import {workspaceOps} from '../public/ops.js';
import {createStore,authEnabled,login,logout,sessionOwner,readBackupIndex,snapshot,restoreSnapshot,runDaily,platformHealth} from './platform.js';
// ASSETS is injected by scripts/build.mjs. No private material enters this bundle.

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
async function storedText(stored){if(!stored)return null;if(typeof stored.text==='function')return await stored.text();if(typeof stored.json==='function')return JSON.stringify(await stored.json());return null;}
function quoteRevision(state){return '"rev-'+(state?.revision||0)+'"';}
// 学习分支的版本号由内容本身计算，避免托管边缘改写响应头 ETag 后无法比对。
function learningRevision(text){let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return 'lr-'+(h>>>0).toString(16).padStart(8,'0');}
async function bucketText(obj){if(typeof obj.text==='function')return obj.text();if(typeof obj.json==='function')return JSON.stringify(await obj.json());return typeof obj.body==='string'?obj.body:'';}
// 新增的写入协议不能删除历史：整份 PUT 时，任何已有编号消失都视为回退，必须拒绝。
function lostHistory(current,incoming){
 for(const key of ['records','sources','skills','actions','feedback','reviews','events','profiles','documents']){
  const ids=new Set((incoming?.[key]||[]).map(x=>x&&x.id));
  if((current?.[key]||[]).some(x=>x&&!ids.has(x.id)))return key;
 }
 if(current?.lab){
  if(!incoming?.lab)return 'lab';
  for(const key of ['models','observations','scenarios','states','experiments','configHistory']){
   const ids=new Set((incoming.lab[key]||[]).map(x=>x&&x.id));
   if((current.lab[key]||[]).some(x=>x&&!ids.has(x.id)))return 'lab.'+key;
  }
 }
 return null;
}
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
 },
 async scheduled(event,env,ctx){
  ctx.waitUntil(runDaily(env).catch(error=>console.error('cron_failed',error?.message||'Error')));
 }
};
function handleFailure(error){
 if(error instanceof SyntaxError)return json({message:'资料格式不是有效的 JSON。'},400);
 if(/资料|数据|记录|字段|编号|集合|口令|备份|操作|修改|保存/.test(error.message||''))return json({message:error.message},400);
 console.error('workspace_request_failed',error?.name||'Error');
 return json({message:'暂时无法完成操作，已保存的资料不会被覆盖。'},500);
}
async function handleRequest(request,env,ctx,url,path){
 try{
  // 健康检查只返回能力与时间，不暴露任何凭证或资料内容。
  if(path==='/api/health'&&['GET','HEAD'].includes(request.method))return json({ok:true,version:'4.2.0',time:new Date().toISOString(),timezone:'Asia/Shanghai',...await platformHealth(env)},200,{'Cache-Control':'no-store'});
  if(path==='/api/auth/login'&&request.method==='POST'){
   if(!env.DB)return json({message:'当前站点未配置数据库。'},503);
   const body=await request.json().catch(()=>({}));
   const result=await login(request,env,env.DB,body);
   return result.status===200?json(result.body,200,{'Set-Cookie':result.cookie}):json({message:result.message},result.status);
  }
  if(path==='/api/auth/logout'&&request.method==='POST'){
   const cookie=await logout(request,env,env.DB);
   return json({ok:true},200,{'Set-Cookie':cookie});
  }
  const workspace={load:async()=>(await createStore(env)).load(),apply:async ops=>(await createStore(env)).apply(ops)};
  const capture=await captureRoutes(request,env,{json,userIdentity,serviceAuthorized,STATE_KEY:'owner/digital-self-v2/workspace.json',LEARNING_KEY:'learning/public-records-v1.json',escapeHTML,workspace});if(capture)return capture;
  if(path==='/learning')return Response.redirect(url.origin+'/learning/'+url.search,308);
  if(path==='/learning/feed.json'&&request.method==='GET'){
   const stored=await env.BUCKET?.get('learning/public-records-v1.json');
   if(stored)return new Response(stored.body,{headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','ETag':'"'+stored.etag+'"'}});
   const seed=ASSETS['/learning/records.json'];
   return new Response(Uint8Array.from(atob(seed.body),c=>c.charCodeAt(0)),{headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  }
  if(path==='/api/learning-authoring'){
   const service=equalSecret(request.headers.get('Authorization')||'',env.LEARNING_SERVICE_TOKEN?'Bearer '+env.LEARNING_SERVICE_TOKEN:'');
   if(!service)return json({message:'学习分支写入需要授权。'},401);
   if(!env.BUCKET)return json({message:'学习存储尚未配置。'},503);
   const key='learning/public-records-v1.json',existing=await env.BUCKET.get(key);
   if(request.method==='GET'){
    if(!existing)return json({message:'尚未初始化。'},404);
    const text=await bucketText(existing),tag='"'+learningRevision(text)+'"';
    return new Response(text,{headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','ETag':tag}});
   }
   if(request.method!=='PUT')return json({message:'仅支持读取或保存。'},405);
   if(existing){
    const current='"'+learningRevision(await bucketText(existing))+'"';
    const match=request.headers.get('If-Match');
    if(match!==current&&match!=='"'+existing.etag+'"')return json({message:'版本已变化，请重新读取并合并。'},409);
   }
   if(!existing&&request.headers.get('If-None-Match')!=='*')return json({message:'初始化需要显式防覆盖条件。'},428);
   const raw=await request.text();if(new TextEncoder().encode(raw).length>MAX_BYTES)return json({message:'资料超过上限。'},413);
   const value=JSON.parse(raw);
   if(value.schemaVersion!==1||!Array.isArray(value.articles)||!Array.isArray(value.methods)||!Array.isArray(value.history)||value.articles.length>1000)return json({message:'学习资料格式不正确。'},400);
   const ids=new Set();for(const a of value.articles){if(typeof a.id!=='string'||ids.has(a.id)||typeof a.title!=='string'||!Array.isArray(a.summary)||typeof a.url!=='string'||!a.url.startsWith('https://'))return json({message:'文章字段不正确或编号重复。'},400);ids.add(a.id);}
   if(existing){const old=JSON.parse(await bucketText(existing));if(old.articles.some(a=>!ids.has(a.id)))return json({message:'请保留已有文章，使用版本记录标记被替代内容。'},409);}
   const saved=await env.BUCKET.put(key,raw,{onlyIf:existing?{etagMatches:existing.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
   if(!saved)return json({message:'并发更新，本次没有覆盖。'},409);
   return json({status:'saved',articles:value.articles.length,methods:value.methods.length},200,{'ETag':'"'+learningRevision(raw)+'"'});
  }
  if(path==='/api/identity'){
   if(request.method!=='GET')return json({message:'此接口仅支持读取。'},405);
   const identity=userIdentity(request,env),session=authEnabled(env)?await sessionOwner(request,env):false;
   return json({...identity,owner:identity.owner||session,authMode:authEnabled(env)?'passcode':'sites',login:authEnabled(env)?'/login':'/signin-with-chatgpt'});
  }
  if(path.startsWith('/api/')){
   const service=serviceAuthorized(request,env),identity=userIdentity(request,env),session=authEnabled(env)?await sessionOwner(request,env):false,owner=identity.owner||session;
   if(!service&&!owner)return json({message:identity.signedIn?'当前账号无权读取此个人空间。':'请登录创建此空间的账号。'},401);
   if(!env.BUCKET)return json({message:'个人云端存储尚未配置，资料没有写入。'},503);
   if(!['GET','HEAD'].includes(request.method)&&!service&&request.headers.get('Origin')!==url.origin)return json({message:'请求来源不一致。'},403);
   if(path==='/api/bootstrap'){
    if(!service||request.method!=='POST')return json({message:'无权初始化。'},403);
    const store=await createStore(env),existing=await store.load().catch(()=>null);
    if(existing)return json({message:'个人资料已存在；初始化不会覆盖它。'},409);
    const state=await parseBody(request);state.mode='personal';state.revision=1;state.updatedAt=new Date().toISOString();
    await store.replace(state);
    return json({status:'saved',revision:1,records:state.records.length,sources:state.sources.length},201);
   }
   if(path==='/api/workspace/apply'){
    if(request.method!=='POST')return json({message:'此接口仅支持提交修改。'},405);
    if(Number(request.headers.get('Content-Length')||0)>MAX_BYTES)return json({message:'资料超过本版 2 MB 上限。'},413);
    const raw=await request.text();if(new TextEncoder().encode(raw).length>MAX_BYTES)return json({message:'资料超过本版 2 MB 上限。'},413);
    let payload;try{payload=JSON.parse(raw);}catch{return json({message:'修改内容不是有效的 JSON。'},400);}
    const store=await createStore(env),result=await store.apply(payload?.ops);
    return json({status:'saved',revision:result.revision,ops:result.ops},200);
   }
   if(path==='/api/workspace/backups'&&request.method==='GET')return json({items:await readBackupIndex(env)});
   if(path==='/api/workspace/backup'&&request.method==='POST'){
    const store=await createStore(env),result=await snapshot(env,store,{reason:'manual'});
    return json({status:'saved',...result},201);
   }
   if(path==='/api/workspace/restore'&&request.method==='POST'){
    const body=await request.json().catch(()=>({}));
    if(body?.confirm!==true)return json({message:'恢复会覆盖当前资料；请先下载备份并显式确认。'},400);
    const key=String(body.key||'');
    if(!key.startsWith('owner/digital-self-v2/backups/'))return json({message:'备份编号不正确。'},400);
    const stored=await env.BUCKET.get(key);
    if(!stored)return json({message:'找不到这份备份。'},404);
    let state=null;try{state=JSON.parse(await storedText(stored));}catch{state=null;}
    if(!state)return json({message:'备份内容无法解析。'},400);
    const store=await createStore(env);
    let before=null;try{before=await snapshot(env,store,{reason:'before-restore'});}catch{}
    const current=await store.load().catch(()=>null);
    state.revision=Math.max(Number(current?.state?.revision||0),Number(state.revision||0))+1;
    const result=await store.replace(state);
    return json({status:'restored',...result,beforeRestore:before?.key||null},200);
   }
   if(path==='/api/workspace'){
    const store=await createStore(env);
    if(request.method==='GET'){
     let loaded;try{loaded=await store.load();}catch{return json({message:'个人资料尚未完成初始化。'},404);}
     if(!loaded)return json({message:'个人资料尚未完成初始化。'},404);
     return new Response(JSON.stringify(loaded.state),{status:200,headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie, Authorization','ETag':quoteRevision(loaded.state)}});
    }
    if(request.method==='PUT'){
     const match=request.headers.get('If-Match');if(!match)return json({message:'请先读取当前版本，再保存修改。'},428);
     const current=await store.load().catch(()=>null);
     if(!current){
      if(match!=='new')return json({message:'请先读取个人空间，再保存第一条记录。'},428);
      const state=await parseBody(request);state.mode='personal';state.revision=1;state.updatedAt=new Date().toISOString();
      await store.replace(state);
      return json({status:'saved',revision:1,updatedAt:state.updatedAt},201,{'ETag':'"rev-1"'});
     }
     if(match!==quoteRevision(current.state)&&match!=='new')return json({message:'其他页面已更新这份资料。请刷新后重试；本页修改仍保留。'},409);
     const incoming=await parseBody(request);
     const lost=lostHistory(current.state,incoming);
     if(lost)return json({message:'请保留已有资料与历史；如需停用，请使用修订或停用标记，不要删除记录。'},409);
     const ops=workspaceOps(current.state,incoming);
     if(!ops.length){const touched=await store.touch();return json({status:'saved',revision:touched.revision,updatedAt:new Date().toISOString()},200,{'ETag':'"rev-'+touched.revision+'"'});}
     const result=await store.apply(ops);
     return json({status:'saved',revision:result.revision,updatedAt:new Date().toISOString()},200,{'ETag':'"rev-'+result.revision+'"'});
    }
    return json({message:'不支持的资料操作。'},405);
   }
   if(path==='/api/notices'){
    if(request.method!=='GET')return json({message:'此接口仅支持读取。'},405);
    if(!env.DB)return json({items:[]});
    const rows=await env.DB.prepare('SELECT id,kind,title,body,created_at AS createdAt FROM ds_notice WHERE read_at IS NULL ORDER BY created_at DESC LIMIT 20').all();
    return json({items:rows.results||[]});
   }
   if(path.startsWith('/api/notices/')&&request.method==='POST'&&env.DB){
    const id=path.slice('/api/notices/'.length);
    await env.DB.prepare('UPDATE ds_notice SET read_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
    return json({ok:true});
   }
   return json({message:'找不到这个接口。'},404);
  }
  if(!['GET','HEAD'].includes(request.method))return json({message:'不支持的请求。'},405);
  let assetPath=path==='/'?'/index.html':path==='/learning'||path==='/learning/'?'/learning/index.html':path==='/guide'||path==='/guide/'?'/guide/index.html':path==='/login'||path==='/login/'?'/login/index.html':path;
  if(assetPath.startsWith('/downloads/'))assetPath='/guide'+assetPath;
  const asset=ASSETS[assetPath];if(!asset)return new Response('页面不存在。',{status:404,headers:SECURITY});
  const bytes=Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0));
  return new Response(request.method==='HEAD'?null:bytes,{headers:{...SECURITY,'Content-Type':asset.type,'Cache-Control':/\.(html|js|css)$/.test(assetPath)?'no-cache':'public, max-age=300'}});
 }catch(error){throw error;}
}
