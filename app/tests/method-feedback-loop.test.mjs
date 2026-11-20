import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEmptyWorkspace,runReview,activateAction,recordFeedback,saveSkill,methodFeedback,methodComparisons,validateState} from '../public/engine.js';

function fixture() {
 const state=makeEmptyWorkspace();
 state.records.push({id:'synthetic-case',title:'虚构评审',summary:'同一组人工样例',domain:'build',status:'active',reality:'actual'});
 const method={name:'虚构方法',trigger:'有评审',domains:['build'],steps:['先列场景'],suggestion:'先列场景',sourceIds:['synthetic-case']};
 const skill=saveSkill(state,method);
 const perform=verdict=>{
  const review=runReview(state,{recordId:'synthetic-case'}),action=activateAction(state,review.id);
  const feedback=recordFeedback(state,{actionId:action.id,action:'试了一次',outcome:'已经记录结果',methodVerdict:verdict});
  return {review,action,feedback};
 };
 return {state,skill,method,perform};
}

test('evaluated result drives only an explicit revision and the new method is reused',()=>{
 const {state,skill,method,perform}=fixture();
 const before=perform('mixed');
 assert.equal(before.action.methodRun.version,1);
 assert.equal(methodFeedback(state)[0].canRevise,true);
 assert.equal(skill.version,1);
 const input={...method,id:skill.id,expectedVersion:1,evidenceFeedbackId:before.feedback.id,suggestion:'先列场景再列阻碍',rationale:'原步骤遗漏阻碍',criterion:'场景及阻碍各至少一项'};
 assert.throws(()=>saveSkill(state,{...input,criterion:''}),/检查标准/);
 assert.throws(()=>saveSkill(state,{...input,suggestion:method.suggestion}),/修改下一次建议/);
 saveSkill(state,input);
 assert.equal(skill.version,2);
 assert.equal(skill.versions[0].suggestion,method.suggestion);
 assert.equal(before.action.methodRun.version,1);
 assert.ok(skill.sourceIds.includes(before.feedback.memoryId));
 assert.throws(()=>saveSkill(state,input),/版本已变化/);
 const after=perform('met');
 assert.equal(after.review.nextAction,input.suggestion);
 assert.equal(after.action.criterion,input.criterion);
 const [evaluation]=methodComparisons(state);
 assert.deepEqual(evaluation.baseline,{met:0,mixed:1,missed:0});
 assert.deepEqual(evaluation.current,{met:1,mixed:0,missed:0});
 assert.doesNotThrow(()=>validateState(JSON.parse(JSON.stringify(state))));
});

test('unused, ungraded and custom actions do not turn into evidence for a method',()=>{
 const {state,skill,perform}=fixture();
 perform(undefined);perform('unused');
 assert.equal(methodFeedback(state).some(x=>x.canRevise),false);
 state.records.find(r=>r.id==='synthetic-case').suggestedAction='仅适用于这条经历';
 const review=runReview(state,{recordId:'synthetic-case'}),action=activateAction(state,review.id);
 assert.equal(review.methodRun,null);
 assert.throws(()=>recordFeedback(state,{actionId:action.id,action:'动作',outcome:'结果',methodVerdict:'missed'}),/实际使用/);
 recordFeedback(state,{actionId:action.id,action:'动作',outcome:'结果'});
 assert.equal(skill.version,1);
 assert.equal(methodFeedback(state).length,1);
});
