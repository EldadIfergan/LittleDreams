import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { photoDetails, approvalCapacity } from '../lib/photo-requests.js';

test('photo requests reject unsupported formats and preserve event size limits',()=>{
  for(const file of [{name:'x.svg',type:'image/svg+xml',size:10},{name:'x.jpg',type:'image/jpeg',size:10485761},{name:'x.jpg',type:'image/jpeg',size:0}])assert.throws(()=>photoDetails(file),{status:400});
  assert.throws(()=>approvalCapacity(11,1),{status:400});
  assert.throws(()=>approvalCapacity(2,104857601),{status:400});
});

test('family photo requests stay private until a parent approves, with capacity and deletion safeguards',async t=>{
  const data=mkdtempSync(join(tmpdir(),'little-dreams-requests-'));
  const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:data,PORT:'0',HOST:'127.0.0.1',BACKUP_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{
    const stopped=once(server,'exit');server.kill();await stopped;
    assert.ok(resolve(data).startsWith(resolve(tmpdir())+sep));rmSync(data,{recursive:true,force:true});
  });
  let errors='';server.stderr.on('data',chunk=>errors+=chunk);
  const ready=await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw new Error(errors);})]);
  const base='http://127.0.0.1:'+ /port (\d+)/.exec(String(ready[0]))[1];
  async function call(path,body,cookie='') {
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const profile={childName:'Child',birthDate:'2026-01-01'},password='photo-request-test-123';
  const parent=await call('/api/register',{...profile,name:'Parent',email:'parent@example.test',password});
  const album=(await call('/api/me',undefined,parent.cookie)).body.albums[0].id;
  async function guest(email) {
    const invite=(await call('/api/invites',{album,role:'viewer'},parent.cookie)).body.token;
    return call('/api/register',{name:email,email:email+'@example.test',password,invite});
  }
  const viewer=await guest('viewer'),other=await guest('other');
  const outsider=await call('/api/register',{...profile,name:'Outsider',email:'outsider@example.test',password});
  const photo={name:'photo.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='};
  const create=async(files=[]) => (await call('/api/moments',{album,title:'A family moment',date:'2026-02-01',description:'',files},parent.cookie)).body.id;
  const moment=await create();
  const submit=(id=moment,files=[photo],cookie=viewer.cookie)=>call('/api/photo-requests',{moment:id,files},cookie);
  const list=cookie=>call('/api/photo-requests?album='+album,undefined,cookie);
  const review=(id,decision,cookie=parent.cookie)=>call('/api/photo-requests/review',{id,decision},cookie);
  const media=(id,cookie,path='/api/photo-requests/files/')=>fetch(base+path+id,{headers:{cookie}});
  assert.equal((await submit(moment,[photo],'')).status,401);
  assert.equal((await submit(moment,[photo],outsider.cookie)).status,403);
  assert.equal((await list(outsider.cookie)).status,403);
  assert.equal((await submit('missing')).status,404);
  assert.equal((await submit(moment,[])).status,400);
  assert.equal((await submit(moment,[{...photo,type:'image/svg+xml'}])).status,400);
  assert.equal((await submit(moment,[photo,photo])).status,201);
  let requests=(await list(viewer.cookie)).body;
  assert.equal(requests.length,2);assert.ok(requests.every(r=>r.status==='pending' && r.author==='viewer'));
  assert.equal((await list(parent.cookie)).body.length,2);
  assert.deepEqual((await list(other.cookie)).body,[]);
  const [approve,reject]=requests;
  assert.equal((await media(approve.id,viewer.cookie)).status,200);
  assert.equal((await media(approve.id,parent.cookie)).status,200);
  assert.equal((await media(approve.id,other.cookie)).status,403);
  assert.equal((await media(approve.id,outsider.cookie)).status,403);
  assert.equal((await media(approve.id,other.cookie,'/api/files/')).status,404);
  assert.equal((await review(approve.id,'approved',viewer.cookie)).status,403);
  assert.equal((await review(approve.id,'approved',outsider.cookie)).status,403);
  assert.equal((await review(approve.id,'unknown')).status,400);
  assert.equal((await call('/api/moments?album='+album,undefined,other.cookie)).body[0].files.length,0);
  // Repeated approval is safe, including two simultaneous parent requests.
  const approvals=await Promise.all([review(approve.id,'approved'),review(approve.id,'approved')]);
  assert.deepEqual(approvals.map(r=>r.status),[200,200]);
  assert.equal((await call('/api/moments?album='+album,undefined,other.cookie)).body[0].files.length,1);
  assert.equal((await media(approve.id,other.cookie,'/api/files/')).status,200);
  assert.equal((await review(approve.id,'rejected')).status,409);
  assert.equal((await review(reject.id,'rejected')).status,200);
  assert.equal((await review(reject.id,'rejected')).status,200);
  assert.equal((await media(reject.id,viewer.cookie)).status,404);
  assert.ok(!readdirSync(join(data,'uploads')).includes(reject.id));
  assert.deepEqual((await list(parent.cookie)).body,[]);
  assert.deepEqual(new Set((await list(viewer.cookie)).body.map(r=>r.status)),new Set(['approved','rejected']));
  const almostFull=await create(Array(9).fill(photo));
  assert.equal((await submit(almostFull,[photo,photo])).status,201);
  const capacity=(await list(parent.cookie)).body;
  const decisions=await Promise.all(capacity.map(r=>review(r.id,'approved')));
  assert.deepEqual(decisions.map(r=>r.status).sort(),[200,400]);
  assert.equal((await list(parent.cookie)).body.length,1,'excess photo remains pending');
  const deleting=await create(),retained=await create();
  await submit(deleting);await submit(retained);
  const waiting=(await list(parent.cookie)).body;
  const deletedPhoto=waiting.find(r=>r.moment_id===deleting),retainedPhoto=waiting.find(r=>r.moment_id===retained);
  assert.equal((await call('/api/moments/delete',{album,id:deleting,targetId:retained},parent.cookie)).status,200);
  assert.equal((await review(deletedPhoto.id,'approved')).status,404);
  assert.equal((await media(deletedPhoto.id,viewer.cookie)).status,404);
  assert.ok(!readdirSync(join(data,'uploads')).includes(deletedPhoto.id));
  assert.equal((await media(retainedPhoto.id,viewer.cookie)).status,200);
  assert.equal((await submit(retained,Array(10).fill(photo))).status,400,'pending cap includes previous submissions');
});
