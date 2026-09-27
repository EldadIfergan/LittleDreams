// Explicit opt-in only: creates isolated synthetic albums on the supplied site.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
if(!process.env.SMOKE_BASE) { console.log('Live smoke skipped: set SMOKE_BASE to run.'); process.exit(0); }
const base=process.env.SMOKE_BASE, suffix=randomBytes(8).toString('hex');
const password=randomBytes(24).toString('base64url');
async function call(path,body,cookie='') {
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const value=r.status===302?null:await r.json();
 return {status:r.status,value,cookie:r.headers.get('set-cookie')?.split(';')[0],location:r.headers.get('location')};
}
const details={albumName:'בדיקת מערכת פרטית',childName:'בדיקה',birthDate:'2026-07-27',birthWeight:3200,birthLength:50,sex:'girl'};
const parent=await call('/api/register',{...details,name:'System test',email:`smoke-parent-${suffix}@example.test`,password});
assert.equal(parent.status,200,JSON.stringify(parent.value));
const cookie=parent.cookie;
const me=await call('/api/me',undefined,cookie);assert.equal(me.status,200);
const album=me.value.albums[0].id;
assert.equal((await call('/api/profile',{...details,album,albumName:'שם אלבום מעודכן'},cookie)).status,200);
assert.equal((await call('/api/me',undefined,cookie)).value.albums.find(a=>a.id===album).name,'שם אלבום מעודכן');
assert.equal((await call('/api/profile',{...details,album,albumName:'   '},cookie)).status,400);
assert.equal((await call('/api/profile',{...details,album,avatar:'data:image/svg+xml;base64,PHN2Zz4='},cookie)).status,400);
const second=await call('/api/albums',{...details,albumName:'בדיקת אלבום שני'},cookie);assert.equal(second.status,201);
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
const upload=await call('/api/uploads',{album,name:'smoke.png',type:'image/png',size:bytes.length},cookie);
assert.equal(upload.status,201,JSON.stringify(upload.value));
const put=await fetch(upload.value.url,{method:'PUT',headers:{'content-type':'image/png','x-upsert':'false'},body:bytes});assert.equal(put.ok,true,await put.text());
const moment=await call('/api/moments',{album,title:'בדיקת העלאה',date:'2026-09-27',description:'נתוני בדיקה אוטומטית בלבד',files:[{id:upload.value.id}]},cookie);assert.equal(moment.status,201,JSON.stringify(moment.value));
assert.equal((await call('/api/moments?album='+second.value.id,undefined,cookie)).value.length,0);
const invitation=await call('/api/invites',{album,role:'viewer'},cookie);assert.equal(invitation.status,201);
const viewer=await call('/api/register',{name:'Family test',email:`smoke-viewer-${suffix}@example.test`,password,invite:invitation.value.token});assert.equal(viewer.status,200);
assert.equal((await call('/api/comments',{moment:moment.value.id,body:'בדיקת תגובה משפחתית'},viewer.cookie)).status,201);
assert.equal((await call('/api/uploads',{album,name:'forbidden.png',type:'image/png',size:1},viewer.cookie)).status,403);
assert.equal((await call('/api/moments?album='+second.value.id,undefined,viewer.cookie)).status,403);
assert.equal((await call('/api/files/'+upload.value.id)).status,401);
const file=await call('/api/files/'+upload.value.id,undefined,viewer.cookie);assert.equal(file.status,302);
const download=await fetch(file.location);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
assert.equal((await call('/api/accept',{token:invitation.value.token},viewer.cookie)).status,400);
assert.equal((await call('/api/logout',{},cookie)).status,200);
assert.equal((await call('/api/me',undefined,cookie)).status,401);
const login=await call('/api/login',{email:`smoke-parent-${suffix}@example.test`,password});assert.equal(login.status,200);
const persisted=await call('/api/moments?album='+album,undefined,login.cookie);
assert.equal(persisted.value.length,1);assert.equal(persisted.value[0].comments.length,1);
await call('/api/logout',{},login.cookie);await call('/api/logout',{},viewer.cookie);
console.log('PASS: registration, login, two albums, private upload/download, viewer comments, authorization, single-use invite, logout, persisted data. Synthetic accounts remain isolated.');
