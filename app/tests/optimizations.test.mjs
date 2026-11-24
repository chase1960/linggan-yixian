import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';
import worker from '../dist/server/index.js';
import {localD1} from '../scripts/local-d1.mjs';
import {makeCapturePacket,captureICS} from '../public/capture-engine.js';
import {makeDemo} from '../public/engine.js';

class MapBucket{
 constructor(){this.items=new Map();}
 async get(k){const v=this.items.get(k);if(v==null)return null;const etag=crypto.createHash('sha256').update(v).digest('hex');return {body:v,etag,json:async()=>JSON.parse(v),text:async()=>v};}
 async head(k){return this.get(k);}
 async put(k,v,o={}){const old=await this.get(k);if(o.onlyIf?.etagDoesNotMatch==='*'&&old)return null;if(o.onlyIf?.etagMatches&&o.onlyIf.etagMatches!==old?.etag)return null;this.items.set(k,v);return {etag:crypto.createHash('sha256').update(v).digest('hex')};}
}
async function setup(){return {DB:await localD1(),BUCKET:new MapBucket(),WORKSPACE_OWNER_EMAIL:'owner@example.com',WORKSPACE_SERVICE_TOKEN:'service-test',CAPTURE_GATEWAY_TOKEN:'gateway-test'};}
const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com',Origin:'https://example.com'};
const service={'Authorization':'Bearer service-test'};
async function call(env,path,method='GET',body,headers=owner){
 return worker.fetch(new Request('https://example.com'+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{});
}
const messages=[{id:'msg-one',text:'待办：修改项目介绍，把观点与证据分开写。',source_timestamp:null,authorship:'user_original',attachments:[]}];
const analysis=[
 {id:'task-one',source_ids:['msg-one'],kind:'task',domain:'build',title:'修改项目介绍',due_at:null,next_action:'先改开头，再补证据'},
 {id:'idea-one',source_ids:['msg-one'],kind:'idea',domain:'build',title:'项目介绍里把观点与证据分开',due_at:null},
 {id:'idea-two',source_ids:['msg-one'],kind:'idea',domain:'knowledge',title:'记录一次评审后的新理解',due_at:null}
];
async function seed(env,batch='batch-one'){const p=await makeCapturePacket({batchId:batch,messages,analysis});return (await call(env,'/api/imports','POST',p)).json();}

test('multi-keyword search requires all terms, ranks title hits and returns a snippet',async()=>{
 const env=await setup();await seed(env);
 const both=await(await call(env,'/api/capture/items?q=修改 介绍')).json();
 assert.equal(both.total,1);
 assert.equal(both.items[0].id,'task-one');
 assert.ok(both.items[0].match.fields.includes('title'));
 assert.ok(both.items[0].match.snippet.length>0);
 const one=await(await call(env,'/api/capture/items?q=修改 论文')).json();
 assert.equal(one.total,0);
 const none=await(await call(env,'/api/capture/items?q=完全不存在的词')).json();
 assert.equal(none.total,0);
 env.DB.close();
});

test('related candidates come from the server and unknown links are rejected',async()=>{
 const env=await setup();await seed(env);
 const rel=await(await call(env,'/api/capture/items/task-one/related')).json();
 assert.equal(rel.items[0].id,'idea-one');
 assert.ok(rel.items[0].shared.length>0);
 assert.ok(rel.note.includes('提示'));
 const ok=await call(env,'/api/capture/items/task-one','PATCH',{related_ids:['idea-one']},{...owner,'If-Match':'1'});
 assert.equal(ok.status,200);
 const bad=await call(env,'/api/capture/items/task-one','PATCH',{related_ids:['ghost-record']},{...owner,'If-Match':'2'});
 assert.equal(bad.status,400);
 env.DB.close();
});

test('writes require If-Match, and completion or reality upgrades need a real result',async()=>{
 const env=await setup();await seed(env);
 assert.equal((await call(env,'/api/capture/items/task-one','PATCH',{status:'doing'},{...owner})).status,428);
 assert.equal((await call(env,'/api/capture/items/task-one','PATCH',{status:'done'},{...owner,'If-Match':'1'})).status,400);
 assert.equal((await call(env,'/api/capture/items/task-one','PATCH',{status:'done',outcome:'改完了，评审时少了两轮澄清'},{...owner,'If-Match':'1'})).status,200);
 assert.equal((await call(env,'/api/capture/items/idea-one','PATCH',{reality:'actual'},{...owner,'If-Match':'1'})).status,400);
 assert.equal((await call(env,'/api/capture/items/idea-one','PATCH',{reality:'actual',outcome:'评审中确实先确认了用户任务，讨论更快聚焦'},{...owner,'If-Match':'1'})).status,200);
 env.DB.close();
});

test('finished tasks can be sedimented into the knowledge tree exactly once',async()=>{
 const env=await setup();await seed(env);
 assert.equal((await call(env,'/api/capture/items/task-one/promote','POST',{},{...owner,'If-Match':'1'})).status,400);
 await call(env,'/api/capture/items/task-one','PATCH',{status:'done',outcome:'改完了，评审时少了两轮澄清'},{...owner,'If-Match':'1'});
 assert.equal((await call(env,'/api/capture/items/task-one/promote','POST',{},{...owner,'If-Match':'2'})).status,409);
 await call(env,'/api/bootstrap','POST',makeDemo(),service);
 const first=await call(env,'/api/capture/items/task-one/promote','POST',{},{...owner,'If-Match':'2'});
 assert.equal(first.status,201);
 const body=await first.json();
 assert.equal(body.status,'promoted');
 assert.equal(body.record_id,'memory-capture-task-one');
 const again=await call(env,'/api/capture/items/task-one/promote','POST',{},{...owner});
 assert.equal(again.status,200);
 assert.equal((await again.json()).status,'exists');
 const workspace=await(await call(env,'/api/workspace')).json();
 const record=workspace.records.find(r=>r.id==='memory-capture-task-one');
 assert.ok(record);
 assert.equal(record.origin,'capture-sediment');
 assert.equal(record.sourceRefs[0].kind,'capture_item');
 assert.equal(workspace.records.length,makeDemo().records.length+1);
 assert.equal(workspace.revision,2);
 env.DB.close();
});

test('review pack summarises results, overdue items and evidence gaps as Markdown',async()=>{
 const env=await setup();await seed(env);
 await call(env,'/api/capture/items/task-one','PATCH',{status:'done',outcome:'改完了，评审时少了两轮澄清'},{...owner,'If-Match':'1'});
 const pack=await(await call(env,'/api/capture/review-pack?days=7')).json();
 assert.equal(pack.range.days,7);
 assert.equal(pack.counts.items,3);
 assert.equal(pack.counts.done_in_range,1);
 assert.equal(pack.highlight.done[0].title,'修改项目介绍');
 assert.ok(pack.markdown.includes('本期实际完成与结果'));
 assert.ok(pack.markdown.includes('下周可以问自己的三个问题'));
 const mcp=await call(env,'/mcp','POST',{jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'capture_review_pack',arguments:{days:7}}});
 const value=await mcp.json();
 assert.equal(mcp.status,200);
 assert.ok(JSON.parse(value.result.content[0].text).markdown.includes('复盘包'));
 const today=await call(env,'/mcp','POST',{jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'capture_today',arguments:{}}});
 assert.equal(today.status,200);
 assert.ok(JSON.parse((await today.json()).result.content[0].text).counts);
 env.DB.close();
});

test('portable export supports scope and since, and rejects unknown scopes',async()=>{
 const env=await setup();await seed(env);
 await call(env,'/api/bootstrap','POST',makeDemo(),service);
 const capture=await call(env,'/api/portable?scope=capture');
 assert.equal(capture.status,200);
 const captureText=new TextDecoder().decode(new Uint8Array(await capture.arrayBuffer()));
 assert.ok(captureText.includes('"batch_id": "batch-one"'));
 assert.equal(captureText.includes('一次项目评审后的新发现'),false);
 assert.equal(capture.headers.get('X-Linggan-Export-Scope'),'capture');
 const workspace=await call(env,'/api/portable?scope=workspace');
 const workspaceText=new TextDecoder().decode(new Uint8Array(await workspace.arrayBuffer()));
 assert.ok(workspaceText.includes('一次项目评审后的新发现'));
 assert.equal(workspaceText.includes('"batch_id": "batch-one"'),false);
 assert.equal((await call(env,'/api/portable?scope=everything')).status,400);
 const incremental=await call(env,'/api/portable?scope=capture&since=2099-01-01T00:00:00Z');
 const incrementalText=new TextDecoder().decode(new Uint8Array(await incremental.arrayBuffer()));
 assert.ok(incrementalText.includes('"capture_items": []'));
 env.DB.close();
});

test('calendar export adds a display alarm, calendar name and includes overdue tasks',()=>{
 const base={id:'task',kind:'task',due_at:'2026-12-01T10:00:00+08:00',schedule_confirmed:true,status:'ready',updated_at:'2026-11-14T10:00:00Z',title:'标题'};
 const text=captureICS([base,{...base,id:'late',due_at:'2026-11-01T10:00:00+08:00'}],{alarmMinutes:30});
 assert.equal((text.match(/BEGIN:VALARM/g)||[]).length,2);
 assert.ok(text.includes('TRIGGER:-PT30M'));
 assert.ok(text.includes('X-WR-CALNAME:'));
 assert.ok(text.includes('DTEND:'));
 const off=captureICS([base],{alarmMinutes:0});
 assert.equal(off.includes('BEGIN:VALARM'),false);
});

test('health probe and request id expose no secrets',async()=>{
 const env=await setup();
 const health=await call(env,'/api/health','GET',null,{});
 assert.equal(health.status,200);
 const body=await health.json();
 assert.equal(body.ok,true);
 assert.equal(body.storage.database,true);
 assert.equal(JSON.stringify(body).includes('gateway-test'),false);
 assert.ok((health.headers.get('X-Request-Id')||'').length>=8);
 const identity=await call(env,'/api/identity');
 assert.ok((identity.headers.get('X-Request-Id')||'').length>=8);
 assert.match(identity.headers.get('Server-Timing'),/dur=/);
 env.DB.close();
});

test('private names are gone from source and bundle',async()=>{
 const bundle=await fs.readFile('dist/server/index.js','utf8');
 const build=await fs.readFile('scripts/build.mjs','utf8');
 for(const name of ['白月光','许飞','懂事是为了','王福敏']){
  assert.equal(bundle.includes(name),false,'bundle must not include '+name);
  assert.equal(build.includes(name),false,'build script must not include '+name);
 }
 assert.ok(build.includes('private-terms.txt'));
});
