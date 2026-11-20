const categories=[
 {id:'insights',name:'具体洞察',desc:'一次具体的“啊哈”发现。先留下当时的理解，不急着概括成长期模式。',fields:['洞察内容','用户原句','原始来源','为什么重要','延伸关联','待确认事项'],question:'这段对话，让我新意识到了什么？'},
 {id:'patterns',name:'反复出现的模式',desc:'跨对话重复出现的思维、情绪、行为或关系倾向。至少需要两条证据。',fields:['典型情境','自动化想法','情绪与行为','至少两条证据','代价与收益','应对与变化'],question:'这个倾向是否在不同的具体情境里出现过？'},
 {id:'values',name:'价值观与动机',desc:'记下真正重视的东西，以及它在不同阶段的含义与优先级。',fields:['对我的含义','当前优先级','具体选择证据','支撑与冲突','权重演变','相关转变'],question:'在这个选择里，我真正想保护或追求什么？'},
 {id:'questions',name:'持续追问',desc:'为尚未解决的问题保留探索进度，把阶段性答案与未解之处分开。',fields:['问题原话','为什么会问','历次探索','阶段性回答','仍然卡住之处','下一步'],question:'我还缺什么证据或经历，才能继续理解这个问题？'},
 {id:'transitions',name:'认知转变',desc:'明确记录转变前、触发来源和转变后，保留每一次理解变化的脉络。',fields:['Before及依据','触发点','After及依据','内在机制','是否出现反复','时间线登记'],question:'我以前怎么理解，现在怎么理解？变化从哪里发生？'},
 {id:'experiments',name:'行动实验',desc:'把想法带回实际生活，记录假设、行动、预期和真实结果。',fields:['待验证假设','具体行动','时间范围','成功标准','预期与实际','下一步'],question:'我可以做一个什么小行动，来验证现在的理解？'},
 {id:'entities',name:'重要影响',desc:'记录对自我探索有重要影响的人、书、概念、工具与事件。',fields:['对象与背景','如何影响我','出现记录','评价变化','相关洞察','原始依据'],question:'这个对象如何改变了我的理解或选择？'}
];
const menu=document.getElementById('category-menu'),detail=document.getElementById('category-detail');
let selected='insights';
function node(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function showCategory(id,focus=false){
 selected=id;const c=categories.find(x=>x.id===id);if(!c)return;
 menu.querySelectorAll('button').forEach(b=>{const on=b.dataset.id===id;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
 detail.replaceChildren();detail.setAttribute('aria-labelledby','tab-'+id);
 const top=node('div','detail-top');top.append(node('span','number',String(categories.indexOf(c)+1).padStart(2,'0')+' / '+c.id.toUpperCase()),node('span','pill','待填写模板'));detail.append(top,node('h3','',c.name),node('p','desc',c.desc),node('div','detail-label','页面记录什么'));
 const fields=node('div','fields');c.fields.forEach(f=>fields.append(node('span','',f)));detail.append(fields,node('p','detail-question',c.question),node('p','detail-source','依据性质与置信度单独标注 · 每个结论链接原始材料'));
 if(focus)menu.querySelector('[data-id="'+id+'"]').focus();
}
function renderMenu(query=''){
 const q=query.trim().toLowerCase(),filtered=categories.filter(c=>[c.name,c.desc,...c.fields].join(' ').toLowerCase().includes(q));menu.replaceChildren();
 for(const c of filtered){const b=node('button');b.type='button';b.dataset.id=c.id;b.id='tab-'+c.id;b.setAttribute('role','tab');b.setAttribute('aria-controls','category-detail');b.append(node('span','',String(categories.indexOf(c)+1).padStart(2,'0')),node('span','',c.name),node('span','arrow','↗'));b.addEventListener('click',()=>showCategory(c.id));b.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();let i=filtered.findIndex(x=>x.id===c.id),dir=['ArrowDown','ArrowRight'].includes(e.key)?1:-1;showCategory(filtered[(i+dir+filtered.length)%filtered.length].id,true);}});menu.append(b);}
 if(!filtered.length){menu.append(node('p','empty-search','没有匹配的分类'));detail.replaceChildren(node('h3','','换个关键词试试'),node('p','desc','可以搜索“证据”“价值观”“行动”或“转变”。'));}
 else showCategory(filtered.some(c=>c.id===selected)?selected:filtered[0].id);
 document.getElementById('search-result').textContent=q?'找到 '+filtered.length+' 个分类。当前结果来自分类说明，不是个人对话搜索。':'这里展示七类认知标签说明。四大领域与复盘内容请进入飞书工作台。';
}
document.getElementById('category-search').addEventListener('input',e=>renderMenu(e.target.value));renderMenu();
document.getElementById('copy-prompt').addEventListener('click',async()=>{const status=document.getElementById('copy-status');try{const r=await fetch('distill-prompt.txt');if(!r.ok)throw Error('download');const text=await r.text();await navigator.clipboard.writeText(text);status.textContent='已复制。将提示词与一段真实对话一起交给 AI。';}catch{status.replaceChildren();const a=node('a','','点击下载提炼提示词');a.href='distill-prompt.txt';a.download='distill-prompt.txt';status.append(a);}});
fetch('feishu-links.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(config=>{let count=0;document.querySelectorAll('[data-doc]').forEach(a=>{const url=config.documents?.[a.dataset.doc];if(typeof url==='string'&&/^https:\/\/([a-z0-9-]+\.)*(feishu\.cn|larksuite\.com)\//i.test(url)){a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.hidden=false;count++;}});if(count===3){document.querySelector('.connection i').style.background='#6e895e';document.getElementById('connection-label').replaceChildren(document.createTextNode('飞书已连接'),node('small','','点击文档进入在线编辑'));document.getElementById('docs-description').textContent='详细资料在飞书中编辑，访问范围由各文档权限控制。导入稿保留作初始备份。';}}).catch(()=>{});
const anchors=[...document.querySelectorAll('nav a')];
const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){anchors.forEach(a=>a.classList.toggle('active',a.hash==='#'+entry.target.id));}});},{rootMargin:'-15% 0px -60% 0px',threshold:0});
document.querySelectorAll('header[id],section[id]').forEach(s=>observer.observe(s));
