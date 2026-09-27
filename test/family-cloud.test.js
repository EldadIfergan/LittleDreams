import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import handler from '../api/index.js';

process.env.DATABASE_URL='postgres://test:test@localhost/test';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-key';
process.env.NODE_ENV='production';
// Handler/transaction tests with a SQL double; no production database is used.
let calls=[],signedIn=false,member=false,invitation,failProfile=false;
const reset=()=>{calls=[];signedIn=false;member=false;failProfile=false;invitation={album_id:'album',child_name:'נועה',sex:'girl',role:'viewer',used:0,expires:Date.now()+60000};};
pg.Pool.prototype.connect=async()=>({
  async query(sql,values=[]){
    calls.push({sql,values});let rows=[];
    if(sql.startsWith('SELECT to_regclass'))rows=[{requests:'photo_requests',uploads:'photo_request_uploads',family:'family_profiles'}];
    else if(sql.startsWith('SELECT i.*')||sql.startsWith('SELECT * FROM invites'))rows=invitation?[invitation]:[];
    else if(sql.startsWith('SELECT user_id FROM sessions'))rows=signedIn?[{user_id:'guest'}]:[];
    else if(sql.startsWith('SELECT role FROM members'))rows=member?[{role:'viewer'}]:[];
    else if(sql.startsWith('SELECT password FROM users'))rows=[{password:null}];
    else if(sql.startsWith('SELECT album_id FROM moments'))rows=[{album_id:'album'}];
    else if(sql.startsWith('SELECT name,relationship FROM family_profiles'))rows=[{name:'לירז',relationship:'aunt'}];
    else if(sql.startsWith('SELECT * FROM moments'))rows=[{id:'moment',album_id:'album',created:'42'}];
    else if(sql.startsWith('SELECT c.id'))rows=[{id:'comment',body:'hello',author:'Original name',family_name:'לירז',relationship:'aunt',created:'43'}];
    else if(sql.startsWith('INSERT INTO family_profiles')&&failProfile)throw Object.assign(new Error('Profile insert failed'),{status:503});
    return {rows};
  },release(){}
});
async function request(url,body,origin='https://album.test'){
  let result;const headers={};
  await handler({url,method:body===undefined?'GET':'POST',headers:{host:'album.test',origin,'content-type':'application/json',cookie:'session=abc'},body},{
    setHeader(name,value){headers[name]=value;if(name==='Set-Cookie')calls.push({sql:'SET COOKIE'});},
    end(value){result={status:this.statusCode,body:JSON.parse(value),headers};}
  });return result;
}
const details={invite:'a'.repeat(48),name:'דורית',phone:'050-1234567',relationship:'grandmother'};
test('cloud invite lookup reveals only a valid invitation, or existing membership',async()=>{
  reset();assert.deepEqual((await request('/api/invites/info?token='+details.invite)).body,{role:'viewer',childName:'נועה',sex:'girl'});
  invitation.used=1;assert.equal((await request('/api/invites/info?token='+details.invite)).status,410);
  signedIn=true;member=true;assert.deepEqual((await request('/api/invites/info?token='+details.invite)).body,{joined:true,album:'album'});
  assert.ok(!calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)));
});
test('cloud family signup locks and consumes the invite, forces viewer, then commits before setting a cookie',async()=>{
  reset();const result=await request('/api/family/join',{...details,role:'parent',album:'foreign'});
  assert.equal(result.status,200);assert.equal(result.body.album,'album');
  assert.ok(calls.some(c=>c.sql.endsWith('FOR UPDATE OF i')));
  assert.ok(calls.some(c=>c.sql.includes('VALUES($1,NULL,$2,NULL)')));
  const membership=calls.find(c=>c.sql.startsWith('INSERT INTO members'));
  assert.match(membership.sql,/'viewer'/);assert.equal(membership.values[1],'album');
  assert.deepEqual(calls.find(c=>c.sql.startsWith('INSERT INTO family_profiles')).values.slice(1),['album','דורית','+972501234567','grandmother']);
  assert.ok(calls.some(c=>c.sql==='UPDATE invites SET used=1 WHERE token=$1'));
  assert.match(result.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);assert.match(result.headers['Set-Cookie'],/Max-Age=7776000/);
  assert.deepEqual(calls.slice(-2).map(c=>c.sql),['COMMIT','SET COOKIE']);
});
test('cloud family signup rejects parent/used invites and rolls back failed saves without issuing a session',async()=>{
  for(const change of [{role:'parent'},{used:1},{expires:0}]){
    reset();Object.assign(invitation,change);
    assert.ok([400,410].includes((await request('/api/family/join',details)).status));
    assert.ok(!calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)));
  }
  reset();failProfile=true;assert.equal((await request('/api/family/join',details)).status,503);
  assert.equal(calls.at(-1).sql,'ROLLBACK');assert.ok(!calls.some(c=>c.sql==='SET COOKIE'));
  reset();assert.equal((await request('/api/family/join',details,'https://foreign.test')).status,403);assert.equal(calls.length,0);
  reset();signedIn=true;assert.equal((await request('/api/albums',{})).status,403);
  invitation.role='parent';assert.equal((await request('/api/accept',{token:details.invite})).status,403);
});
test('cloud comments format the same album-specific author on creation and reload',async()=>{
  reset();signedIn=true;member=true;
  const created=await request('/api/comments',{moment:'moment',body:'hello',author:'Forged author'});
  assert.equal(created.status,201);assert.equal(created.body.author,'דודה לירז');
  const read=await request('/api/moments?album=album');
  assert.equal(read.status,200);assert.equal(read.body[0].comments[0].author,'דודה לירז');
  assert.equal(read.body[0].comments[0].created,43);assert.ok(!('family_name' in read.body[0].comments[0]));
  const sql=calls.find(c=>c.sql.startsWith('SELECT c.id'));
  assert.match(sql.sql,/f.album_id=\$2/);assert.equal(sql.values[1],'album');
  member=false;assert.equal((await request('/api/comments',{moment:'moment',body:'hello'})).status,403);
});
