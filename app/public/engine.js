export const DOMAINS = [
  {id:'personal',name:'个人情感洞察',subtitle:'关系 · 动机 · 自主',color:'#66836c',icon:'◉'},
  {id:'business',name:'创业与商业',subtitle:'需求 · 模式 · 机会',color:'#b18b59',icon:'◇'},
  {id:'knowledge',name:'多元知识',subtitle:'概念 · 兴趣 · 方法',color:'#6a86a1',icon:'✳'},
  {id:'build',name:'项目与构建',subtitle:'产品 · Agent · 实践',color:'#9a7ca4',icon:'⌘'}
];
export const TYPE_NAMES={experience:'经历',knowledge:'知识',insight:'洞察',pattern:'候选模式',value:'价值取舍',question:'追问',transition:'认知变化',skill:'技能',decision:'决策',model:'个人模型',experiment:'行动实验'};
export function uid(prefix='item'){return prefix+'-'+crypto.randomUUID();}
export function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function safeURL(v){try{const u=new URL(v);return u.protocol==='https:'?u.href:null;}catch{return null;}}
export function clone(v){return JSON.parse(JSON.stringify(v));}
export function domainName(id){return DOMAINS.find(d=>d.id===id)?.name||'待归类';}
export function tokenize(text){const t=String(text||'').toLowerCase();const latin=t.match(/[a-z0-9]+/g)||[];const chinese=t.match(/[\u4e00-\u9fff]{2,}/g)||[];return [...new Set([...latin,...chinese.flatMap(s=>[s,...Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2))])])];}
export function retrieve(state,query,{domain='all',limit=8}={}){
 const terms=tokenize(query),records=state.records||[];
 return records.filter(r=>r.status!=='superseded'&&r.reality!=='simulation'&&(domain==='all'||r.domain===domain)).map(r=>{
 const title=String(r.title||'').toLowerCase(),body=[r.summary,...r.tags||[],r.question||''].join(' ').toLowerCase();
 let score=terms.length?terms.reduce((n,t)=>n+(title.includes(t)?4:body.includes(t)?1:0),0):1;
 if(query&&title.includes(query.toLowerCase()))score+=15;
 return {record:r,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}
export function deriveMetrics(state){return {records:state.records.length,skills:state.skills.length,actions:state.actions.filter(a=>a.status==='active').length,feedback:state.feedback.length,pending:state.records.filter(r=>r.review==='pending').length,topics:state.records.filter(r=>r.origin==='history-index').length};}
export function addRecord(state,{title,text,domain='personal',type='experience',date,reality='unknown'},now=new Date().toISOString()){
 if(typeof text!=='string'||text.trim().length<8)throw Error('请至少记录一句具体经历（8个字以上）。');
 if(text.length>20000)throw Error('单条记录请控制在 20,000 字以内。');
 if(!DOMAINS.some(d=>d.id===domain))throw Error('请选择有效领域。');
 if(!['actual','simulation','unknown'].includes(reality))throw Error('请选择记录性质。');
 const content=text.trim(),normalized=content.replace(/\s/g,'');
 if(state.records.some(r=>r.original?.replace(/\s/g,'')===normalized))throw Error('这段内容已经记录过了，先打开原记录补充反馈。');
 const id=uid('memory'),matches=retrieve(state,content,{limit:3});
 const r={id,title:(title||content.slice(0,22)).trim().slice(0,120),summary:content.slice(0,280),original:content,type,domain,tags:[],date:date||now.slice(0,10),createdAt:now,origin:'user-entry',reality,provenance:'user_report',confidence:'medium',review:'pending',status:'active',related:matches.map(x=>x.record.id),sourceRefs:[{kind:'user_entry',label:'你在工作台中的记录',date:now}],questions:['这次实际发生了什么？','你采取了什么行动，结果是什么？'],note:'保存的是你的自述。尚未经过核验，也未自动归因为稳定人格。'};
 state.records.unshift(r);state.events.unshift({id:uid('event'),date:now,type:'capture',title:'记录了「'+r.title+'」',recordId:id});return r;
}
export function runReview(state,{recordId,query='',domain='all'}={},now=new Date().toISOString()){
 const chosen=state.records.find(r=>r.id===recordId&&r.status!=='superseded')||(!recordId?retrieve(state,query,{domain,limit:1})[0]?.record:null);
 if(!chosen)throw Error('先选择一条经历，或记录一个正在思考的问题。');
 if(chosen.reality==='simulation')throw Error('模拟材料请在生活推演中比较，不作为真实经历复盘。');
 const explicitRelated=(chosen.related||[]).map(id=>state.records.find(r=>r.id===id&&r.status!=='superseded'&&r.reality!=='simulation')).filter(Boolean);
 const retrieved=retrieve(state,chosen.title+' '+chosen.summary,{limit:8}).map(x=>x.record).filter(r=>r.id!==chosen.id);
 const related=[...new Map([...explicitRelated,...retrieved].map(r=>[r.id,r])).values()].slice(0,3);
 const skill=state.skills.find(s=>(s.domains||[]).includes(chosen.domain))||state.skills[0];
 const draft={id:uid('review'),createdAt:now,recordId:chosen.id,title:chosen.title,mode:'evidence_compiler',status:'draft',sourceIds:[chosen.id,...related.map(x=>x.id)],relatedIds:related.map(x=>x.id),skillId:skill?.id||null,
 methodRun:!chosen.suggestedAction&&skill?.suggestion?{id:skill.id,version:skill.version,name:skill.name,suggestion:skill.suggestion,criterion:skill.evolution?.criterion||null}:null,
 observation:chosen.insight||chosen.summary,
 continuity:chosen.change||'本次材料可以补充这个主题的理解；目前不足以证明长期行为已经改变。',
 gap:chosen.questions?.[0]||'还缺一条你实际采取行动及其结果的记录。',
 nextAction:chosen.suggestedAction||skill?.suggestion||'选一个具体场景，记录当时的选择、行动与实际反馈。',
 boundary:chosen.origin==='user-entry'?'这是对你本次自述与已有资料的关联整理，解释仍待你确认。':'依据为现有资料的提炼与关联；没有新增原文或行为证据时，不升级结论。'};
 state.reviews.unshift(draft);state.events.unshift({id:uid('event'),date:now,type:'review',title:'整理了「'+chosen.title+'」的复盘',recordId:chosen.id});return draft;
}
export function activateAction(state,reviewId,now=new Date().toISOString()){
 const review=state.reviews.find(r=>r.id===reviewId);if(!review)throw Error('找不到这份复盘。');
 const existing=state.actions.find(a=>a.reviewId===reviewId);if(existing)return existing;
 const record=state.records.find(r=>r.id===review.recordId);
 const a={id:uid('action'),reviewId,recordId:review.recordId,title:review.nextAction,domain:record?.domain||'personal',status:'active',createdAt:now,criterion:review.methodRun?.criterion||'记录一次具体行动、结果和与预期不同的地方。'};
 if(review.methodRun)a.methodRun=clone(review.methodRun);
 state.actions.unshift(a);review.status='accepted';state.events.unshift({id:uid('event'),date:now,type:'action',title:'采纳了一个小行动',recordId:review.recordId});return a;
}
export function recordFeedback(state,{actionId,action,outcome,learning,methodVerdict},now=new Date().toISOString()){
 const a=state.actions.find(x=>x.id===actionId);if(!a)throw Error('找不到这个行动。');
 if(a.status==='completed')throw Error('这项行动已有反馈，可新增一条后续经历。');
 if(!action?.trim()||!outcome?.trim())throw Error('请写下实际做了什么，以及实际结果。');
 if(methodVerdict&&(!a.methodRun||!Object.hasOwn(METHOD_VERDICTS,methodVerdict)))throw Error('请按这次实际使用的方法记录判断。');
 const f={id:uid('feedback'),actionId,recordId:a.recordId,action:action.trim().slice(0,5000),outcome:outcome.trim().slice(0,5000),learning:(learning||'').trim().slice(0,5000),date:now};if(methodVerdict)f.methodVerdict=methodVerdict;
 state.feedback.unshift(f);a.status='completed';a.completedAt=now;
 const source=state.records.find(r=>r.id===a.recordId);if(a.scenarioId)f.scenarioId=a.scenarioId;
 const r={id:uid('memory'),title:'实践反馈：'+(source?.title||a.title||'一次尝试'),summary:outcome.trim().slice(0,280),original:'实际行动：'+f.action+'\n实际结果：'+f.outcome+'\n暂时的理解：'+f.learning,type:'experience',domain:a.domain,date:now.slice(0,10),createdAt:now,origin:'user-feedback',reality:'actual',provenance:'user_report',confidence:'medium',review:'pending',status:'active',related:[a.recordId].filter(Boolean),sourceRefs:[{kind:'user_feedback',label:'你提交的行动反馈',date:now}],questions:['还有哪些因素可能影响了这次结果？'],note:'一次行动结果可补充经验，尚不足以确认普遍因果关系。'};f.memoryId=r.id;state.records.unshift(r);
 state.events.unshift({id:uid('event'),date:now,type:'feedback',title:'把一次行动结果带回经验库',recordId:r.id});return f;
}
export function reviewRecord(state,id,decision,correction,now=new Date().toISOString()){
 const r=state.records.find(x=>x.id===id);if(!r)throw Error('找不到这条记录。');
 if(!['confirmed','rejected','corrected'].includes(decision))throw Error('无效的审阅状态。');
 if(decision==='corrected'&&!correction?.trim())throw Error('请补充更准确的表达。');
 r.review=decision;r.reviewedAt=now;if(decision==='rejected')r.status='superseded';
 if(decision==='corrected'){r.versions=r.versions||[];r.versions.push({summary:r.summary,date:now,reason:'本人纠正'});r.summary=correction.trim().slice(0,5000);if(r.insight)r.insight=r.summary;delete r.suggestedAction;r.status='active';}
 state.events.unshift({id:uid('event'),date:now,type:'correction',title:decision==='corrected'?'纠正了一条理解':decision==='rejected'?'停用了一条解释':'确认了一条记录',recordId:id});return r;
}
export const METHOD_VERDICTS={met:'达到预期',mixed:'部分达到',missed:'未达到',unused:'没有使用这条建议'};
export function methodFeedback(state){
 const actions=new Map(state.actions.map(a=>[a.id,a])),skills=new Map(state.skills.map(s=>[s.id,s]));
 const records=new Map(state.records.map(r=>[r.id,r]));
 return state.feedback.flatMap(f=>{
  const a=actions.get(f.actionId),run=a?.methodRun;
  if(!run||!Object.hasOwn(METHOD_VERDICTS,f.methodVerdict))return [];
  const skill=skills.get(run.id),record=records.get(f.memoryId);
  const applicable=Boolean(record&&record.status!=='superseded'&&record.reality==='actual');
  return [{feedback:f,run,skill,canRevise:applicable&&skill?.version===run.version&&['mixed','missed'].includes(f.methodVerdict)}];
 });
}
export function methodComparisons(state,entries=methodFeedback(state)){
 const byVersion=new Map();
 for(const {run,feedback} of entries){
  if(feedback.methodVerdict==='unused')continue;
  const key=JSON.stringify([run.id,run.version]),counts=byVersion.get(key)||{met:0,mixed:0,missed:0};
  counts[feedback.methodVerdict]++;byVersion.set(key,counts);
 }
 const counts=(id,version)=>byVersion.get(JSON.stringify([id,version]))||{met:0,mixed:0,missed:0};
 return state.skills.filter(s=>s.evolution).map(skill=>({skill,baseline:counts(skill.id,skill.evolution.fromVersion),current:counts(skill.id,skill.version)}));
}
export function saveSkill(state,input,now=new Date().toISOString()){
 if(!input.name?.trim()||!input.trigger?.trim()||!input.steps?.length)throw Error('方法需要名称、适用场景和至少一个步骤。');
 const sourceIds=(input.sourceIds||[]).filter(id=>state.records.some(r=>r.id===id&&r.status!=='superseded'));
 if(!sourceIds.length)throw Error('请关联至少一条经历或知识记录作为方法来源。');
 let skill=state.skills.find(s=>s.id===input.id);
 let evolution=null;
 if(input.evidenceFeedbackId){
  const item=methodFeedback(state).find(row=>row.feedback.id===input.evidenceFeedbackId);
  if(!item?.canRevise||item.skill.id!==input.id||input.expectedVersion!==skill?.version)throw Error('方法版本已变化，或反馈不可用于修订。请回到复盘页重新核对。');
  const rationale=input.rationale?.trim(),criterion=input.criterion?.trim(),suggestion=input.suggestion?.trim();
  if(!rationale||!criterion||!suggestion||suggestion===skill.suggestion?.trim())throw Error('请写清改动理由、下一次检查标准，并修改下一次建议。');
  evolution={feedbackId:item.feedback.id,fromVersion:skill.version,rationale:rationale.slice(0,1000),criterion:criterion.slice(0,1000)};
  if(!sourceIds.includes(item.feedback.memoryId))sourceIds.push(item.feedback.memoryId);
 }
 const fields={name:input.name.trim().slice(0,100),subtitle:(input.subtitle||'从经历中沉淀的方法').slice(0,150),trigger:input.trigger.trim().slice(0,1000),domains:input.domains.filter(id=>DOMAINS.some(d=>d.id===id)),inputs:(input.inputs||[]).slice(0,12),steps:input.steps.map(x=>x.trim()).filter(Boolean).slice(0,20),checks:(input.checks||[]).slice(0,12),suggestion:(input.suggestion||input.steps[0]).slice(0,1000),sourceIds,level:'本人沉淀 · 待独立验证',updatedAt:now};
 if(!fields.domains.length)throw Error('请选择方法的适用领域。');
 if(skill){const old={version:skill.version,name:skill.name,trigger:skill.trigger,steps:clone(skill.steps),checks:clone(skill.checks),sourceIds:clone(skill.sourceIds),date:now,suggestion:skill.suggestion,...(skill.evolution?{evolution:clone(skill.evolution)}:{})};skill.versions=skill.versions||[];skill.versions.push(old);Object.assign(skill,fields,{version:skill.version+1});if(evolution)skill.evolution=evolution;else delete skill.evolution;}
 else{skill={id:uid('skill'),version:1,...fields};state.skills.unshift(skill);}
 state.events.unshift({id:uid('event'),date:now,type:'correction',title:'沉淀方法「'+skill.name+'」v'+skill.version,recordId:sourceIds[0]});return skill;
}
export function updateProfile(state,id,{title,detail},now=new Date().toISOString()){
 const p=state.profiles.find(x=>x.id===id);if(!p)throw Error('找不到这条阶段描述。');
 if(!title?.trim()||!detail?.trim())throw Error('请填写简短描述与适用说明。');
 p.versions=p.versions||[];p.versions.push({title:p.title,detail:p.detail,status:p.status,date:now});p.title=title.trim().slice(0,120);p.detail=detail.trim().slice(0,2000);p.status='本人于'+now.slice(0,10)+'更新';p.updatedAt=now;
 state.events.unshift({id:uid('event'),date:now,type:'correction',title:'本人更新了阶段描述「'+p.title+'」'});return p;
}
export function validateState(s){
 if(!s||s.schemaVersion!==2)throw Error('不支持的数据版本。');
 for(const key of ['records','skills','actions','feedback','reviews','events','profiles','sources'])if(!Array.isArray(s[key]))throw Error('缺少数据集合：'+key);
 if(s.records.length>3000||s.sources.length>500||s.feedback.length>3000)throw Error('本版数据量超过上限。');
 if(s.lab)validateLab(s.lab);
 const ids=new Set();for(const r of s.records){if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.title!=='string'||typeof r.summary!=='string'||!DOMAINS.some(d=>d.id===r.domain))throw Error('记录字段或编号不正确。');ids.add(r.id);}
 return s;
}
export function makeEmptyWorkspace(){return {
 schemaVersion:2,revision:0,updatedAt:'2026-11-14',mode:'personal',
 coverage:{label:'个人空间已就绪',topics:0,originalTranscripts:0,note:'真实历史资料仍保留在飞书，尚待你确认是否导入网页个人空间。你可以先在这里记录新的经历。'},
 profiles:[{id:'profile-current',title:'从一条真实经历开始',detail:'写下当下的目标、偏好与约束，再通过实践慢慢更新。',kind:'待填写',status:'个人历史尚未导入'}],
 records:[],sources:[],skills:[],actions:[],feedback:[],reviews:[],events:[],documents:[]
};}
export function makeDemo(){return {
 schemaVersion:2,revision:1,updatedAt:'2026-11-14',mode:'demo',coverage:{label:'公开交互样例',topics:0,originalTranscripts:0,note:'以下为虚构示例，用来体验整理、关联与反馈流程。真实资料仅在个人空间显示。'},
 profiles:[{id:'p-demo',title:'为下一次实践积累经验',detail:'将学习、项目与行动反馈连接起来。',kind:'演示目标',status:'示例'}],
 sources:[{id:'sample-notes',title:'示例记录',kind:'fictional_example',content:'本演示中的经历和结果均为虚构样例。'}],
 records:[
 {id:'demo-1',title:'一次项目评审后的新发现',summary:'评审前写了很多功能，讨论后发现最需要讲清楚的是用户在哪个时刻遇到困难。',original:'示例：我在评审中逐项介绍功能，大家仍在追问用户的问题。下一次先从具体任务和替代方案讲起。',domain:'build',type:'experience',date:'2026-11-12',origin:'demo',review:'pending',status:'active',provenance:'fictional_example',tags:['需求判断','表达'],related:['demo-2','demo-4'],sourceRefs:[{label:'虚构演示材料',kind:'fictional_example'}],insight:'把功能清单重新连接到用户的任务和困难。',questions:['换一个项目，我能否先讲清楚真实问题？'],suggestedAction:'选一个正在思考的方案，用“用户—场景—困难—现有替代”四句话重新描述。'},
 {id:'demo-2',title:'先理解需要，再讨论方案',summary:'同一句“帮我看看”，可能是在寻求建议，也可能是在寻求理解；先确认需要。',domain:'personal',type:'insight',date:'2026-11-10',origin:'demo',review:'pending',status:'active',provenance:'fictional_example',tags:['理解','沟通'],related:['demo-1'],sourceRefs:[{label:'虚构演示材料',kind:'fictional_example'}],questions:['我有没有先确认对方需要怎样的帮助？']},
 {id:'demo-3',title:'看懂概念以后，尝试独立使用',summary:'阅读时觉得理解了一个方法，换到新案例才发现仍有不确定的步骤。',domain:'knowledge',type:'knowledge',date:'2026-11-08',origin:'demo',review:'pending',status:'active',provenance:'fictional_example',tags:['学习','迁移'],related:['demo-1'],sourceRefs:[{label:'虚构演示材料',kind:'fictional_example'}],questions:['合上笔记，我能解释这个方法的适用条件吗？']},
 {id:'demo-4',title:'从一个想法开始验证需求',summary:'先找到一个真实任务，了解当前如何解决，再决定是否值得做一个Demo。',domain:'business',type:'decision',date:'2026-11-06',origin:'demo',review:'pending',status:'active',provenance:'fictional_example',tags:['需求','验证'],related:['demo-1'],sourceRefs:[{label:'虚构演示材料',kind:'fictional_example'}],questions:['谁遇到这个问题？目前为它付出了什么？']}
 ],
 skills:[{id:'skill-demo',name:'把模糊问题讲清楚',subtitle:'从场景到可验证的下一步',domains:['build','business'],level:'方法草案',version:1,sourceIds:['demo-1','demo-4'],trigger:'想法太多，不知道先验证哪一个。',inputs:['具体人群','发生场景','当前替代方案'],steps:['描述一次具体任务','区分现象与推测','找出最需要验证的假设','选择一个低成本行动'],checks:['是否有实际场景？','是否区分证据和假设？'],suggestion:'选一个具体任务，记录现有做法、困难，以及你准备验证的一个假设。'},{id:'skill-reflect',name:'让一次经历留下经验',subtitle:'事实 → 解释 → 行动 → 反馈',domains:['personal','knowledge'],level:'方法草案',version:1,sourceIds:['demo-2','demo-3'],trigger:'经历了一个值得回看的时刻。',inputs:['发生了什么','当时怎么理解'],steps:['保留当时记录','列出一种替代解释','选择一个小行动','回看实际结果'],checks:['有没有把推测当成事实？','下一步是否足够具体？'],suggestion:'记录一个具体场景，分开写下事实、解释和你希望尝试的回应。'}],
 actions:[],feedback:[],reviews:[],events:[{id:'demo-event',date:'2026-11-14',type:'system',title:'数字分身 V2 交互样例已就绪'}]
};}

// V3 is an additive extension: the original workspace and its revision history stay intact.
export const LENSES=[{id:'values',name:'目标与价值'},{id:'thinking',name:'认知与决策'},{id:'energy',name:'精力与情绪'},{id:'ability',name:'能力与机会'}];
export const LAB_DEFAULTS={targetObservations:5,minCases:2,reviewDays:7};
export function ensureLab(state){
 if(!state.lab)state.lab={schemaVersion:1,models:[],observations:[],scenarios:[],states:[],experiments:[],config:{...LAB_DEFAULTS},configHistory:[]};
 validateLab(state.lab);return state.lab;
}
function textField(x,label,max=3000){if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('请填写有效的'+label+'。');return x.trim();}
function bounded(v,min,max,label){if(v===null||v===''||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)throw Error(label+'超出范围。');return Number(v);}
export function validateLab(lab){
 if(lab.schemaVersion!==1)throw Error('个人模型数据版本不正确。');
 for(const k of ['models','observations','scenarios','states','experiments','configHistory'])if(!Array.isArray(lab[k])||lab[k].length>3000)throw Error('个人模型数据集合不正确：'+k);
 const ids=new Set();for(const key of ['models','observations','scenarios','states','experiments'])for(const row of lab[key]){if(!row||typeof row.id!=='string'||ids.has(row.id))throw Error('模型记录编号不正确。');ids.add(row.id);}
 const c=lab.config;if(!c)throw Error('缺少模型规则。');bounded(c.minCases,2,20,'独立案例数');bounded(c.targetObservations,2,30,'观察目标');bounded(c.reviewDays,1,90,'回看间隔');
 for(const m of lab.models){textField(m.title,'模型名称',120);textField(m.hypothesis,'候选假设');if(!DOMAINS.some(d=>d.id===m.domain)||!Array.isArray(m.supportIds)||!Array.isArray(m.counterIds)||!['candidate','paused'].includes(m.status))throw Error('模型字段不正确。');}
 for(const o of lab.observations){if(!['actual','simulation','unknown'].includes(o.reality)||!lab.models.some(m=>m.id===o.modelId)||!['support','counter','unclear'].includes(o.stance))throw Error('观察记录性质不正确。');textField(o.context,'场景');textField(o.outcome,'结果');if(o.irritation!=null)bounded(o.irritation,0,10,'烦躁');if(o.repeats!=null)bounded(o.repeats,0,50,'重复次数');}
 for(const x of lab.scenarios)if(x.reality!=='simulation'||!Array.isArray(x.options)||!x.options.length||x.options.some(o=>!['draft','accepted'].includes(o.status)))throw Error('情景推演字段不正确。');
 return lab;
}
export function saveModel(state,input,now=new Date().toISOString()){
 const lab=ensureLab(state),domain=input.domain;if(!DOMAINS.some(d=>d.id===domain))throw Error('请选择模型领域。');
 const valid=ids=>[...new Set(ids||[])].filter(id=>state.records.some(r=>r.id===id&&r.status!=='superseded'&&r.reality!=='simulation'));
 const fields={title:textField(input.title,'模型名称',120),hypothesis:textField(input.hypothesis,'候选假设'),mechanism:textField(input.mechanism,'候选机制'),boundary:textField(input.boundary,'适用边界'),alternatives:textField(input.alternatives,'替代解释'),domain,lenses:(input.lenses||[]).filter(x=>LENSES.some(l=>l.id===x)),supportIds:valid(input.supportIds),counterIds:valid(input.counterIds),updatedAt:now};
 if(fields.supportIds.some(id=>fields.counterIds.includes(id)))throw Error('同一条案例请明确支持或反驳，不能重复计入。');
 let m=lab.models.find(x=>x.id===input.id);if(m){m.versions=m.versions||[];m.versions.push({...clone(m),versions:undefined});Object.assign(m,fields,{version:m.version+1});}else{m={id:uid('model'),version:1,status:'candidate',...fields,createdAt:now};lab.models.unshift(m);}
 state.events.unshift({id:uid('event'),date:now,type:'model',title:'更新候选模型「'+m.title+'」v'+m.version});return m;
}
export function recordObservation(state,input,now=new Date().toISOString()){
 const lab=ensureLab(state),m=lab.models.find(x=>x.id===input.modelId);if(!m||m.status==='paused')throw Error('请先选择使用中的候选模型。');
 if(!['actual','simulation','unknown'].includes(input.reality))throw Error('请明确这是真实发生、模拟还是未确认。');
 if(!['support','counter','unclear'].includes(input.stance))throw Error('请选择支持、反驳或暂不判断。');
 const o={id:uid('observation'),modelId:m.id,reality:input.reality,stance:input.stance,context:textField(input.context,'具体场景'),action:textField(input.action,'行动'),outcome:textField(input.outcome,'结果'),alternative:(input.alternative||'').slice(0,3000),irritation:input.irritation===''||input.irritation==null?null:bounded(input.irritation,0,10,'烦躁'),repeats:input.repeats===''||input.repeats==null?null:bounded(input.repeats,0,50,'重复次数'),understanding:(input.understanding||'未记录').slice(0,200),caseKey:textField(input.caseKey||((input.date||now.slice(0,10))+':'+input.context.trim()),'场景编号',3000),date:input.date||now.slice(0,10),createdAt:now};
 // Repeat entry of the same case never creates independent evidence.
 if(lab.observations.some(x=>x.modelId===m.id&&x.caseKey===o.caseKey&&x.reality===o.reality))throw Error('这个场景已记录；同一场景不能重复计入独立观察。');
 lab.observations.unshift(o);
 if(o.reality==='actual'){const r=addRecord(state,{title:'实验观察：'+m.title,text:'场景：'+o.context+'\n行动：'+o.action+'\n结果：'+o.outcome+'\n替代解释：'+o.alternative,domain:m.domain,type:'experience',reality:'actual',date:o.date},now);r.origin='experiment-observation';r.observationId=o.id;o.recordId=r.id;}
 state.events.unshift({id:uid('event'),date:now,type:'observation',title:(o.reality==='actual'?'真实自述观察':o.reality==='simulation'?'模拟观察':'未确认观察')+'已保存',recordId:o.recordId});return o;
}
export function modelEvidence(state,id,now=new Date()){
 const lab=ensureLab(state),m=lab.models.find(x=>x.id===id);if(!m)return null;
 const caseIdentity=r=>r.observationId||r.caseKey||r.sourceRefs?.find(s=>s.id)?.id||r.id;
 const eligible=ids=>[...new Map(ids.map(id=>state.records.find(r=>r.id===id&&r.status!=='superseded'&&r.reality==='actual'&&r.provenance!=='inferred')).filter(Boolean).map(r=>[caseIdentity(r),r])).values()];
 const observations=lab.observations.filter(o=>o.modelId===id),actual=[...new Map(observations.filter(o=>o.reality==='actual'&&state.records.some(r=>r.id===o.recordId&&r.status!=='superseded')).map(o=>[o.caseKey,o])).values()];
 const supported=eligible(m.supportIds),counter=eligible(m.counterIds),uniqueCases=new Set([...supported.map(caseIdentity),...counter.map(caseIdentity),...actual.map(o=>o.id)]);
 const due=Date.parse(m.updatedAt)+lab.config.reviewDays*86400000<=+now;
 return {actual:actual.length,simulation:observations.filter(o=>o.reality==='simulation').length,unknown:observations.filter(o=>o.reality==='unknown').length,support:actual.filter(o=>o.stance==='support').length+supported.filter(r=>!actual.some(o=>o.id===r.observationId)).length,counter:actual.filter(o=>o.stance==='counter').length+counter.filter(r=>!actual.some(o=>o.id===r.observationId)).length,cases:uniqueCases.size,related:m.supportIds.length+m.counterIds.length,readyForReview:uniqueCases.size>=lab.config.minCases&&actual.length>=lab.config.targetObservations,due,label:m.status==='paused'?'已停用':uniqueCases.size>=lab.config.minCases&&actual.length>=lab.config.targetObservations?'待人工复核':'证据不足 · 候选模型'};
}
export function setModelStatus(state,id,status,now=new Date().toISOString()){
 const m=ensureLab(state).models.find(x=>x.id===id);if(!m||!['candidate','paused'].includes(status))throw Error('模型状态无效。');m.status=status;m.updatedAt=now;
 state.events.unshift({id:uid('event'),date:now,type:'correction',title:(status==='paused'?'停用':'恢复候选')+'模型「'+m.title+'」'});
}
export function saveCurrentState(state,input,now=new Date().toISOString()){
 const lab=ensureLab(state);const row={id:uid('state'),reality:'user_report',createdAt:now,lenses:Object.fromEntries(LENSES.map(l=>[l.id,textField(input[l.id],l.name)])),time:textField(input.time,'时间与生活约束'),sourceIds:(input.sourceIds||[]).filter(id=>state.records.some(r=>r.id===id&&r.status!=='superseded'))};lab.states.unshift(row);return row;
}
export function createScenario(state,input,now=new Date().toISOString()){
 const lab=ensureLab(state);if(!lab.states.length)throw Error('先记录当前状态与约束，再做推演。');
 const options=(input.options||[]).map(o=>({id:uid('option'),action:textField(o.action,'候选行动'),prediction:textField(o.prediction,'预期变化'),cost:textField(o.cost,'成本与风险'),metric:textField(o.metric,'验证标准'),status:'draft'}));if(options.length<2||options.length>3)throw Error('请比较 2 至 3 个候选方案。');
 const row={id:uid('scenario'),title:textField(input.title,'当前问题',120),domain:input.domain,reality:'simulation',stateId:lab.states[0].id,modelIds:(input.modelIds||[]).filter(id=>lab.models.some(m=>m.id===id&&m.status==='candidate')),modelVersions:Object.fromEntries((input.modelIds||[]).map(id=>{const m=lab.models.find(m=>m.id===id);return [id,m?.version||0];})),options,createdAt:now};if(!DOMAINS.some(d=>d.id===row.domain))throw Error('请选择推演领域。');lab.scenarios.unshift(row);return row;
}
export function acceptScenarioOption(state,scenarioId,optionId,now=new Date().toISOString()){
 const lab=ensureLab(state),s=lab.scenarios.find(x=>x.id===scenarioId),o=s?.options.find(x=>x.id===optionId);if(!o)throw Error('候选方案不存在。');if(o.actionId)return state.actions.find(a=>a.id===o.actionId);
 if(s.modelIds.some(id=>!lab.models.some(m=>m.id===id&&m.status==='candidate')))throw Error('引用的模型已停用，请重新推演。');
 if(s.modelIds.some(id=>s.modelVersions?.[id]&&s.modelVersions[id]!==lab.models.find(m=>m.id===id)?.version))throw Error('引用的模型已修订，请基于新版本重新比较方案。');
 const a={id:uid('action'),recordId:null,scenarioId:s.id,optionId:o.id,title:o.action,domain:s.domain,status:'active',criterion:o.metric,createdAt:now,prediction:o.prediction};o.status='accepted';o.actionId=a.id;state.actions.unshift(a);state.events.unshift({id:uid('event'),date:now,type:'action',title:'采纳推演方案「'+s.title+'」'});return a;
}
export function scenarioFeedback(state,s){return s.options.filter(o=>o.actionId).map(o=>({option:o,feedback:state.feedback.find(f=>f.actionId===o.actionId)}));}
export function updateLabConfig(state,input,now=new Date().toISOString()){
 const lab=ensureLab(state),next={minCases:bounded(input.minCases,2,20,'独立案例数'),targetObservations:bounded(input.targetObservations,2,30,'观察目标'),reviewDays:bounded(input.reviewDays,1,90,'回看间隔')};lab.configHistory.unshift({date:now,previous:clone(lab.config),next:clone(next)});lab.config=next;return next;
}
export function memoryAudit(state){
 const l=ensureLab(state);return {pending:state.records.filter(r=>r.review==='pending'&&r.status!=='superseded'),unknown:state.records.filter(r=>r.reality!=='actual'&&r.reality!=='simulation'&&r.status!=='superseded'),simulations:state.records.filter(r=>r.reality==='simulation'),paused:l.models.filter(m=>m.status==='paused'),reviewModels:l.models.filter(m=>m.status==='candidate'&&modelEvidence(state,m.id).due)};
}
export function makeDemoLab(state){
 const l=ensureLab(state);if(l.demoInitialized)return;l.demoInitialized=true;if(l.models.length)return;
 const m=saveModel(state,{title:'先确认问题，再讨论方案',domain:'build',hypothesis:'在部分评审中，先确认用户任务可能减少无效功能讨论。',mechanism:'先建立共同问题表述，可能让后续讨论更集中；目前只是虚构演示。',alternatives:'议题难度、参会者经验、时间限制也可能影响评审。',boundary:'仅用于体验流程。不能据此推断真实用户或你的稳定行为。',lenses:['thinking','ability'],supportIds:['demo-1','demo-4'],counterIds:[]});
 l.experiments.push({id:'demo-experiment',code:'DEMO-01',modelId:m.id,title:'虚构评审练习',protocol:'下一次先复述用户场景，再记录实际讨论是否更集中。本示例不计真实实践。'});
 saveCurrentState(state,{values:'虚构样例：希望把模糊想法变成可验证的小项目。',thinking:'虚构样例：讨论功能前，先判断哪个问题最需要验证。',energy:'虚构样例：精力有限，给验证留出恢复与回看时间。',ability:'虚构样例：已有一份评审草稿，需要补充真实场景。',time:'虚构样例：本周安排一次 20 分钟小练习。',sourceIds:['demo-1']});
 createScenario(state,{title:'怎样让下一次评审更聚焦？（虚构样例）',domain:'build',modelIds:[m.id],options:[{action:'评审前用四句话写清用户任务和困难',prediction:'可能减少对问题定义的反复确认，尚无实际结果。',cost:'准备约 15 分钟；如果问题材料不足，仍可能讨论不清楚。',metric:'评审后记录：哪些问题被澄清？是否出现反例？'},{action:'先找一位同事复述对方案的理解',prediction:'可能提前发现表达遗漏；不代表方案本身正确。',cost:'约 20 分钟；单人意见可能不代表用户。',metric:'记录对方复述与原意的差异，再比较正式讨论。'}]});
}
