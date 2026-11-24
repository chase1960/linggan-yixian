import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {localD1} from '../scripts/local-d1.mjs';
import worker from '../dist/server/index.js';
import {makeEmptyWorkspace,addRecord} from '../public/engine.js';
import {runDaily} from '../worker/platform.js';

class MapBucket{
 constructor(){this.items=new Map();}
 async get(k){const v=this.items.get(k);if(v==null)return null;return {body:v,text:async()=>v,json:async()=>JSON.parse(v),etag:crypto.createHash('sha256').update(v).digest('hex')};}
 async head(k){return this.get(k);}
 async put(k,v){this.items.set(k,v);return {etag:crypto.createHash('sha256').update(v).digest('hex')};}
 async delete(k){this.items.delete(k);}
}
async function setup(extra={}){
 const db=await localD1(':memory:');
 return {DB:db,BUCKET:new MapBucket(),WORKSPACE_OWNER_EMAIL:'owner@example.com',WORKSPACE_SERVICE_TOKEN:'svc-token',...extra};
}
const owner={'oai-authenticated-user-id':'owner-id','oai-authenticated-user-email':'owner@example.com','Origin':'https://example.com'};
const svc={Authorization:'Bearer svc-token','Origin':'https://example.com'};
async function call(env,path,method='GET',body,headers={}){
 const init={method,headers:{...owner,...headers}};
 if(body!==undefined)init.body=JSON.stringify(body);
 return worker.fetch(new Request('https://example.com'+path,init),env,{});
}
async function seeded(){
 const env=await setup(),state=makeEmptyWorkspace();
 addRecord(state,{text:'这条经历用于确认逐条存储和版本流水是否成立。',domain:'personal'});
 assert.equal((await call(env,'/api/bootstrap','POST',state,svc)).status,201);
 return {env,state};
}
test('D1 逐条存储：新增只写一行，读取完整，历史保留旧版本',async()=>{
 const {env}=await seeded();
 const before=await (await call(env,'/api/workspace')).json();
 assert.equal(before.records.length,1);
 const item={...before.records[0],title:'本人更新后的标题'};
 const r=await call(env,'/api/workspace/apply','POST',{ops:[{collection:'records',item}]});
 assert.equal(r.status,200);
 const after=await (await call(env,'/api/workspace')).json();
 assert.equal(after.records.length,1);
 assert.equal(after.records[0].title,'本人更新后的标题');
 const rows=await env.DB.prepare("SELECT COUNT(*) AS n FROM ds_entity WHERE collection='records'").all();
 assert.equal(rows.results[0].n,1);
 const history=await env.DB.prepare('SELECT COUNT(*) AS n FROM ds_history').all();
 assert.ok(history.results[0].n>=1);
 env.DB.close();
});
test('D1 并发提交互不覆盖',async()=>{
 const {env}=await seeded();
 const [a,b]=await Promise.all([
  call(env,'/api/workspace/apply','POST',{ops:[{collection:'records',item:{id:'memory-x',title:'X',summary:'X 记录',domain:'personal'}}]}),
  call(env,'/api/workspace/apply','POST',{ops:[{collection:'records',item:{id:'memory-y',title:'Y',summary:'Y 记录',domain:'build'}}]})
 ]);
 assert.equal(a.status,200);assert.equal(b.status,200);
 const after=await (await call(env,'/api/workspace')).json();
 assert.equal(after.records.length,3);
 env.DB.close();
});
test('备份与恢复：恢复前先留一份，历史数据回到所选快照',async()=>{
 const {env}=await seeded();
 const made=await call(env,'/api/workspace/backup','POST',{});
 assert.equal(made.status,201);
 const list=await (await call(env,'/api/workspace/backups')).json();
 assert.equal(list.items.length,1);
 await call(env,'/api/workspace/apply','POST',{ops:[{collection:'records',item:{id:'memory-z',title:'Z',summary:'Z 记录',domain:'knowledge'}}]});
 const restored=await call(env,'/api/workspace/restore','POST',{key:list.items[0].key,confirm:true});
 assert.equal(restored.status,200);
 const body=await restored.json();
 assert.ok(body.beforeRestore);
 const state=await (await call(env,'/api/workspace')).json();
 assert.equal(state.records.length,1);
 assert.ok(state.revision>1);
 env.DB.close();
});
test('独立口令登录：错误口令被拒，正确口令建立会话并可退出',async()=>{
 const env=await setup({SITE_ACCESS_CODE:'open-sesame-please'});
 const boot=await call(env,'/api/bootstrap','POST',makeEmptyWorkspace(),svc);
 assert.equal(boot.status,201);
 const bad=await call(env,'/api/auth/login','POST',{code:'wrong'},{});
 assert.equal(bad.status,401);
 const good=await call(env,'/api/auth/login','POST',{code:'open-sesame-please'},{});
 assert.equal(good.status,200);
 const cookie=good.headers.get('set-cookie').split(';')[0];
 const anonymous=await worker.fetch(new Request('https://example.com/api/workspace',{headers:{}}),env,{});
 assert.equal(anonymous.status,401);
 const withCookie=await worker.fetch(new Request('https://example.com/api/workspace',{headers:{Cookie:cookie}}),env,{});
 assert.equal(withCookie.status,200);
 const identity=await (await worker.fetch(new Request('https://example.com/api/identity',{headers:{Cookie:cookie}}),env,{})).json();
 assert.equal(identity.owner,true);assert.equal(identity.authMode,'passcode');
 await worker.fetch(new Request('https://example.com/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://example.com'}}),env,{});
 const after=await worker.fetch(new Request('https://example.com/api/workspace',{headers:{Cookie:cookie}}),env,{});
 assert.equal(after.status,401);
 env.DB.close();
});
test('定时任务：生成快照并写入待复查提醒',async()=>{
 const {env}=await seeded();
 const store=await import('../worker/platform.js').then(m=>m.createStore(env));
 const state=(await store.load()).state;
 state.records[0].createdAt=new Date(Date.now()-10*86400000).toISOString();
 state.records[0].review='pending';
 await store.apply([{collection:'records',item:state.records[0]}]);
 const result=await runDaily(env,{now:new Date()});
 assert.ok(result.snapshot.includes('state-'));
 assert.equal(result.notices,1);
 const notices=await (await call(env,'/api/notices')).json();
 assert.equal(notices.items.length,1);
 const health=await (await call(env,'/api/health')).json();
 assert.equal(health.storage.database,true);
 assert.ok(health.meta.lastCron);
 env.DB.close();
});
