// Opt-in release check using isolated synthetic accounts. Never touches family albums.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const base=process.env.SMOKE_BASE;
if(!base)throw new Error('Set SMOKE_BASE to the deployment to verify.');
const suffix=randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
const sessions=new Set(),moments=[];
async function call(path,body,cookie=''){
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  const result={status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],setCookie:response.headers.get('set-cookie')};
  if(result.cookie&&result.cookie!=='session=')sessions.add(result.cookie);
  return result;
}
let parentCookie;
try {
  const profile={childName:'בדיקת הצטרפות אוטומטית',birthDate:'2026-01-01',sex:'girl'};
  const parent=await call('/api/register',{...profile,name:'Release verification',email:`family-release-${suffix}@example.test`,password});
  assert.equal(parent.status,200,JSON.stringify(parent.body));parentCookie=parent.cookie;
  const album=(await call('/api/me',undefined,parentCookie)).body.albums[0].id;
  const second=await call('/api/albums',{...profile,childName:'בדיקת אלבום נוסף'},parentCookie);assert.equal(second.status,201,JSON.stringify(second.body));
  const invite=async(albumId=album,role='viewer')=>{
    const r=await call('/api/invites',{album:albumId,role},parentCookie);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.token;
  };
  for(const albumId of [album,second.body.id]){
    const r=await call('/api/moments',{album:albumId,title:'בדיקת תגובות משפחתיות',date:'2026-01-02',description:'נתוני בדיקה סינתטיים בלבד',files:[]},parentCookie);
    assert.equal(r.status,201,JSON.stringify(r.body));moments.push({id:r.body.id,album:albumId});
  }
  const token=await invite(),details={invite:token,name:'דורית',phone:'0500000000',relationship:'grandmother'};
  assert.equal((await call('/api/invites/info?token='+token)).body.childName,profile.childName);
  assert.equal((await call('/api/family/join',{...details,phone:'123'})).status,400);
  const family=await call('/api/family/join',{...details,role:'parent',album:second.body.id});
  assert.equal(family.status,200,JSON.stringify(family.body));assert.equal(family.body.album,album);
  assert.match(family.setCookie,/HttpOnly/);assert.match(family.setCookie,/SameSite=Strict/);assert.match(family.setCookie,/Max-Age=7776000/);
  if(base.startsWith('https:'))assert.match(family.setCookie,/Secure/);
  const me=await call('/api/me',undefined,family.cookie);assert.equal(me.status,200);
  assert.deepEqual(me.body.albums.map(a=>[a.id,a.role]),[[album,'viewer']]);
  assert.equal((await call('/api/family/join',details)).status,410);
  assert.deepEqual((await call('/api/invites/info?token='+token,undefined,family.cookie)).body,{joined:true,album});
  assert.equal((await call('/api/family/join',details,family.cookie)).status,200);
  assert.equal((await call('/api/comments',{moment:moments[0].id,body:'בדיקת תגובה',author:'spoof'},family.cookie)).body.author,'סבתא דורית');
  const read=await call('/api/moments?album='+album,undefined,parentCookie);assert.equal(read.status,200);
  assert.equal(read.body[0].comments[0].author,'סבתא דורית');assert.ok(!JSON.stringify(read.body).includes('500000000'));
  assert.equal((await call('/api/moments?album='+second.body.id,undefined,family.cookie)).status,403);
  assert.equal((await call('/api/moments/delete',moments[0],family.cookie)).status,403);
  assert.equal((await call('/api/albums',profile,family.cookie)).status,403);
  assert.deepEqual((await call('/api/photo-requests?album='+album,undefined,family.cookie)).body,[]);
  const aunt=await call('/api/family/join',{...details,invite:await invite(),name:'לירז',relationship:'aunt'});assert.equal(aunt.status,200);
  assert.equal((await call('/api/comments',{moment:moments[0].id,body:'בדיקת דודה'},aunt.cookie)).body.author,'דודה לירז');
  const another=await call('/api/family/join',{...details,invite:await invite(second.body.id),relationship:'aunt'},family.cookie);assert.equal(another.status,200);
  assert.equal((await call('/api/comments',{moment:moments[1].id,body:'קרבה באלבום נוסף'},another.cookie)).body.author,'דודה דורית');
  assert.equal((await call('/api/comments',{moment:moments[0].id,body:'קרבה באלבום הראשון'},another.cookie)).body.author,'סבתא דורית');
  const parentToken=await invite(album,'parent');
  assert.equal((await call('/api/family/join',{...details,invite:parentToken},family.cookie)).status,400);
  assert.equal((await call('/api/accept',{token:parentToken},family.cookie)).status,403);
  const coParent=await call('/api/register',{name:'Second release parent',email:`family-coparent-${suffix}@example.test`,password,invite:parentToken});
  assert.equal(coParent.status,200,JSON.stringify(coParent.body));assert.equal((await call('/api/me',undefined,coParent.cookie)).body.albums[0].role,'parent');
  console.log('PASS: invitation info, three-field signup, private viewer access, single-use/re-entry, persistent cookie, relationship comment authors, album-specific relationships, and parent invitation compatibility.');
}finally {
  for(const moment of moments){const r=await call('/api/moments/delete',moment,parentCookie);assert.equal(r.status,200,'Synthetic moment cleanup');}
  for(const cookie of sessions)await call('/api/logout',{},cookie);
  console.log('Cleaned synthetic moments/comments and signed out test sessions. Empty synthetic accounts remain isolated.');
}
