import {validateCapturePacket,sha256,canonical,captureError,validateCaptureEdit,CAPTURE_TIMEZONE,fileBytes,PRINCIPLE_FIELDS} from '../public/capture-engine.js';
const capID=()=>crypto.randomUUID();
function capSafeParse(raw,fallback=null){try{return JSON.parse(raw);}catch{return fallback;}}
function capParse(row){
 if(!row)return null;const body=capSafeParse(row.body,{});
 return {...body,id:row.id,kind:body.kind||row.kind,domain:body.domain||row.domain,title:body.title||row.title||'（正文缺失）',status:row.status,due_at:row.due_at,revision:row.revision,created_at:row.created_at,updated_at:row.updated_at};
}
// 行级字段（id/状态/截止/版本）由表维护；写回正文时剔除，避免旧状态被二次固化。
function capStoreBody(item){const {id,revision,created_at,updated_at,original_analysis,...rest}=item;return JSON.stringify({...rest,original_analysis});}
async function capJSON(req,limit=12000000){const raw=await req.text();if(new TextEncoder().encode(raw).length>limit)throw captureError('导入数据超过上限。',413);try{return JSON.parse(raw);}catch{throw captureError('请提交有效的 JSON 数据。');}}
async function capCredential(req,env){const h=req.headers.get('Authorization')||'';if(!h.startsWith('Bearer wb4.'))return null;const token=h.slice(7);return await env.DB.prepare('SELECT id FROM capture_credentials WHERE hash = ? AND revoked_at IS NULL').bind(await sha256(token)).first();}
// 统一按上海时区取自然日，服务端与前端不再各自拼接时区偏移。
function capDay(at=new Date()){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:CAPTURE_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
 const start=new Date(day+'T00:00:00+08:00').toISOString();
 return {day,start,end:new Date(Date.parse(start)+86400000).toISOString()};
}
function capTerms(query){
 return [...new Set(String(query||'').toLowerCase().split(/[\s,，、;；]+/).map(x=>x.trim()).filter(Boolean))].slice(0,6).map(x=>x.slice(0,40));
}
function capFields(item,terms){
 const map={title:item.title,next_action:item.next_action,outcome:item.outcome,analysis:item.original_analysis?.summary,principles:Object.values(item.principles||{}).join(' ')};
 return Object.entries(map).filter(([,v])=>typeof v==='string'&&terms.some(t=>v.toLowerCase().includes(t))).map(([k])=>k);
}
function capSnippet(item,terms=[]){
 const parts=[item.outcome,item.next_action,item.original_analysis?.summary,item.acceptance_criteria,item.principles?.phenomenon,item.principles?.goal].filter(x=>typeof x==='string'&&x.trim());
 const text=parts.join(' · ').replace(/\s+/g,' ').trim();
 if(!text)return '';
 const hits=terms.map(t=>text.toLowerCase().indexOf(t)).filter(i=>i>=0).sort((a,b)=>a-b);
 const from=hits.length?Math.max(0,hits[0]-30):0;
 return (from?'…':'')+text.slice(from,from+160)+(text.length>from+160?'…':'');
}
async function capSelectIn(env,table,columns,ids){
 const out=new Map(),list=[...new Set(ids||[])].filter(x=>typeof x==='string'&&x);
 for(let i=0;i<list.length;i+=200){const chunk=list.slice(i,i+200);const rows=await env.DB.prepare('SELECT '+columns+' FROM '+table+' WHERE id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk).all();for(const row of rows.results)out.set(row.id,row);}
 return out;
}
async function capState(env,key){
 const stored=await env.BUCKET.get(key);if(!stored)return {state:null,etag:null};
 let state=null;try{state=await stored.json();}catch{state=null;}
 return {state,etag:stored.etag};
}
// 关联可以指向随手记，也可以指向知识树里的记录；已存在的历史关联允许保留，新增的未知编号直接拒绝。
async function capAssertRelated(env,ids,current,workspace){
 const keep=new Set((current||[]).filter(x=>typeof x==='string'));
 const list=[...new Set((ids||[]).filter(x=>typeof x==='string'))];
 if(!list.length)return;
 const found=await capSelectIn(env,'capture_items','id',list);
 let missing=list.filter(id=>!found.has(id)&&!keep.has(id));
 if(missing.length&&workspace){
  try{const {state}=await workspace.load(),recordIds=new Set((state?.records||[]).map(r=>r?.id));missing=missing.filter(id=>!recordIds.has(id));}catch{}
 }
 if(missing.length)throw captureError('关联记录不存在：'+missing.slice(0,3).join('、')+'。请刷新后重新选择。');
}
function capScoreTokens(text){
 const value=String(text||'').toLowerCase(),latin=value.match(/[a-z0-9]{2,}/g)||[],cn=value.match(/[\u4e00-\u9fff]{2,}/g)||[];
 return [...new Set([...latin,...cn.flatMap(s=>[s,...Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2))])])];
}
function capOverlap(a,b){const set=new Set(b);return a.filter(t=>set.has(t));}

export async function ingestCapture(env,packet,credentialId=null){
 const v=await validateCapturePacket(packet),m=v.manifest;
 const existing=await env.DB.prepare('SELECT hash, receipt FROM capture_batches WHERE id = ?').bind(m.batch_id).first();
 if(existing){if(existing.hash!==v.hash)throw captureError('同一批次编号的内容已改变，请创建新批次。',409);return {...capSafeParse(existing.receipt,{}),duplicate:true};}
 const now=new Date().toISOString(),rawKey='capture/batches/'+m.batch_id+'/'+v.hash+'.json';
 const msgHashes=new Map();for(const msg of v.messages)msgHashes.set(msg.id,await sha256(canonical(msg)));
 // 批内一次查出已存在的原消息与拆分项，避免逐条往返。
 const knownMessages=await capSelectIn(env,'capture_messages','id,hash',[...msgHashes.keys()]);
 for(const [id,hash] of msgHashes)if(knownMessages.has(id)&&knownMessages.get(id).hash!==hash)throw captureError('原消息编号已有不同正文，请生成新版本编号。',409);
 const knownItems=await capSelectIn(env,'capture_items','id',v.analysis.map(a=>a.id));
 const items=[];
 for(const a of v.analysis){
  if(knownItems.has(a.id))continue;
  const source=v.messages.filter(msg=>a.source_ids.includes(msg.id));
  const authors=[...new Set(source.map(msg=>msg.authorship))];
  items.push({...a,original_analysis:structuredClone(a),batch_id:m.batch_id,authorship:authors.length===1?authors[0]:'unknown',adoption_status:'pending',evidence_status:'unverified',reality:'unknown',schedule_confirmed:false,source_ids:a.source_ids,next_action:typeof a.next_action==='string'?a.next_action:'',acceptance_criteria:typeof a.acceptance_criteria==='string'?a.acceptance_criteria:'',principles:Object.fromEntries(PRINCIPLE_FIELDS.filter(([k])=>typeof a.principles_draft?.[k]==='string').map(([k])=>[k,a.principles_draft[k].slice(0,6000)])),related_ids:[],status:'inbox',due_at:a.due_at?new Date(a.due_at).toISOString():null,planned_at:null});
 }
 await env.BUCKET.put(rawKey,JSON.stringify(packet),{httpMetadata:{contentType:'application/json'}});
 const receipt={batch_id:m.batch_id,status:'committed',received_at:now,captured_at:m.captured_at,messages:v.messages.length,items:items.length,existing_items:v.analysis.length-items.length,sha256:v.hash};
 const statements=[];
 for(const msg of v.messages)statements.push(env.DB.prepare('INSERT INTO capture_messages (id,hash,body,batch_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hash = CASE WHEN capture_messages.hash = excluded.hash THEN capture_messages.hash ELSE NULL END').bind(msg.id,msgHashes.get(msg.id),JSON.stringify(msg),m.batch_id,now));
 for(const item of items)statements.push(env.DB.prepare('INSERT OR IGNORE INTO capture_items (id,message_ids,kind,domain,title,body,status,due_at,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)').bind(item.id,JSON.stringify(item.source_ids),item.kind,item.domain,item.title,capStoreBody(item),'inbox',item.due_at,now,now));
 statements.push(env.DB.prepare('INSERT INTO capture_batches (id,hash,created_at,captured_at,count,producer,raw_key,receipt,credential_id) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hash = CASE WHEN capture_batches.hash = excluded.hash THEN capture_batches.hash ELSE NULL END').bind(m.batch_id,v.hash,now,m.captured_at,v.messages.length,m.producer,rawKey,JSON.stringify(receipt),credentialId));
 try{await env.DB.batch(statements);}catch(error){if(/constraint|NOT NULL|UNIQUE/i.test(String(error)))throw captureError('并发导入冲突，原有资料没有被覆盖，请核对批次后重试。',409);throw error;}
 return receipt;
}

// 多词检索：所有词都需命中（AND），标题/下一步/结果命中加权排序，并返回命中字段与摘要。
async function listCapture(env,url){
 const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||30)),offset=Math.max(0,Number(url.searchParams.get('offset'))||0),params=[],where=[];
 for(const key of ['kind','domain','status'])if(url.searchParams.get(key)&&url.searchParams.get(key)!=='all'){where.push(key+' = ?');params.push(url.searchParams.get(key));}
 const bucket=url.searchParams.get('bucket');
 if(bucket==='inbox'){where.push("status = 'inbox'");}
 else if(bucket==='done'){where.push("status = 'done'");}
 else if(['today','overdue','unscheduled'].includes(bucket)){
  where.push("kind = 'task' AND status NOT IN ('done','cancelled')");
  if(bucket==='unscheduled')where.push('due_at IS NULL');
  else{const day=capDay();
   if(bucket==='overdue'){where.push("due_at < ? AND json_extract(body,'$.schedule_confirmed') = 1");params.push(day.start);}
   else{where.push("((due_at >= ? AND due_at < ? AND json_extract(body,'$.schedule_confirmed') = 1) OR (json_extract(body,'$.planned_at') >= ? AND json_extract(body,'$.planned_at') < ?))");params.push(day.start,day.end,day.start,day.end);}
  }
 }
 const terms=capTerms(url.searchParams.get('q'));
 for(const term of terms){where.push('(title LIKE ? OR body LIKE ?)');params.push('%'+term+'%','%'+term+'%');}
 if(url.searchParams.get('updated_after')){where.push('updated_at > ?');params.push(url.searchParams.get('updated_after'));}
 const condition=where.length?' WHERE '+where.join(' AND '):'';
 const scoreExpr=terms.map(()=>"(CASE WHEN title LIKE ? THEN 3 ELSE 0 END + CASE WHEN json_extract(body,'$.next_action') LIKE ? THEN 2 ELSE 0 END + CASE WHEN json_extract(body,'$.outcome') LIKE ? THEN 1 ELSE 0 END)").join(' + ');
 const scoreParams=[];for(const term of terms)scoreParams.push('%'+term+'%','%'+term+'%','%'+term+'%');
 const rowsSql='SELECT * FROM capture_items'+condition+' ORDER BY '+(terms.length?'('+scoreExpr+') DESC,':'')+'created_at DESC,id DESC LIMIT ? OFFSET ?';
 const [rows,count]=await Promise.all([
  env.DB.prepare(rowsSql).bind(...params,...scoreParams,limit,offset).all(),
  env.DB.prepare('SELECT COUNT(*) AS n FROM capture_items'+condition).bind(...params).first()
 ]);
 const items=rows.results.map(row=>{
  const item=capParse(row);
  if(terms.length)item.match={terms,fields:capFields(item,terms),snippet:capSnippet(item,terms)};
  return item;
 });
 return {items,total:count.n,offset,limit,next_offset:offset+items.length<count.n?offset+items.length:null,query:{terms}};
}

async function capStatus(env){
 const batches=await env.DB.prepare('SELECT id,created_at,captured_at,count,producer,receipt FROM capture_batches ORDER BY created_at DESC,id DESC LIMIT 20').all();
 const credentials=await env.DB.prepare('SELECT id,label,created_at,revoked_at FROM capture_credentials ORDER BY created_at DESC').all();
 const count=await env.DB.prepare('SELECT kind,COUNT(*) AS n FROM capture_items GROUP BY kind').all();
 return {batches:batches.results.map(b=>({...b,receipt:capSafeParse(b.receipt,{})})),credentials:credentials.results,counts:count.results,storage:'D1 rows + R2 immutable batches',pushEnabled:Boolean(env.CAPTURE_GATEWAY_TOKEN),chatgptReader:'site_mcp',notificationDelivery:'calendar_export_only',timezone:CAPTURE_TIMEZONE};
}

async function capItem(env,id){
 const row=await env.DB.prepare('SELECT * FROM capture_items WHERE id = ?').bind(id).first();
 if(!row)throw captureError('找不到这条随手记。',404);
 const item=capParse(row),sourceIds=[...new Set((item.source_ids||[]).filter(x=>typeof x==='string'))];
 const [messages,history]=await Promise.all([
  sourceIds.length?env.DB.prepare('SELECT id,body FROM capture_messages WHERE id IN ('+sourceIds.map(()=>'?').join(',')+')').bind(...sourceIds).all():{results:[]},
  env.DB.prepare('SELECT revision,body,created_at FROM capture_versions WHERE item_id = ? ORDER BY revision DESC').bind(id).all()
 ]);
 const byId=new Map(messages.results.map(m=>[m.id,capSafeParse(m.body,m.body)])),
  sources=sourceIds.map(sid=>byId.get(sid)).filter(Boolean);
 return {item,sources,versions:history.results.map(h=>({...h,body:capSafeParse(h.body,h.body)}))};
}

async function capUpdate(env,id,input,match,workspace){
 if(match==null||match==='')throw captureError('请先读取当前版本，再保存修改。',428);
 const current=(await capItem(env,id)).item;
 if(String(current.revision)!==String(match))throw captureError('记录已被其他页面修改，请重新打开后合并。',409);
 const allowed=['title','kind','domain','status','due_at','planned_at','schedule_confirmed','next_action','acceptance_criteria','adoption_status','reality','principles','related_ids','outcome'];
 if(Object.keys(input||{}).some(k=>!allowed.includes(k)))throw captureError('修改中包含不能改写的来源字段。');
 const next=validateCaptureEdit(input,current);
 await capAssertRelated(env,next.related_ids,current.related_ids,workspace);
 const now=new Date().toISOString();next.updated_at=now;next.revision=current.revision+1;
 if(next.kind!=='task')next.schedule_confirmed=false;
 next.schedule_confirmed=Boolean(next.schedule_confirmed&&next.due_at);
 const result=await env.DB.batch([
  env.DB.prepare('INSERT INTO capture_versions (id,item_id,revision,body,created_at) SELECT ?,id,revision,body,? FROM capture_items WHERE id = ? AND revision = ? ON CONFLICT(item_id,revision) DO NOTHING').bind(capID(),now,id,current.revision),
  env.DB.prepare('UPDATE capture_items SET kind=?,domain=?,title=?,body=?,status=?,due_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(next.kind,next.domain,next.title,capStoreBody(next),next.status,next.due_at,now,id,current.revision)
 ]);
 if(!result[1].meta.changes)throw captureError('并发修改，本次未覆盖。',409);
 return next;
}

// 相关候选由服务端计算：近 120 条内按标题与正文词重合排序，供本人确认而不是自动写入。
async function captureRelated(env,id){
 const current=(await capItem(env,id)).item;
 const rows=await env.DB.prepare('SELECT * FROM capture_items WHERE id <> ? ORDER BY updated_at DESC,id DESC LIMIT 120').bind(id).all();
 const sourceText=[current.title,current.next_action,current.outcome,current.original_analysis?.summary,...Object.values(current.principles||{})].filter(Boolean).join(' ');
 const sourceTokens=capScoreTokens(sourceText);
 const scored=rows.results.map(capParse).map(item=>{
  const text=[item.title,item.next_action,item.outcome,item.original_analysis?.summary].filter(Boolean).join(' ');
  const shared=capOverlap(sourceTokens,capScoreTokens(text));
  const score=shared.reduce((n,t)=>n+(item.title.toLowerCase().includes(t)?2:1),0)+(item.domain===current.domain?2:0)+(item.kind===current.kind?1:0);
  return {item,shared,score};
 }).filter(row=>row.shared.length&&row.score>=2).sort((a,b)=>b.score-a.score).slice(0,5);
 return {id,items:scored.map(({item,shared,score})=>({id:item.id,title:item.title,kind:item.kind,domain:item.domain,status:item.status,updated_at:item.updated_at,shared:shared.slice(0,6),score,snippet:capSnippet(item,shared.slice(0,3))})),note:'候选关联由关键词重合计算，只是提示，不代表因果或同一件事。'};
}

// 任务完成后显式沉淀：写入知识树的确定性记录 ID，重试不会产生重复条目。
async function promoteCapture(env,id,input,match,helpers){
 const current=(await capItem(env,id)).item;
 if(match!=null&&match!==''&&String(current.revision)!==String(match))throw captureError('记录已被其他页面修改，请刷新后再沉淀。',409);
 if(current.kind!=='task')throw captureError('只有待办/任务可以沉淀为实践经验。');
 if(current.status!=='done')throw captureError('请先把这条任务标记为已完成。');
 const outcome=String(input?.outcome??current.outcome??'').trim();
 if(outcome.length<4)throw captureError('请先写下实际结果（至少 4 个字），再沉淀为经验。');
 const workspace=helpers.workspace;
 let state;try{state=(await workspace.load()).state;}catch{state=null;}
 if(!state||!Array.isArray(state.records))throw captureError('个人空间尚未初始化，暂时无法沉淀到知识树。',409);
 const now=new Date().toISOString(),recordId='memory-capture-'+id;
 let created=false;
 if(!state.records.some(r=>r?.id===recordId)){
  const record={id:recordId,title:(String(input?.title||current.title).trim()||current.title).slice(0,120),summary:outcome.slice(0,280),original:'随手记任务：'+current.title+'\n下一步：'+(current.next_action||'未填写')+'\n实际结果：'+outcome+'\n完成标准：'+(current.acceptance_criteria||'未填写'),type:'experience',domain:current.domain,tags:[],date:now.slice(0,10),createdAt:now,origin:'capture-sediment',reality:'actual',provenance:'user_report',confidence:'medium',review:'pending',status:'active',related:(current.related_ids||[]).slice(0,5),sourceRefs:[{kind:'capture_item',id,label:'随手记：'+current.title,date:now}],questions:['还有哪些因素可能影响了这次结果？'],note:'来自随手记的实际结果，属于本人自述，尚未独立核验。'};
  const event={id:capID(),date:now,type:'capture-sediment',title:'把一条已完成任务沉淀为经验',recordId};
  try{await workspace.apply([{collection:'records',item:record},{collection:'events',item:event}]);}
  catch(error){throw captureError('知识树刚被另一处更新，请刷新后重试沉淀。',409);}
  created=true;
 }
 const next={...current,promoted_record_id:recordId,promoted_at:now,revision:current.revision+1,updated_at:now};
 const written=await env.DB.prepare('UPDATE capture_items SET body=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(capStoreBody(next),now,id,current.revision).run();
 if(!written.meta.changes&&created)throw captureError('记录刚被修改，经验已写入但标记未更新，请刷新后重试。',409);
 return {status:created?'promoted':'exists',record_id:recordId,revision:current.revision+1};
}

async function reviewPack(env,url){
 const days=Math.min(90,Math.max(1,Number(url.searchParams.get('days'))||7)),now=Date.now();
 const from=new Date(now-(days-1)*86400000).toISOString(),rows=await env.DB.prepare('SELECT * FROM capture_items').all();
 const items=rows.results.map(capParse),recent=items.filter(x=>String(x.updated_at||x.created_at||'')>=from);
 const open=items.filter(x=>x.kind==='task'&&!['done','cancelled'].includes(x.status));
 const done=recent.filter(x=>x.kind==='task'&&x.status==='done');
 const overdue=open.filter(x=>x.due_at&&x.schedule_confirmed&&Date.parse(x.due_at)<now);
 const inbox=items.filter(x=>x.status==='inbox');
 const ideas=items.filter(x=>x.kind==='idea'&&x.adoption_status==='pending');
 const gaps=[...new Map(done.filter(x=>!String(x.outcome||'').trim()).concat(items.filter(x=>x.reality==='actual'&&!String(x.outcome||'').trim())).map(x=>[x.id,x])).values()];
 const oldestInbox=inbox.length?Math.floor((now-Math.min(...inbox.map(x=>Date.parse(x.created_at))))/86400000):0;
 const counts={items:items.length,recent:recent.length,inbox:inbox.length,tasks_open:open.length,done_in_range:done.length,overdue:overdue.length,ideas_pending:ideas.length,evidence_gaps:gaps.length};
 const brief=done.slice(0,12).map(x=>'- '+x.title+'：'+(String(x.outcome||'').trim().slice(0,120)||'（未记录实际结果）')).join('\n')||'- 本期没有标记完成的任务；这不等同于没有推进。';
 const late=overdue.slice(0,12).map(x=>'- '+x.title+'（原定 '+new Date(x.due_at).toLocaleString('zh-CN',{timeZone:CAPTURE_TIMEZONE})+'）').join('\n')||'- 没有已确认截止且逾期的任务。';
 const markdown=['# 灵感一现 · 近 '+days+' 天复盘包','','生成时间：'+new Date(now).toISOString()+'（'+CAPTURE_TIMEZONE+'）','',
  '## 数据概览','',Object.entries(counts).map(([k,v])=>'- '+k+'：'+v).join('\n'),'',
  '## 本期实际完成与结果','',brief,'',
  '## 逾期（已确认截止）','',late,'',
  '## 收件箱待整理','',inbox.length?'- 共 '+inbox.length+' 条，最早一条等待 '+oldestInbox+' 天。':'无','',
  '## 需要本人判断的观念','',ideas.length?ideas.slice(0,10).map(x=>'- '+x.title).join('\n'):'无','',
  '## 证据缺口','',gaps.length?gaps.slice(0,10).map(x=>'- '+x.title+'：缺少实际结果').join('\n'):'无','',
  '## 下周可以问自己的三个问题','','1. 哪一条完成的任务，实际结果与预期不同？','2. 哪一条待整理记录反复出现，值得先处理？','3. 哪一条观念需要一条反例来检验？','',
  '> 本复盘包只汇总已有记录，不做人格判断、因果推断或自动计划。'].join('\n');
 return {range:{days,from,to:new Date(now).toISOString()},counts,highlight:{done:done.slice(0,12).map(x=>({id:x.id,title:x.title,outcome:x.outcome||'',acceptance_criteria:x.acceptance_criteria||''})),overdue:overdue.slice(0,12).map(x=>({id:x.id,title:x.title,due_at:x.due_at})),inbox:inbox.slice(0,12).map(x=>({id:x.id,title:x.title,created_at:x.created_at})),ideas:ideas.slice(0,12).map(x=>({id:x.id,title:x.title}))},oldest_inbox_days:oldestInbox,markdown};
}

async function captureToday(env){
 const today=await listCapture(env,new URL('https://local/api/capture/items?bucket=today&limit=20')),
  overdue=await listCapture(env,new URL('https://local/api/capture/items?bucket=overdue&limit=20')),
  unscheduled=await listCapture(env,new URL('https://local/api/capture/items?bucket=unscheduled&limit=20'));
 return {day:capDay().day,today:today.items,overdue:overdue.items,unscheduled:unscheduled.items,counts:{today:today.total,overdue:overdue.total,unscheduled:unscheduled.total},note:'只读取已确认或已计划的待办；未排期不等于今天要做。'};
}

export async function captureRoutes(req,env,helpers){
 const {json,userIdentity,serviceAuthorized}=helpers,url=new URL(req.url),path=url.pathname;
 if(!path.startsWith('/api/capture')&&!path.startsWith('/api/imports')&&path!=='/api/portable'&&path!=='/mcp')return null;
 try{
  const owner=userIdentity(req,env).owner,service=serviceAuthorized(req,env);
  if(path==='/mcp'){
   if(req.method!=='POST')return json({message:'仅支持 MCP POST。'},405);
   const rpc=await capJSON(req,10000);
   const tools=[
    {name:'capture_sync_status',description:'读取灵感一现私人随手记的最新导入回执与数据更新时间。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'capture_search',description:'检索随手记、待办和观念，返回来源性质；不会把AI分析当作本人已确认事实。多个词用空格分隔。',inputSchema:{type:'object',properties:{query:{type:'string'},updated_after:{type:'string'},offset:{type:'integer',minimum:0},kind:{type:'string'},domain:{type:'string'},status:{type:'string'},bucket:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false}},
    {name:'capture_read',description:'读取一条私人随手记及原消息、分析与历史版本。',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
    {name:'capture_today',description:'读取今天的计划、已逾期的已确认待办和待排期任务。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'capture_review_pack',description:'生成近 N 天复盘包：完成与结果、逾期、待整理、待判断观念与证据缺口，含 Markdown。',inputSchema:{type:'object',properties:{days:{type:'integer',minimum:1,maximum:90}},additionalProperties:false}}
   ];
   let result;
   if(rpc.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
   else if(rpc.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'linggan-capture',version:'4.1.0'}};
   else if(rpc.method==='tools/list')result={tools};
   else if(rpc.method?.startsWith('notifications/'))return new Response(null,{status:202});
   else if(rpc.method==='tools/call'){
    if(!owner&&!service)return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32001,message:'需要知识库所有者身份。'}},401);
    if(!env.DB)throw captureError('随手记数据库尚未配置。',503);
    const args=rpc.params?.arguments||{},name=rpc.params?.name;let value;
    if(name==='capture_sync_status')value=await capStatus(env);
    else if(name==='capture_read')value=await capItem(env,args.id);
    else if(name==='capture_today')value=await captureToday(env);
    else if(name==='capture_review_pack'){const u=new URL(url.origin+'/api/capture/review-pack');if(args.days)u.searchParams.set('days',String(args.days));value=await reviewPack(env,u);}
    else if(name==='capture_search'){
     const u=new URL(url.origin+'/api/capture/items');u.searchParams.set('q',String(args.query||''));
     if(args.updated_after)u.searchParams.set('updated_after',args.updated_after);
     for(const key of ['kind','domain','status','bucket'])if(args[key])u.searchParams.set(key,String(args[key]));
     u.searchParams.set('offset',String(args.offset||0));
     if(args.limit)u.searchParams.set('limit',String(args.limit));
     value=await listCapture(env,u);
    }else throw captureError('未知工具。',404);
    result={content:[{type:'text',text:JSON.stringify(value)}]};
   }else return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'未知方法。'}});
   return json({jsonrpc:'2.0',id:rpc.id??null,result});
  }
  if(!env.DB||!env.BUCKET)throw captureError('随手记数据库或附件存储尚未配置。',503);
  const upload=await capCredential(req,env);
  if(path==='/api/imports'&&req.method==='POST'){
   if(!owner&&!service&&!upload)return json({message:'需要所有者身份或专用上传凭证。'},401);
   if(owner&&!service&&!upload&&req.headers.get('Origin')!==url.origin)return json({message:'请求来源不一致。'},403);
   return json(await ingestCapture(env,await capJSON(req),upload?.id||null),201);
  }
  if(path.startsWith('/api/imports/')&&req.method==='GET'){
   if(!owner&&!service&&!upload)return json({message:'需要上传权限。'},401);
   const id=decodeURIComponent(path.slice('/api/imports/'.length));
   const r=await env.DB.prepare('SELECT receipt,credential_id FROM capture_batches WHERE id = ?').bind(id).first();
   if(upload&&r&&r.credential_id!==upload.id)return json({message:'只能读取本连接上传的批次回执。'},403);
   return r?json(capSafeParse(r.receipt,{})):json({message:'尚未收到此批次。'},404);
  }
  if(!owner&&!service)return json({message:'当前凭证不能读取或修改私人知识库。'},401);
  if(!['GET','HEAD'].includes(req.method)&&!service&&req.headers.get('Origin')!==url.origin)return json({message:'请求来源不一致。'},403);
  if(path==='/api/capture/status'&&req.method==='GET')return json(await capStatus(env));
  if(path==='/api/capture/review-pack'&&req.method==='GET')return json(await reviewPack(env,url));
  if(path==='/api/capture/items'&&req.method==='GET')return json(await listCapture(env,url));
  if(path.startsWith('/api/capture/items/')&&path.endsWith('/related')&&req.method==='GET'){
   const id=decodeURIComponent(path.slice('/api/capture/items/'.length,-'/related'.length));
   return json(await captureRelated(env,id));
  }
  if(path.startsWith('/api/capture/items/')&&path.endsWith('/promote')&&req.method==='POST'){
   const id=decodeURIComponent(path.slice('/api/capture/items/'.length,-'/promote'.length));
   const result=await promoteCapture(env,id,await capJSON(req,100000),req.headers.get('If-Match'),helpers);
   return json(result,result.status==='promoted'?201:200);
  }
  if(path.startsWith('/api/capture/items/')){
   const id=decodeURIComponent(path.slice('/api/capture/items/'.length));
   if(req.method==='GET')return json(await capItem(env,id));
   if(req.method==='PATCH')return json(await capUpdate(env,id,await capJSON(req,100000),req.headers.get('If-Match'),helpers.workspace));
  }
  if(path==='/api/capture/credentials'&&req.method==='POST'){
   const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM capture_credentials WHERE revoked_at IS NULL').first();
   if(count.n>=5)throw captureError('已有5个有效连接，请先撤销不用的凭证。');
   const token='wb4.'+capID()+capID(),id=capID();
   await env.DB.prepare('INSERT INTO capture_credentials (id,hash,label,created_at) VALUES (?,?,?,?)').bind(id,await sha256(token),'WorkBuddy 上传',new Date().toISOString()).run();
   return json({credential_id:id,site_url:url.origin,token,site_access_token:env.CAPTURE_GATEWAY_TOKEN||null,scope:['imports:append','imports:receipt'],schema_version:1},201);
  }
  if(path.startsWith('/api/capture/credentials/')&&req.method==='DELETE'){
   await env.DB.prepare('UPDATE capture_credentials SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),decodeURIComponent(path.split('/').at(-1))).run();
   return json({status:'revoked'});
  }
  if(path.startsWith('/api/capture/files/')&&req.method==='GET'){
   const batch=decodeURIComponent(path.split('/')[4]||''),file=url.searchParams.get('path');
   const row=await env.DB.prepare('SELECT raw_key FROM capture_batches WHERE id = ?').bind(batch).first();
   if(!row)throw captureError('找不到附件批次。',404);
   const obj=await env.BUCKET.get(row.raw_key),packet=await obj.json(),f=packet.files?.[file];
   if(!f||!file.startsWith('attachments/'))throw captureError('附件不存在。',404);
   const bytes=fileBytes(f);
   return new Response(bytes,{headers:{'Content-Type':/\.png$/i.test(file)?'image/png':/\.jpe?g$/i.test(file)?'image/jpeg':'application/octet-stream','Content-Disposition':'attachment; filename="'+file.split('/').at(-1)+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(path==='/api/portable'&&req.method==='GET')return await portableCapture(env,helpers,url);
  return json({message:'没有此随手记接口。'},404);
 }catch(error){if(error.status)return json({message:error.message},error.status);console.error('capture_request_failed',error.name);return json({message:'随手记操作失败；旧数据没有被覆盖。'},500);}
}

export function zipCapture(files){
 const encoder=new TextEncoder(),chunks=[],central=[];let offset=0;
 let crcTable=zipCapture.table;
 if(!crcTable){crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});zipCapture.table=crcTable;}
 const crc=b=>{let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
 for(const [name,content] of Object.entries(files)){
  const n=encoder.encode(name),b=typeof content==='string'?encoder.encode(content):content,c=crc(b),head=new Uint8Array(30+n.length),v=new DataView(head.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,c,true);v.setUint32(18,b.length,true);v.setUint32(22,b.length,true);v.setUint16(26,n.length,true);head.set(n,30);
  chunks.push(head,b);
  const cent=new Uint8Array(46+n.length),cv=new DataView(cent.buffer);
  cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);cv.setUint32(16,c,true);cv.setUint32(20,b.length,true);cv.setUint32(24,b.length,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true);cent.set(n,46);
  central.push(cent);offset+=head.length+b.length;
 }
 const size=central.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);
 ev.setUint32(0,0x06054b50,true);ev.setUint16(8,central.length,true);ev.setUint16(10,central.length,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);
 const result=new Uint8Array(offset+size+22);let pos=0;for(const c of [...chunks,...central,end]){result.set(c,pos);pos+=c.length;}return result;
}

async function portableCapture(env,helpers,url){
 const now=new Date().toISOString(),params=url?url.searchParams:new URLSearchParams();
 const scope=String(params.get('scope')||'all').toLowerCase();
 if(!['all','capture','workspace','learning'].includes(scope))throw captureError('导出范围不正确：可选 all、capture、workspace、learning。');
 const sinceRaw=params.get('since');let since=null;
 if(sinceRaw){const at=Date.parse(sinceRaw);if(!Number.isFinite(at))throw captureError('since 需要是 ISO 日期或时间。');since=new Date(at).toISOString();}
 const wantCapture=scope==='all'||scope==='capture',wantWorkspace=scope==='all'||scope==='workspace',wantLearning=scope==='all'||scope==='learning';
 const LIMIT=48000000,MAX_FILES=20000,files={};let size=0,fileCount=0;
 const add=(path,content)=>{const bytes=typeof content==='string'?new TextEncoder().encode(content):content;size+=bytes.length;fileCount+=1;if(size>LIMIT||fileCount>MAX_FILES)throw captureError('导出超过本版 48MB 上限；请使用 scope=capture|workspace|learning，或加 since=日期 分批导出。',413);files[path]=content;return bytes;};
 let tables={};
 if(wantCapture){
  const names=['capture_batches','capture_messages','capture_items','capture_versions'];
  const rows=await env.DB.batch(names.map(t=>env.DB.prepare('SELECT * FROM '+t)));
  tables=Object.fromEntries(names.map((t,i)=>[t,rows[i].results.map(row=>{const copy={...row};delete copy.credential_id;return copy;})]));
  if(since)for(const t of names)tables[t]=tables[t].filter(row=>String(row.updated_at||row.created_at||'')>=since);
  add('data/capture-tables.json',JSON.stringify(tables,null,2));
 }
 let legacy=null,learn=null;
 if(wantWorkspace){try{legacy=(await helpers.workspace.load()).state;}catch{legacy=null;}add('data/workspace.json',JSON.stringify(legacy,null,2));}
 if(wantLearning){
  const stored=await env.BUCKET.get(helpers.LEARNING_KEY);
  learn=stored?await stored.json():capSafeParse(new TextDecoder().decode(Uint8Array.from(atob(ASSETS['/learning/records.json'].body),c=>c.charCodeAt(0))),{});
  add('data/learning.json',JSON.stringify(learn,null,2));
 }
 const records=[...(wantWorkspace?legacy?.records||[]:[]),...(wantCapture?tables.capture_items.map(capParse):[])];
 const escape=helpers.escapeHTML;let page='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>灵感一现 · 离线阅读</title><style>body{max-width:960px;margin:40px auto;padding:20px;background:#f5f6ef;color:#344c3b;font:16px/1.8 system-ui}summary{cursor:pointer;font-weight:600}details{padding:18px;margin:12px 0;background:white;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#687967}</style><h1>灵感一现 · 离线阅读</h1><p>导出时间 '+escape(now)+'。范围：'+escape(scope)+(since?' · 自 '+escape(since):'')+'。本页面无需登录或联网；这是阅读快照，修改不自动同步云端。</p>';
 for(const [i,r] of records.entries()){const content=r.original||r.summary||r.next_action||'',md='# '+r.title+'\n\n'+content+'\n\n来源与字段：\n\n```json\n'+JSON.stringify(r,null,2)+'\n```\n';add('wiki/'+String(i+1).padStart(5,'0')+'.md',md);page+='<details><summary>'+escape(r.title)+'</summary><pre>'+escape(md)+'</pre></details>';}
 if(learn){page+='<h2>经验学习和沉淀</h2>';for(const article of learn.articles||[])page+='<details><summary>'+escape(article.title)+'</summary><pre>'+escape(JSON.stringify(article,null,2))+'</pre></details>';}
 if(legacy){page+='<h2>来源账本</h2>';for(const source of legacy.sources||[])page+='<details><summary>'+escape(source.title)+'</summary><pre>'+escape(source.content||'')+'</pre></details>';}
 if(wantCapture)for(const batch of tables.capture_batches){const obj=await env.BUCKET.get(batch.raw_key);if(!obj)throw captureError('备份中缺少已提交批次，请稍后重试。',503);const packet=await obj.json();add('raw/'+batch.id+'/manifest.json',JSON.stringify(packet.manifest,null,2));for(const [path,file] of Object.entries(packet.files))add('raw/'+batch.id+'/'+path,fileBytes(file));}
 add('index.html',page);
 add('restore_sqlite.py',"import json,pathlib,sqlite3\nroot=pathlib.Path(__file__).resolve().parent\ndb=sqlite3.connect(root/'knowledge.sqlite')\ndb.execute('CREATE TABLE IF NOT EXISTS archive(collection TEXT,id TEXT,body TEXT,PRIMARY KEY(collection,id))')\ndef load(name):\n p=root/name\n return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None\ntables=load('data/capture-tables.json') or {}\nlegacy=load('data/workspace.json') or {}\nlearning=load('data/learning.json') or {}\ncollections=list(tables.items())+[(k,v) for k,v in legacy.items() if isinstance(v,list)]+[('learning_articles',learning.get('articles',[])),('learning_methods',learning.get('methods',[]))]\nfor collection,rows in collections:\n for i,row in enumerate(rows):\n  db.execute('INSERT OR REPLACE INTO archive VALUES(?,?,?)',(collection,str(row.get('id',i)),json.dumps(row,ensure_ascii=False)))\nif legacy: db.execute('INSERT OR REPLACE INTO archive VALUES(?,?,?)',('workspace','complete',json.dumps(legacy,ensure_ascii=False)))\nif learning: db.execute('INSERT OR REPLACE INTO archive VALUES(?,?,?)',('learning','complete',json.dumps(learning,ensure_ascii=False)))\ndb.commit()\nprint(root/'knowledge.sqlite')\n");
 add('README.md','# 灵感一现可迁移阅读包\n\n范围：'+scope+(since?'（自 '+since+'）':'')+'。双击 index.html 离线阅读；wiki/ 是可用文本编辑器打开的 Markdown。data/ 只包含本次选择的分支；raw/ 保留已导入批次和全部已上传附件。\n\n运行 python restore_sqlite.py 可在本地生成 knowledge.sqlite；archive 表按 collection、id 保存完整 JSON。此包不含访问凭证，不能替代网站登录。文件副本编辑不自动回写线上。\n\n导出包含已成功上传的数据，不含仍在电脑等待上传的批次。各分支为导出时读取快照。可按 scope 分域或按 since 增量导出。\n');
 const manifest={schema_version:1,exported_at:now,scope,since,counts:{legacy:legacy?.records?.length||0,captures:tables.capture_items?.length||0,source_batches:tables.capture_batches?.length||0},files:[]};
 for(const [path,f] of Object.entries(files)){const bytes=typeof f==='string'?new TextEncoder().encode(f):f;manifest.files.push({path,bytes:bytes.length,sha256:await sha256(bytes)});}
 const manifestText=JSON.stringify(manifest,null,2);
 const bytes=zipCapture({...files,'manifest.json':manifestText});
 return new Response(bytes,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="linggan-portable-'+now.slice(0,10)+'-'+scope+'.zip"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Linggan-Export-Scope':scope,'X-Linggan-Export-Bytes':String(size)}});
}
