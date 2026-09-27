import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planEdit} from '../lib/event-edit.js';
const moment={id:'m',album_id:'a',title:'first',date:'2026-09-27',description:'story'};
const files=[{id:'1'},{id:'2'}];
const body={album:'a',keepFiles:['2'],original:{...moment,files:['1','2']}};
test('only explicitly removed event attachments are removed',()=>assert.deepEqual(planEdit(body,moment,files),{kept:[{id:'2'}],removed:[{id:'1'}]}));
test('rejects cross-event file references and album mismatch',()=>{
  assert.throws(()=>planEdit({...body,keepFiles:['foreign']},moment,files),{status:400});
  assert.throws(()=>planEdit({...body,album:'other'},moment,files),{status:404});
});
test('stale edits cannot overwrite a concurrent parent edit',()=>{
  assert.throws(()=>planEdit(body,{...moment,title:'new title'},files),{status:409});
  assert.throws(()=>planEdit(body,moment,[...files,{id:'3'}]),{status:409});
});
