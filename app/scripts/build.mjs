import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const config=JSON.parse(await fs.readFile('.openai/hosting.json','utf8'));
if(config.static)throw Error('Worker 项目不应保留 static 配置。');
if(config.r2!=='BUCKET')throw Error('R2 绑定必须为 BUCKET。');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.svg':'image/svg+xml'};
const assets={};
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.name==='__pycache__'||entry.name.endsWith('.pyc'))continue;const p=path.join(dir,entry.name);if(entry.isDirectory())await walk(p);else{const route='/'+path.relative(path.join(root,'public'),p).split(path.sep).join('/');assets[route]={type:types[path.extname(p)]||'application/octet-stream',body:(await fs.readFile(p)).toString('base64')};}}}
await walk(path.join(root,'public'));
// 私人词表不再写进源码：放在 .openai/private-terms.txt（已 gitignore），每次构建读取。
const termsPath=path.join(root,'.openai/private-terms.txt');
let privateTerms=[];
try{privateTerms=(await fs.readFile(termsPath,'utf8')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}catch{}
const textRoute=/\.(html|js|css|json|txt|svg|md)$/i,PII=[/[\w.+-]+@[\w-]+\.[\w.]{2,}/,/1[3-9]\d{9}/];
let scanned=0;
for(const [route,asset] of Object.entries(assets)){
 if(!textRoute.test(route))continue;
 const text=Buffer.from(asset.body,'base64').toString('utf8');scanned+=1;
 for(const term of privateTerms)if(text.includes(term))throw Error('发现私人正文进入公开资产：'+route);
 for(const pattern of PII){const hit=text.match(pattern);if(hit)throw Error('公开资产疑似包含联系方式：'+route+'（'+hit[0].slice(0,3)+'…）；请改用示例地址或移除。');}
}
const engine=(await fs.readFile('public/engine.js','utf8')).replaceAll('export ','');
const worker=(await fs.readFile('worker/index.js','utf8')).replace("import {validateState,escapeHTML} from '../public/engine.js';",'');
const captureEngine=(await fs.readFile('public/capture-engine.js','utf8')).replaceAll('export ','');
const captureWorker=(await fs.readFile('worker/capture.js','utf8')).replace(/^import .*?;$/gm,'').replaceAll('export ','');
const bundle='const ASSETS='+JSON.stringify(assets)+';\n'+engine+'\n'+captureEngine+'\n'+captureWorker+'\n'+worker.replace("import {captureRoutes} from './capture.js';",'');
await fs.mkdir('dist/server',{recursive:true});await fs.mkdir('dist/.openai',{recursive:true});
await fs.writeFile('dist/server/index.js',bundle);await fs.writeFile('dist/.openai/hosting.json',JSON.stringify(config,null,2));
await fs.cp('drizzle','dist/drizzle',{recursive:true});
console.log(JSON.stringify({status:'built',assets:Object.keys(assets).length,workerBytes:Buffer.byteLength(bundle),privateTerms:privateTerms.length,textAssetsScanned:scanned,privateDataInBundle:false}));
