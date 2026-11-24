// 平台层：把工作台状态从「R2 上的一份 JSON」升级为「D1 逐条实体 + 版本流水」，
// 并补上独立登录、每日快照、定时复查提醒与健康检查。
import {applyWorkspaceOps} from '../public/ops.js';

export const LEGACY_STATE_KEY='owner/digital-self-v2/workspace.json';
const COLLECTIONS=['records','sources','skills','actions','feedback','reviews','events','profiles','documents'];
const LAB_KEYS=['models','observations','scenarios','states','experiments','configHistory'];
const BACKUP_INDEX='owner/digital-self-v2/backups/index.json';
const MAX_BACKUPS=30;
const DDL=[
 "CREATE TABLE IF NOT EXISTS ds_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS ds_entity(collection TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,seq INTEGER NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(collection,id))",
 "CREATE TABLE IF NOT EXISTS ds_history(rowid INTEGER PRIMARY KEY AUTOINCREMENT,collection TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,saved_at TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS ds_session(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,expires_at TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS ds_notice(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT)",
 "CREATE TABLE IF NOT EXISTS ds_login(ip TEXT NOT NULL,at TEXT NOT NULL)",
 "CREATE INDEX IF NOT EXISTS ds_session_expiry ON ds_session(expires_at)"
];
const schemaReady=new WeakMap();
async function ensureSchema(db){
 const pending=schemaReady.get(db);
 if(pending)return pending;
 const promise=(async()=>{for(const sql of DDL)await db.prepare(sql).run();})();
 schemaReady.set(db,promise);
 try{await promise;}catch(error){schemaReady.delete(db);throw error;}
}
function nowISO(){return new Date().toISOString();}
function parse(text,fallback){try{return JSON.parse(text);}catch{return fallback;}}
// R2 不同绑定返回的对象能力不一致（有的只有 json()，有的只有 body），统一成文本。
async function bodyText(stored){
 if(!stored)return null;
 if(typeof stored.text==='function')return await stored.text();
 if(typeof stored.json==='function')return JSON.stringify(await stored.json());
 if(typeof stored.body==='string')return stored.body;
 if(stored.body instanceof Uint8Array)return new TextDecoder().decode(stored.body);
 return null;
}

// ---------- D1 存储 ----------
async function d1Load(db,env){
 await ensureSchema(db);await d1Init(db,env);
 const metaRows=await db.prepare('SELECT key,value FROM ds_meta').all();
 const meta={};for(const row of metaRows.results||[])meta[row.key]=row.value;
 if(meta.initialized!=='1')throw Error('个人资料尚未完成初始化。');
 const rows=await db.prepare('SELECT collection,id,body FROM ds_entity ORDER BY seq DESC').all();
 const state={schemaVersion:Number(meta.schemaVersion||2),revision:Number(meta.revision||0),updatedAt:meta.updatedAt||nowISO(),mode:meta.mode||'personal',
  coverage:meta.coverage?parse(meta.coverage,{}):{},profiles:[],records:[],sources:[],skills:[],actions:[],feedback:[],reviews:[],events:[],documents:[]};
 const lab={};
 for(const key of LAB_KEYS)lab[key]=[];
 for(const row of rows.results||[]){
  const item=parse(row.body,null);
  if(!item)continue;
  if(row.collection.startsWith('lab.')){const key=row.collection.slice(4);if(!LAB_KEYS.includes(key))continue;lab[key].push(item);}
  else if(state[row.collection])state[row.collection].push(item);
 }
 const hasLab=LAB_KEYS.some(key=>lab[key].length)||Boolean(meta.labConfig);
 if(hasLab){lab.schemaVersion=1;lab.config=meta.labConfig?parse(meta.labConfig,{minCases:2,targetObservations:5,reviewDays:7}):{minCases:2,targetObservations:5,reviewDays:7};state.lab=lab;}
 return {state,revision:state.revision,kind:'d1'};
}
function metaValueJSON(value){return typeof value==='string'?value:JSON.stringify(value);}
async function d1MetaSet(db,batch,key,value){batch.push(db.prepare('INSERT INTO ds_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,metaValueJSON(value)));}
async function d1Init(db,env){
 const row=await db.prepare("SELECT value FROM ds_meta WHERE key='schemaVersion'").first();
 if(row)return;
 const stored=await env.BUCKET?.get(LEGACY_STATE_KEY);
 const state=stored?parse(await bodyText(stored),null)||null:null;
 const batch=[];let seq=1000;
 await d1MetaSet(db,batch,'schemaVersion','2');
 await d1MetaSet(db,batch,'revision',String(state?.revision||1));
 await d1MetaSet(db,batch,'updatedAt',state?.updatedAt||nowISO());
 await d1MetaSet(db,batch,'mode',state?.mode||'personal');
 if(state?.coverage)await d1MetaSet(db,batch,'coverage',JSON.stringify(state.coverage));
 if(state?.lab?.config)await d1MetaSet(db,batch,'labConfig',JSON.stringify(state.lab.config));
 if(state)await d1MetaSet(db,batch,'initialized','1');
 for(const collection of COLLECTIONS){
  const list=Array.isArray(state?.[collection])?state[collection]:[];
  list.forEach((item,index)=>{if(!item||typeof item.id!=='string')return;seq+=1;batch.push(db.prepare('INSERT INTO ds_entity(collection,id,body,seq,saved_at) VALUES(?,?,?,?,?) ON CONFLICT(collection,id) DO NOTHING').bind(collection,item.id,JSON.stringify(item),list.length-index,nowISO()));});
 }
 if(state?.lab)for(const key of LAB_KEYS){
  const list=Array.isArray(state.lab[key])?state.lab[key]:[];
  list.forEach((item,index)=>{if(!item||typeof item.id!=='string')return;seq+=1;batch.push(db.prepare('INSERT INTO ds_entity(collection,id,body,seq,saved_at) VALUES(?,?,?,?,?) ON CONFLICT(collection,id) DO NOTHING').bind('lab.'+key,item.id,JSON.stringify(item),list.length-index,nowISO()));});
 }
 await d1MetaSet(db,batch,'seq',String(seq));
 if(state)batch.push(db.prepare("INSERT OR IGNORE INTO ds_notice(id,kind,title,body,created_at) VALUES(?,?,?,?,?)").bind('notice-migrated','system','数据已迁入逐条存储','原 JSON 文档已导入 D1，历史仍保留在 R2 快照中。',nowISO()));
 await db.batch(batch);
}
async function d1Apply(db,env,ops){
 await ensureSchema(db);await d1Init(db,env);
 const stateRow=await db.prepare("SELECT value FROM ds_meta WHERE key='initialized'").first();
 if(stateRow?.value!=='1')throw Error('个人空间尚未初始化，请先完成第一次保存。');
 if(!Array.isArray(ops)||!ops.length)throw Error('没有需要保存的修改。');
 if(ops.length>300)throw Error('单次保存的操作过多。');
 const seqRow=await db.prepare("SELECT value FROM ds_meta WHERE key='seq'").first();
 let seq=Number(seqRow?.value||1000);
 const now=nowISO(),batch=[];
 for(const op of ops){
  if(!op||typeof op!=='object')throw Error('操作格式不正确。');
  if(op.collection==='coverage'){await d1MetaSet(db,batch,'coverage',JSON.stringify(op.value));continue;}
  if(op.collection==='lab.config'){await d1MetaSet(db,batch,'labConfig',JSON.stringify(op.value));continue;}
  const item=op.item;
  if(!item||typeof item.id!=='string'||!item.id)throw Error('保存项缺少编号。');
  const collection=op.collection;
  const isLab=typeof collection==='string'&&collection.startsWith('lab.');
  if(!COLLECTIONS.includes(collection)&&!(isLab&&LAB_KEYS.includes(collection.slice(4))))throw Error('未知的数据集合：'+String(collection));
  seq+=1;
  batch.push(db.prepare('INSERT INTO ds_history(collection,id,body,saved_at) SELECT collection,id,body,? FROM ds_entity WHERE collection=? AND id=?').bind(now,collection,item.id));
  batch.push(db.prepare('INSERT INTO ds_entity(collection,id,body,seq,saved_at) VALUES(?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body,saved_at=excluded.saved_at').bind(collection,item.id,JSON.stringify(item),seq,now));
 }
 batch.push(db.prepare("UPDATE ds_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").bind());
 batch.push(db.prepare("INSERT INTO ds_meta(key,value) VALUES('updatedAt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now));
 batch.push(db.prepare("INSERT INTO ds_meta(key,value) VALUES('seq',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(seq)));
 // D1/本地 SQLite 在并发写入时可能拒绝嵌套事务；重试会让后到的操作合并到新版本，而不是丢修改。
 for(let attempt=0;attempt<5;attempt++){
  try{await db.batch(batch);break;}
  catch(error){if(attempt===4)throw error;await new Promise(r=>setTimeout(r,10+attempt*20));}
 }
 const rev=await db.prepare("SELECT value FROM ds_meta WHERE key='revision'").first();
 return {revision:Number(rev?.value||1),ops:ops.length};
}
async function d1Replace(db,env,state){
 await ensureSchema(db);await d1Init(db,env);
 const batch=[],now=nowISO();let seq=1000;
 batch.push(db.prepare('DELETE FROM ds_entity').bind());
 for(const collection of COLLECTIONS){
  const list=Array.isArray(state?.[collection])?state[collection]:[];
  list.forEach((item,index)=>{if(!item||typeof item.id!=='string')return;seq+=1;batch.push(db.prepare('INSERT INTO ds_entity(collection,id,body,seq,saved_at) VALUES(?,?,?,?,?)').bind(collection,item.id,JSON.stringify(item),list.length-index,now));});
 }
 if(state?.lab)for(const key of LAB_KEYS){
  const list=Array.isArray(state.lab[key])?state.lab[key]:[];
  list.forEach((item,index)=>{if(!item||typeof item.id!=='string')return;seq+=1;batch.push(db.prepare('INSERT INTO ds_entity(collection,id,body,seq,saved_at) VALUES(?,?,?,?,?)').bind('lab.'+key,item.id,JSON.stringify(item),list.length-index,now));});
 }
 await d1MetaSet(db,batch,'schemaVersion',String(state?.schemaVersion||2));
 await d1MetaSet(db,batch,'revision',String(Number(state?.revision||1)));
 await d1MetaSet(db,batch,'updatedAt',now);
 await d1MetaSet(db,batch,'mode',state?.mode||'personal');
 await d1MetaSet(db,batch,'coverage',JSON.stringify(state?.coverage||{}));
 if(state?.lab?.config)await d1MetaSet(db,batch,'labConfig',JSON.stringify(state.lab.config));
 await d1MetaSet(db,batch,'seq',String(seq));
 await d1MetaSet(db,batch,'initialized','1');
 await db.batch(batch);
 return {revision:Number(state?.revision||1)};
}
async function d1Health(db){
 try{const r=await db.prepare('SELECT 1 AS ok').first();return Boolean(r?.ok);}catch{return false;}
}

// ---------- R2 整份文档（未绑定 D1 的旧站点仍可用） ----------
async function blobLoad(env){
 const stored=await env.BUCKET.get(LEGACY_STATE_KEY);
 if(!stored)throw Error('个人资料尚未完成初始化。');
 return {state:parse(await bodyText(stored),null),revision:0,kind:'blob',etag:stored.etag};
}
async function blobApply(env,ops){
 const stored=await env.BUCKET.get(LEGACY_STATE_KEY);
 if(!stored)throw Error('个人空间尚未初始化，请先完成第一次保存。');
 for(let attempt=0;attempt<5;attempt++){
  const current=attempt===0?stored:await env.BUCKET.get(LEGACY_STATE_KEY);
  if(!current)throw Error('个人空间尚未初始化，请先完成第一次保存。');
  const old=parse(await bodyText(current),null);
  const merged=applyWorkspaceOps(old,ops);
  merged.mode='personal';merged.revision=(old.revision||1)+1;merged.updatedAt=nowISO();
  const saved=await env.BUCKET.put(LEGACY_STATE_KEY,JSON.stringify(merged),{onlyIf:{etagMatches:current.etag},httpMetadata:{contentType:'application/json'}});
  if(saved)return {revision:merged.revision,ops:ops.length};
 }
 throw Error('检测到另一处正在写入，本次没有覆盖。你的修改仍保留在本页，可以稍后重试同步。');
}
async function blobReplace(env,state){
 const existing=env.BUCKET.head?await env.BUCKET.head(LEGACY_STATE_KEY):await env.BUCKET.get(LEGACY_STATE_KEY);
 if(existing)throw Error('个人资料已存在；初始化不会覆盖它。');
 const saved=await env.BUCKET.put(LEGACY_STATE_KEY,JSON.stringify(state),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 if(!saved)throw Error('资料已被另一个请求初始化。');
 return {revision:Number(state.revision||1)};
}

async function d1Touch(db,env){
 await ensureSchema(db);await d1Init(db,env);
 const now=nowISO();
 await db.batch([
  db.prepare("UPDATE ds_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").bind(),
  db.prepare("INSERT INTO ds_meta(key,value) VALUES('updatedAt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now)
 ]);
 const rev=await db.prepare("SELECT value FROM ds_meta WHERE key='revision'").first();
 return {revision:Number(rev?.value||1),ops:0};
}
async function blobTouch(env){
 const stored=await env.BUCKET.get(LEGACY_STATE_KEY);
 if(!stored){throw Error('个人资料尚未完成初始化。');}
 const state=parse(await bodyText(stored),null);
 state.revision=(Number(state.revision)||1)+1;state.updatedAt=nowISO();
 const saved=await env.BUCKET.put(LEGACY_STATE_KEY,JSON.stringify(state),{onlyIf:{etagMatches:stored.etag},httpMetadata:{contentType:'application/json'}});
 if(!saved)throw Error('检测到另一处正在写入，本次没有覆盖。请稍后重试同步。');
 return {revision:state.revision,ops:0};
}

export async function createStore(env){
 if(env.DB){
  await ensureSchema(env.DB);
  return {kind:'d1',load:()=>d1Load(env.DB,env),apply:ops=>d1Apply(env.DB,env,ops),replace:state=>d1Replace(env.DB,env,state),touch:()=>d1Touch(env.DB,env),health:()=>d1Health(env.DB)};
 }
 return {kind:'blob',load:()=>blobLoad(env),apply:ops=>blobApply(env,ops),replace:state=>blobReplace(env,state),touch:()=>blobTouch(env),health:async()=>Boolean(env.BUCKET)};
}

// ---------- 备份 ----------
function stamp(){return nowISO().replace(/[:.]/g,'-');}
export async function readBackupIndex(env){
 if(!env.BUCKET)return [];
 const stored=await env.BUCKET.get(BACKUP_INDEX);
 return stored?parse(await bodyText(stored),[])||[]:[];
}
export async function snapshot(env,store,{reason='manual'}={}){
 if(!env.BUCKET)throw Error('备份存储尚未配置。');
 const {state}=await store.load();
 const at=nowISO(),key='owner/digital-self-v2/backups/state-'+stamp()+'.json';
 await env.BUCKET.put(key,JSON.stringify(state),{httpMetadata:{contentType:'application/json'}});
 const index=await readBackupIndex(env);
 index.unshift({key,at,reason,revision:state.revision||0});
 while(index.length>MAX_BACKUPS){const dropped=index.pop();try{await env.BUCKET.delete(dropped.key);}catch{}}
 await env.BUCKET.put(BACKUP_INDEX,JSON.stringify(index),{httpMetadata:{contentType:'application/json'}});
 if(env.DB)await env.DB.prepare("INSERT INTO ds_meta(key,value) VALUES('lastSnapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(at).run();
 return {key,at,reason};
}
export async function restoreSnapshot(env,store,key){
 if(!env.BUCKET)throw Error('备份存储尚未配置。');
 if(typeof key!=='string'||!key.startsWith('owner/digital-self-v2/backups/'))throw Error('备份编号不正确。');
 const stored=await env.BUCKET.get(key);
 if(!stored)throw Error('找不到这份备份。');
 const state=parse(await bodyText(stored),null);
 if(!state)throw Error('备份内容无法解析。');
 const result=await store.replace(state);
 return {...result,restored:key};
}

// ---------- 独立登录 ----------
const COOKIE='ds_session';
const SESSION_SECONDS=30*24*60*60;
function cookieValue(request,name){
 const raw=request.headers.get('Cookie')||'';
 for(const part of raw.split(';')){const [k,...rest]=part.trim().split('=');if(k===name)return rest.join('=');}
 return '';
}
async function hmac(env,text){
 const secret=env.SESSION_SECRET||env.SITE_ACCESS_CODE||'';
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text));
 return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0;}
export function authEnabled(env){return Boolean(env.DB&&env.SITE_ACCESS_CODE);}
export async function login(request,env,db,body){
 if(!authEnabled(env))throw Error('当前站点未启用独立登录。');
 const code=String(body?.code||'').trim();
 if(!code||code.length>200)return {status:400,message:'请输入访问口令。'};
 const ip=(request.headers.get('CF-Connecting-IP')||request.headers.get('X-Forwarded-For')||'unknown').split(',')[0].trim();
 const hourAgo=new Date(Date.now()-3600*1000).toISOString();
 const recent=await db.prepare('SELECT COUNT(*) AS n FROM ds_login WHERE ip=? AND at>?').bind(ip,hourAgo).first();
 if(Number(recent?.n||0)>=8)return {status:429,message:'尝试次数过多，请一小时后再试。'};
 if(!equal(code,env.SITE_ACCESS_CODE)){
  await db.prepare('INSERT INTO ds_login(ip,at) VALUES(?,?)').bind(ip,nowISO()).run();
  return {status:401,message:'访问口令不正确。'};
 }
 const id=crypto.randomUUID(),expires=new Date(Date.now()+SESSION_SECONDS*1000).toISOString();
 await db.prepare('INSERT INTO ds_session(id,created_at,expires_at) VALUES(?,?,?)').bind(id,nowISO(),expires).run();
 const sig=await hmac(env,id);
 const secure=String(request.url||'').startsWith('https://')||env.SITE_FORCE_SECURE==='1'?' Secure;':'';
 const cookie=`${COOKIE}=${id}.${sig}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
 return {status:200,cookie,body:{ok:true,expires}};
}
export async function logout(request,env,db){
 const value=cookieValue(request,COOKIE);const id=value.split('.')[0];
 if(id&&db)try{await db.prepare('DELETE FROM ds_session WHERE id=?').bind(id).run();}catch{}
 return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export async function sessionOwner(request,env){
 if(!authEnabled(env))return false;
 const value=cookieValue(request,COOKIE);if(!value)return false;
 const [id,sig]=value.split('.');
 if(!id||!sig)return false;
 if(!equal(sig,await hmac(env,id)))return false;
 try{
  const row=await env.DB.prepare('SELECT expires_at FROM ds_session WHERE id=?').bind(id).first();
  if(!row)return false;
  if(Date.parse(row.expires_at)<Date.now()){await env.DB.prepare('DELETE FROM ds_session WHERE id=?').bind(id).run();return false;}
  return true;
 }catch{return false;}
}

// ---------- 定时任务：快照 + 复查提醒 ----------
export async function runDaily(env,{now=new Date()}={}){
 const store=await createStore(env);
 const result={snapshot:null,notices:0,reminded:false};
 try{result.snapshot=(await snapshot(env,store,{reason:'cron'})).key;}catch(error){result.snapshotError=error.message;}
 let state=null;
 try{state=(await store.load()).state;}catch{}
 if(state){
  const days=(iso)=>{const d=Date.parse(iso);return Number.isFinite(d)?Math.floor((now.getTime()-d)/86400000):null;};
  const dueActions=(state.actions||[]).filter(a=>a.status==='active'&&days(a.createdAt)>=7).length;
  const staleRecords=(state.records||[]).filter(r=>r.review==='pending'&&days(r.createdAt)>=7).length;
  if(env.DB&&(dueActions||staleRecords)){
   const id='notice-'+now.toISOString().slice(0,10);
   const body=`${staleRecords} 条记录待整理；${dueActions} 个已采纳行动超过 7 天没有反馈。`;
   await env.DB.prepare('INSERT OR IGNORE INTO ds_notice(id,kind,title,body,created_at) VALUES(?,?,?,?,?)').bind(id,'review','该把结果带回来了',body,nowISO()).run();
   result.notices=1;
  }
  if(env.FEISHU_WEBHOOK_URL&&now.getUTCDay()===1){
   const text=`灵感一现 · 本周复查\n待整理记录：${staleRecords}\n超过 7 天未反馈行动：${dueActions}\n入口：${env.SITE_URL||'/'}`;
   try{await fetch(env.FEISHU_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msg_type:'text',content:{text}})});result.reminded=true;}catch{}
  }
 }
 if(env.DB)await env.DB.prepare("INSERT INTO ds_meta(key,value) VALUES('lastCron',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(nowISO()).run().catch(()=>{});
 if(env.DB){try{await env.DB.prepare('DELETE FROM ds_session WHERE expires_at<?').bind(nowISO()).run();await env.DB.prepare('DELETE FROM ds_login WHERE at<?').bind(new Date(now.getTime()-7*86400000).toISOString()).run();}catch{}}
 return result;
}
export async function platformHealth(env){
 const store=await createStore(env);
 const health={storage:{database:Boolean(env.DB),bucket:Boolean(env.BUCKET)},engine:store.kind,auth:authEnabled(env)};
 try{health.dbReady=await store.health();}catch{health.dbReady=false;}
 if(env.DB)try{
  const meta=await env.DB.prepare("SELECT key,value FROM ds_meta WHERE key IN ('revision','lastSnapshot','lastCron')").all();
  health.meta=Object.fromEntries((meta.results||[]).map(r=>[r.key,r.value]));
  const notices=await env.DB.prepare('SELECT COUNT(*) AS n FROM ds_notice WHERE read_at IS NULL').first();
  health.unreadNotices=Number(notices?.n||0);
 }catch{}
 return health;
}
