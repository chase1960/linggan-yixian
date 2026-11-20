import {localD1} from './local-d1.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import worker from '../dist/server/index.js';
const localDir=path.resolve('.preview-data');await fs.mkdir(localDir,{recursive:true});
// This adapter only supports local QA. Hosted storage is the native R2 binding.
class LocalBucket{
 file(key){return path.join(localDir,crypto.createHash('sha256').update(key).digest('hex')+'.json');}
 async get(key){try{const bytes=await fs.readFile(this.file(key)),etag=crypto.createHash('sha256').update(bytes).digest('hex');return {body:new Uint8Array(bytes),etag,json:async()=>JSON.parse(bytes.toString()),text:async()=>bytes.toString()};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async head(key){return this.get(key);}
 async put(key,value,options={}){const old=await this.head(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==old?.etag)return null;const bytes=Buffer.from(value),etag=crypto.createHash('sha256').update(bytes).digest('hex');await fs.writeFile(this.file(key),bytes);return {etag};}
}
const env={DB:await localD1(path.join(localDir,'capture.sqlite')),BUCKET:new LocalBucket(),WORKSPACE_OWNER_EMAIL:process.env.WORKSPACE_OWNER_EMAIL||'',WORKSPACE_SERVICE_TOKEN:process.env.WORKSPACE_SERVICE_TOKEN||''};
const server=http.createServer(async(req,res)=>{try{const body=await new Promise(resolve=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>resolve(Buffer.concat(chunks)));});const headers=new Headers(req.headers);const request=new Request('http://'+(req.headers.host||'localhost')+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body}: {})});const response=await worker.fetch(request,env,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end('preview unavailable');}});
const portAt=process.argv.indexOf('--port'),hostAt=process.argv.indexOf('--host');
const port=Number(portAt>=0?process.argv[portAt+1]:process.env.PORT||3000),host=hostAt>=0?process.argv[hostAt+1]:'0.0.0.0';
server.listen(port,host,()=>console.log('Digital self preview listening on '+host+':'+port));
