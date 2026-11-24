// 增量写入协议：只提交本次真实发生的改动，由服务端合并到最新版本。
// 这样多个页面、多个入口同时写入时不会互相覆盖，也不再依赖可能被边缘改写的 ETag。
export const WORKSPACE_COLLECTIONS=['records','sources','skills','actions','feedback','reviews','events','profiles','documents'];
export const LAB_COLLECTIONS=['models','observations','scenarios','states','experiments','configHistory'];
const MAX_OPS=300;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// 对比上一次同步成功的快照与当前状态，生成最小操作集。只产生新增/修改，不产生删除。
export function workspaceOps(prev,next,{limit=MAX_OPS}={}){
 if(!next||typeof next!=='object')throw Error('当前资料为空，无法生成保存操作。');
 const ops=[];
 for(const collection of WORKSPACE_COLLECTIONS){
  const before=new Map(((prev?.[collection])||[]).map(x=>[x.id,JSON.stringify(x)]));
  for(const item of (next[collection]||[])){
   if(!item||typeof item.id!=='string')throw Error('保存项缺少编号，已停止保存。');
   if(before.get(item.id)!==JSON.stringify(item))ops.push({collection,item});
  }
 }
 const prevLab=prev?.lab,nextLab=next?.lab;
 if(nextLab){
  for(const key of LAB_COLLECTIONS){
   const before=new Map(((prevLab?.[key])||[]).map(x=>[x.id,JSON.stringify(x)]));
   for(const item of (nextLab[key]||[])){
    if(!item||typeof item.id!=='string')throw Error('个人模型保存项缺少编号，已停止保存。');
    if(before.get(item.id)!==JSON.stringify(item))ops.push({collection:'lab.'+key,item});
   }
  }
  if(!same(prevLab?.config,nextLab.config))ops.push({collection:'lab.config',value:nextLab.config});
 }
 if(!same(prev?.coverage,next.coverage))ops.push({collection:'coverage',value:next.coverage});
 if(ops.length>limit)throw Error('本次修改了 '+ops.length+' 项，超过单次上限，请先导出当前资料再分批保存。');
 return ops;
}

// 服务端把操作合并到最新状态：同编号替换为本次提交的版本，新编号追加；不提供删除操作。
export function applyWorkspaceOps(state,ops,{limit=MAX_OPS}={}){
 if(!state||typeof state!=='object')throw Error('云端资料格式不正确。');
 if(!Array.isArray(ops)||!ops.length)throw Error('没有需要保存的修改。');
 if(ops.length>limit)throw Error('单次保存的操作过多。');
 const merged=JSON.parse(JSON.stringify(state));
 for(const op of ops){
  if(!op||typeof op!=='object')throw Error('操作格式不正确。');
  const collection=op.collection;
  if(collection==='coverage'){
   if(!op.value||typeof op.value!=='object'||Array.isArray(op.value))throw Error('资料范围格式不正确。');
   merged.coverage=op.value;
   continue;
  }
  if(collection==='lab.config'){
   if(!merged.lab)throw Error('当前资料没有个人模型模块，无法保存规则。');
   merged.lab.config=op.value;
   continue;
  }
  const item=op.item;
  if(!item||typeof item.id!=='string'||!item.id)throw Error('保存项缺少编号。');
  let list;
  if(WORKSPACE_COLLECTIONS.includes(collection)){
   list=merged[collection];
  }else if(typeof collection==='string'&&collection.startsWith('lab.')){
   const key=collection.slice(4);
   if(!LAB_COLLECTIONS.includes(key))throw Error('未知的数据集合：'+collection);
   if(!merged.lab)throw Error('当前资料没有个人模型模块，无法保存该项。');
   list=merged.lab[key];
  }else{
   throw Error('未知的数据集合：'+String(collection));
  }
  if(!Array.isArray(list))throw Error('数据集合不存在：'+collection);
  const index=list.findIndex(x=>x&&x.id===item.id);
  if(index>=0)list[index]=item;else list.push(item);
 }
 return merged;
}
