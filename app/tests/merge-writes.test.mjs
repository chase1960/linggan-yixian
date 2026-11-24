import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../dist/server/index.js';
import {makeEmptyWorkspace,addRecord} from '../public/engine.js';
import {workspaceOps,applyWorkspaceOps} from '../public/ops.js';

class FakeBucket{
 constructor(){this.value=null;this.etag=null;this.failPuts=0;}
 async get(){return this.value?{etag:this.etag,body:this.value,json:async()=>JSON.parse(this.value)}:null;}
 async head(){return this.get();}
 async put(key,value,options={}){
  if(this.failPuts>0){this.failPuts-=1;return null;}
  if(options.onlyIf?.etagDoesNotMatch==='*'&&this.value)return null;
  if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==this.etag)return null;
  this.value=value;this.etag=crypto.createHash('sha256').update(value).digest('hex');return {etag:this.etag};
 }
}
const owner={'oai-authenticated-user-id':'owner-id','oai-authenticated-user-email':'owner@example.com','Origin':'https://example.com'};
const service={'Authorization':'Bearer test-service-token','Origin':'https://example.com'};
function env(){return {WORKSPACE_OWNER_EMAIL:'owner@example.com',WORKSPACE_SERVICE_TOKEN:'test-service-token',BUCKET:new FakeBucket()};}
async function call(e,path,method='GET',body,headers={}){
 const init={method,headers:{...owner,...headers}};
 if(body!==undefined)init.body=JSON.stringify(body);
 return worker.fetch(new Request('https://example.com'+path,init),e,{});
}
async function seeded(){
 const e=env(),state=makeEmptyWorkspace();
 addRecord(state,{text:'第一条用于并发验证的经历内容，包含具体场景。',domain:'personal'});
 const r=await call(e,'/api/bootstrap','POST',state,service);
 assert.equal(r.status,201);
 return {e,state};
}
test('两个页面同时提交不同记录时都保留，互不覆盖',async()=>{
 const {e}=await seeded();
 const a={id:'memory-a',title:'页面 A',summary:'页面 A 的记录',domain:'personal'};
 const b={id:'memory-b',title:'页面 B',summary:'页面 B 的记录',domain:'build'};
 const [ra,rb]=await Promise.all([
  call(e,'/api/workspace/apply','POST',{baseRevision:1,ops:[{collection:'records',item:a}]}),
  call(e,'/api/workspace/apply','POST',{baseRevision:1,ops:[{collection:'records',item:b}]})
 ]);
 assert.equal(ra.status,200);
 assert.equal(rb.status,200);
 const after=await (await call(e,'/api/workspace')).json();
 assert.equal(after.records.length,3);
 assert.ok(after.records.some(r=>r.id==='memory-a'));
 assert.ok(after.records.some(r=>r.id==='memory-b'));
 assert.equal(after.revision,3);
});
test('提交被并发打断时服务端自动重读再合并，不丢修改',async()=>{
 const {e}=await seeded();
 e.BUCKET.failPuts=1;
 const r=await call(e,'/api/workspace/apply','POST',{baseRevision:1,ops:[{collection:'records',item:{id:'memory-c',title:'页面 C',summary:'页面 C 的记录',domain:'knowledge'}}]});
 assert.equal(r.status,200);
 const after=await (await call(e,'/api/workspace')).json();
 assert.ok(after.records.some(x=>x.id==='memory-c'));
 assert.equal(after.revision,2);
});
test('同编号修改覆盖该项，但不会删除其他记录',async()=>{
 const {e}=await seeded();
 const first=await (await call(e,'/api/workspace')).json();
 const changed={...first.records[0],title:'本人更正后的标题'};
 const r=await call(e,'/api/workspace/apply','POST',{baseRevision:1,ops:[{collection:'records',item:changed}]});
 assert.equal(r.status,200);
 const after=await (await call(e,'/api/workspace')).json();
 assert.equal(after.records.length,1);
 assert.equal(after.records[0].title,'本人更正后的标题');
});
test('非法集合、缺少编号与超量操作被拒绝，云端不变',async()=>{
 const {e}=await seeded();
 assert.equal((await call(e,'/api/workspace/apply','POST',{ops:[{collection:'nope',item:{id:'x'}}]})).status,400);
 assert.equal((await call(e,'/api/workspace/apply','POST',{ops:[{collection:'records',item:{title:'没有编号'}}]})).status,400);
 const many=Array.from({length:301},(_,i)=>({collection:'records',item:{id:'bulk-'+i,title:'批量',summary:'批量记录',domain:'personal'}}));
 assert.equal((await call(e,'/api/workspace/apply','POST',{ops:many})).status,400);
 assert.equal((await (await call(e,'/api/workspace')).json()).records.length,1);
});
test('整份覆盖仍需要 If-Match，旧客户端不会误删历史',async()=>{
 const {e}=await seeded();
 const snapshot=await (await call(e,'/api/workspace')).json();
 assert.equal((await call(e,'/api/workspace','PUT',snapshot,{Origin:'https://example.com'})).status,428);
});
test('本地对比只生成发生变化的项',()=>{
 const prev=makeEmptyWorkspace();
 const next=structuredClone(prev);
 addRecord(next,{text:'这是一条新记录，用来确认只提交新增项。',domain:'personal'});
 const ops=workspaceOps(prev,next);
 assert.equal(ops.length,2);
 assert.ok(ops.every(o=>['records','events'].includes(o.collection)));
 assert.equal(applyWorkspaceOps(prev,ops).records.length,1);
 assert.equal(prev.records.length,0);
});
