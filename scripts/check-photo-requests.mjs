// Opt-in verification using isolated synthetic accounts and photos.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
const base=process.env.SMOKE_BASE;
if(!base)throw new Error('Set SMOKE_BASE to the deployment to verify.');
const suffix=randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
async function call(path,body,cookie='') {
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  return {status:r.status,body:r.status===302?null:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],location:r.headers.get('location')};
}
const parent=await call('/api/register',{name:'Photo request test',email:`photo-parent-${suffix}@example.test`,password,childName:'בדיקת בקשות תמונה',birthDate:'2026-01-01'});
assert.equal(parent.status,200,JSON.stringify(parent.body));
const album=(await call('/api/me',undefined,parent.cookie)).body.albums[0].id;
async function guest(name) {
  const invite=await call('/api/invites',{album,role:'viewer'},parent.cookie);assert.equal(invite.status,201);
  const result=await call('/api/register',{name,email:`photo-${name}-${suffix}@example.test`,password,invite:invite.body.token});assert.equal(result.status,200);return result.cookie;
}
const viewer=await guest('sender'),other=await guest('other');
const moment=(await call('/api/moments',{album,title:'Photo request integration test',description:'Synthetic test data',date:'2026-09-27',files:[]},parent.cookie)).body.id;
const bytes=Buffer.from(readFileSync(new URL('../test/avatar-fixture.txt',import.meta.url),'utf8').trim(),'base64');
const uploadData={moment,name:'test-photo.jpg',type:'image/jpeg',size:bytes.length};
assert.equal((await call('/api/photo-requests/uploads',uploadData)).status,401);
assert.equal((await call('/api/uploads',{album,name:'test-photo.jpg',type:'image/jpeg',size:bytes.length},viewer)).status,403);
assert.equal((await call('/api/photo-requests/uploads',{...uploadData,type:'image/svg+xml'},viewer)).status,400);
async function upload(){const result=await call('/api/photo-requests/uploads',uploadData,viewer);assert.equal(result.status,201,JSON.stringify(result.body));const put=await fetch(result.body.url,{method:'PUT',headers:{'content-type':'image/jpeg','x-upsert':'false'},body:bytes});assert.equal(put.ok,true);return result.body.id;}
const ids=[await upload(),await upload()];
assert.equal((await call('/api/photo-requests',{moment,files:ids.map(id=>({id}))},other)).status,400,'another member cannot claim uploads');
assert.equal((await call('/api/photo-requests',{moment,files:ids.map(id=>({id}))},viewer)).status,201);
assert.equal((await call('/api/photo-requests',{moment,files:ids.map(id=>({id}))},viewer)).status,200,'retry does not duplicate requests');
const list=cookie=>call('/api/photo-requests?album='+album,undefined,cookie);
assert.equal((await list(parent.cookie)).body.length,2);
assert.equal((await list(viewer)).body.length,2);
assert.deepEqual((await list(other)).body,[]);
assert.equal((await call('/api/photo-requests/files/'+ids[0],undefined,other)).status,403);
assert.equal((await call('/api/files/'+ids[0],undefined,viewer)).status,404);
const preview=await call('/api/photo-requests/files/'+ids[0],undefined,parent.cookie);assert.equal(preview.status,302);
assert.deepEqual(Buffer.from(await(await fetch(preview.location)).arrayBuffer()),bytes);
const review=(id,decision,cookie=parent.cookie)=>call('/api/photo-requests/review',{id,decision},cookie);
assert.equal((await review(ids[0],'approved',viewer)).status,403);
const approvals=await Promise.all([review(ids[0],'approved'),review(ids[0],'approved')]);
assert.deepEqual(approvals.map(r=>r.status),[200,200],JSON.stringify(approvals));
assert.equal((await call('/api/moments?album='+album,undefined,other)).body[0].files.length,1);
assert.equal((await call('/api/files/'+ids[0],undefined,other)).status,302);
assert.equal((await review(ids[1],'rejected')).status,200);
assert.equal((await call('/api/photo-requests/files/'+ids[1],undefined,viewer)).status,404);
assert.deepEqual((await list(parent.cookie)).body,[]);
assert.deepEqual(new Set((await list(viewer)).body.map(r=>r.status)),new Set(['approved','rejected']));
const pending=await upload();await call('/api/photo-requests',{moment,files:[{id:pending}]},viewer);
assert.equal((await call('/api/moments/delete',{album,id:moment},parent.cookie)).status,200);
assert.deepEqual((await list(viewer)).body,[]);
assert.equal((await call('/api/files/'+ids[0],undefined,parent.cookie)).status,404);
assert.equal((await call('/api/photo-requests/files/'+pending,undefined,parent.cookie)).status,404);
for(const cookie of [parent.cookie,viewer,other])await call('/api/logout',{},cookie);
console.log('PASS: cloud upload, private requests/previews, upload ownership, parent-only approval, concurrent approval, rejection, publication, and event cleanup. Synthetic empty accounts remain isolated.');
