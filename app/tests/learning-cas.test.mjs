import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../dist/server/index.js';

class MapBucket{
 constructor(){this.items=new Map();}
 async get(k){const v=this.items.get(k);if(v==null)return null;return {body:v,text:async()=>v,json:async()=>JSON.parse(v),etag:crypto.createHash('sha256').update(v).digest('hex')};}
 async head(k){return this.get(k);}
 async put(k,v){this.items.set(k,v);return {etag:crypto.createHash('sha256').update(v).digest('hex')};}
 async delete(k){this.items.delete(k);}
}
const env=()=>({BUCKET:new MapBucket(),LEARNING_SERVICE_TOKEN:'learn-token'});
const auth={'Authorization':'Bearer learn-token'};
function feed(extra={}){
 const articles=[{id:'a1',title:'一篇文章',summary:['摘要'],url:'https://example.com/a'}];
 if(extra.id&&extra.id!=='a1')articles.push({id:extra.id,title:'第二篇',summary:['摘要'],url:'https://example.com/b'});
 return {schemaVersion:1,articles,methods:[],history:[]};
}
async function call(bucket,path,method='GET',body,headers={}){
 const init={method,headers:{...auth,...headers}};
 if(body!==undefined)init.body=typeof body==='string'?body:JSON.stringify(body);
 return worker.fetch(new Request('https://example.com'+path,init),bucket,{});
}

test('学习分支版本号由内容计算，不受边缘改写 ETag 影响',async()=>{
 const b=env();
 const first=await call(b,'/api/learning-authoring','PUT',feed(),{'If-None-Match':'*'});
 assert.equal(first.status,200);
 const tag=first.headers.get('ETag');
 assert.match(tag,/^"lr-[0-9a-f]{8}"$/);
 const read=await call(b,'/api/learning-authoring');
 assert.equal(read.status,200);
 assert.equal(read.headers.get('ETag'),tag);
 assert.deepEqual(await read.json(),feed());
});

test('学习分支用内容版本保存，旧版本被拒绝且不会覆盖',async()=>{
 const b=env();
 const tag=(await call(b,'/api/learning-authoring','PUT',feed(),{'If-None-Match':'*'})).headers.get('ETag');
 const stale=await call(b,'/api/learning-authoring','PUT',feed(),{'If-Match':'"lr-00000000"'});
 assert.equal(stale.status,409);
 const ok=await call(b,'/api/learning-authoring','PUT',feed({id:'a2', extra:true}),{'If-Match':tag});
 assert.equal(ok.status,200);
 assert.deepEqual((await (await call(b,'/api/learning-authoring')).json()).articles.map(a=>a.id),['a1','a2']);
});

test('学习分支仍接受旧的存储 ETag，便于既有脚本平滑迁移',async()=>{
 const b=env();
 const put1=await call(b,'/api/learning-authoring','PUT',feed(),{'If-None-Match':'*'});
 const legacy='"'+crypto.createHash('sha256').update(JSON.stringify(feed())).digest('hex')+'"';
 const r=await call(b,'/api/learning-authoring','PUT',feed(),{'If-Match':legacy});
 assert.equal(r.status,200);
});
