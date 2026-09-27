import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checklist,milestones,milestoneKey} from '../lib/checklist.js';
test('catalog keeps all original milestones and unique stable keys',()=>{
 assert.equal(new Set(milestones.map(i=>i.key)).size,milestones.length);
 for(const key of ['smile','head','reach','roll','transfer','sit','crawl','wave','stand','steps','word','spoon']) assert.equal(milestoneKey(key),key);
 assert.throws(()=>milestoneKey('unknown'),{status:400});
});
test('family traditions follow child profile; developmental milestones are shared',()=>{
 const boy=checklist([],'boy'),girl=checklist([],'girl'),neutral=checklist([]);
 assert.ok(boy.some(i=>i.key==='brit'));assert.ok(boy.some(i=>i.key==='pidyon'));
 assert.ok(!girl.some(i=>i.key==='brit'));assert.ok(girl.some(i=>i.key==='simchat-bat'));
 assert.ok(!neutral.some(i=>i.sex));
 assert.deepEqual(boy.filter(i=>!i.sex),girl.filter(i=>!i.sex));
});
test('changing profile preserves recorded milestones and links',()=>{
 const rows=[{key:'brit',completed:1,moment_id:'event'},{key:'pidyon',completed:0,moment_id:'other'}];
 const result=checklist(rows,'girl');
 assert.equal(result.find(i=>i.key==='brit').momentId,'event');
 assert.equal(result.find(i=>i.key==='pidyon').completed,false);
 assert.ok(!checklist([{key:'brit',completed:0}], 'girl').some(i=>i.key==='brit'));
});
