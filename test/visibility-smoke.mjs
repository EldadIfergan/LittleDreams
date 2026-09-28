import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
if(!process.env.SMOKE_BASE){console.log('Visibility integration skipped: set SMOKE_BASE.');process.exit(0);}
const base=process.env.SMOKE_BASE,suffix=randomBytes(8).toString('hex'),password=randomBytes(20).toString('hex');
async function call(path,body,cookie='') {
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const value=r.headers.get('content-type')?.includes('application/json')?await r.json():null;
 return {status:r.status,value,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const p=await call('/api/register',{albumName:'Privacy test',childName:'Test',birthDate:'2026-01-01',name:'Parent',email:`privacy-${suffix}@example.test`,password});assert.equal(p.status,200);
const cookie=p.cookie,album=(await call('/api/me',undefined,cookie)).value.albums[0].id;
async function invite(role){const invitation=await call('/api/invites',{album,role},cookie);return (await call('/api/register',{name:role,email:`privacy-${role}-${suffix}@example.test`,password,invite:invitation.value.token})).cookie;}
const viewer=await invite('viewer'),secondParent=await invite('parent');
const direct=(await call('/api/config')).value.directUploads;
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
let file={name:'privacy.png',type:'image/png',data:bytes.toString('base64')};
if(direct){const upload=await call('/api/uploads',{album,name:file.name,type:file.type,size:bytes.length},cookie);assert.equal(upload.status,201);assert.ok((await fetch(upload.value.url,{method:'PUT',headers:{'content-type':file.type,'x-upsert':'false'},body:bytes})).ok);file={id:upload.value.id};}
const result=await call('/api/moments',{album,title:'Private smile',date:'2026-02-01',description:'Private description',visibility:'parents',files:[file],milestoneKey:'smile'},cookie);assert.equal(result.status,201,JSON.stringify(result.value));
const read=async c=>(await call('/api/moments?album='+album,undefined,c)).value;
const snapshot=(await read(cookie))[0],id=snapshot.id,fileId=snapshot.files[0].id;
assert.equal((await read(viewer)).length,0);assert.equal((await read(secondParent)).length,1);
assert.equal((await call('/api/files/'+fileId,undefined,viewer)).status,404);
assert.equal((await call('/api/files/'+fileId,undefined,secondParent)).status,direct?302:200);
assert.equal((await call('/api/comments',{moment:id,body:'Blocked'},viewer)).status,404);
assert.equal((await call('/api/comments',{moment:id,body:'Parent comment'},secondParent)).status,201);
assert.equal((await call('/api/photo-requests',{moment:id,files:[direct?{id:'missing'}:{name:'x.png',type:'image/png',data:bytes.toString('base64')}]},viewer)).status,404);
if(direct)assert.equal((await call('/api/photo-requests/uploads',{moment:id,name:'x.png',type:'image/png',size:bytes.length},viewer)).status,404);
assert.equal((await call('/api/photo-requests?album='+album,undefined,viewer)).value.length,0);
const check=(await call('/api/checklist?album='+album,undefined,viewer)).value.find(i=>i.key==='smile');assert.equal(check.momentId,null);assert.equal(check.completed,false);
function edit(m,visibility){return {album,id:m.id,title:m.title,date:m.date,description:m.description,visibility,files:[],keepFiles:m.files.map(f=>f.id),original:{title:m.title,date:m.date,description:m.description,visibility:m.visibility,files:m.files.map(f=>f.id)}};}
assert.equal((await call('/api/moments',edit(snapshot,'family'),viewer)).status,403);
assert.equal((await call('/api/moments',edit(snapshot,'family'),secondParent)).status,200);
assert.equal((await read(viewer))[0].comments.length,1);
assert.equal((await call('/api/files/'+fileId,undefined,viewer)).status,direct?302:200);
assert.equal((await call('/api/comments',{moment:id,body:'Family comment'},viewer)).status,201);
assert.equal((await call('/api/moments',edit(snapshot,'parents'),cookie)).status,409);
const shared=(await read(cookie))[0];assert.equal((await call('/api/moments',edit(shared,'parents'),cookie)).status,200);
assert.equal((await read(viewer)).length,0);assert.equal((await call('/api/files/'+fileId,undefined,viewer)).status,404);
assert.equal((await call('/api/comments',{moment:id,body:'Blocked again'},viewer)).status,404);
assert.equal((await read(cookie))[0].comments.length,2);
assert.equal((await call('/api/moments',{album,title:'Bad visibility',date:'2026-02-01',description:'',files:[],visibility:'public'},cookie)).status,400);
for(const c of [cookie,viewer,secondParent])await call('/api/logout',{},c);
console.log('PASS visibility: both parents, viewer isolation, private files/comments/checklist, sharing and hiding, stale-edit protection.');
