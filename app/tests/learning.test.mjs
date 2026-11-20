import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import worker from '../dist/server/index.js';
class Bucket{constructor(){this.items=new Map();}async get(k){const s=this.items.get(k);return s?{etag:s.etag,body:s.value,json:async()=>JSON.parse(s.value)}:null;}async put(k,v,o={}){const old=this.items.get(k);if(o.onlyIf?.etagDoesNotMatch==='*'&&old)return null;if(o.onlyIf?.etagMatches&&o.onlyIf.etagMatches!==old?.etag)return null;const etag=crypto.createHash('sha256').update(v).digest('hex');this.items.set(k,{etag,value:v});return{etag};}}
const seed=JSON.parse(await fs.readFile('public/learning/records.json','utf8'));
const auth={'Authorization':'Bearer scoped-learning-test'};
const env=()=>({BUCKET:new Bucket(),LEARNING_SERVICE_TOKEN:'scoped-learning-test'});
const call=(e,path,method='GET',headers={},body)=>worker.fetch(new Request('https://example.com'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),e,{});
test('learning writer rejects anonymous access and unguarded initialization',async()=>{const e=env();assert.equal((await call(e,'/api/learning-authoring','PUT',{},seed)).status,401);assert.equal((await call(e,'/api/learning-authoring','PUT',auth,seed)).status,428);});
test('learning data persists, reaches public reader, and rejects stale writes and lost articles',async()=>{const e=env();let r=await call(e,'/api/learning-authoring','PUT',{...auth,'If-None-Match':'*'},seed);assert.equal(r.status,200);const tag=r.headers.get('etag');const read=await call(e,'/learning/feed.json');assert.equal((await read.json()).articles.length,3);const update=structuredClone(seed);update.history.push({date:'2026-11-15',change:'test review'});r=await call(e,'/api/learning-authoring','PUT',{...auth,'If-Match':tag},update);assert.equal(r.status,200);assert.equal((await call(e,'/api/learning-authoring','PUT',{...auth,'If-Match':tag},seed)).status,409);const latest=r.headers.get('etag');update.articles.pop();assert.equal((await call(e,'/api/learning-authoring','PUT',{...auth,'If-Match':latest},update)).status,409);});
test('learning seed and route remain available before initialization',async()=>{const e=env();assert.equal((await call(e,'/learning')).status,308);assert.equal((await call(e,'/learning/')).status,200);assert.equal((await (await call(e,'/learning/feed.json')).json()).articles.length,3);});
