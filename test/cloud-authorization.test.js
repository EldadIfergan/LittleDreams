import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import handler from '../api/index.js';

process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
process.env.NODE_ENV = 'production';

// A database double isolates HTTP authorization. Real SQL/storage tests remain
// part of deployment verification and are not covered by this suite.
let signedIn = true, role = 'viewer', statements = [], momentExists = true;
pg.Pool.prototype.connect = async () => ({
  async query(sql) {
    statements.push(sql);
    if (sql.startsWith('SELECT to_regclass')) return {rows:[{requests:'photo_requests',uploads:'photo_request_uploads'}]};
    if (sql.startsWith('SELECT user_id FROM sessions')) return {rows:signedIn ? [{user_id:'user'}] : []};
    if (sql.startsWith('SELECT role FROM members')) return {rows:role ? [{role}] : []};
    if (sql.startsWith('SELECT album_id FROM moments')) return {rows:[{album_id:'album'}]};
    if (sql.startsWith('SELECT id,album_id FROM moments')) return {rows:momentExists ? [{id:'moment',album_id:'album'}] : []};
    if (sql.startsWith('SELECT moment_id FROM photo_requests')) return {rows:[{moment_id:'moment'}]};
    if (sql.startsWith('SELECT r.*,m.album_id FROM photo_requests')) return {rows:[{id:'photo',album_id:'album',user_id:'sender',status:'pending'}]};
    if (sql.startsWith('SELECT id FROM moments')) return {rows:momentExists ? [{id:'moment'}] : []};
    if (sql.startsWith('SELECT name FROM users')) return {rows:[{name:'Family'}]};
    return {rows:[]};
  }, release() {}
});
async function request(url, body, origin='https://album.test') {
  statements=[];
  let result;
  const res={setHeader(){},end(value){result={status:this.statusCode,body:JSON.parse(value)};}};
  await handler({url,method:body===undefined?'GET':'POST',headers:{host:'album.test',origin,'content-type':'application/json',cookie:'session=abc'},body},res);
  return result;
}
test('unauthenticated album reads are rejected', async () => {
  signedIn=false;
  assert.equal((await request('/api/moments?album=album')).status,401);
  signedIn=true;
});
test('foreign origins cannot write', async () => {
  assert.equal((await request('/api/comments',{moment:'moment',body:'hello'},'https://other.test')).status,403);
  assert.equal(statements.length,0);
});
test('viewers cannot upload or create moments', async () => {
  role='viewer';
  for(const path of ['/api/uploads','/api/moments','/api/moments/delete']) {
    assert.equal((await request(path,{album:'album'})).status,403);
    assert.ok(!statements.some(s=>s.startsWith('INSERT')));
    assert.ok(!statements.some(s=>s.startsWith('DELETE')));
  }
});
test('album members can add comments', async () => {
  role='viewer';
  const response=await request('/api/comments',{moment:'moment',body:'hello'});
  assert.equal(response.status,201);
  assert.equal(response.body.body,'hello');
  assert.ok(statements.some(s=>s.startsWith('INSERT INTO comments')));
});
test('outsiders cannot read moments or add comments', async () => {
  role=null;
  assert.equal((await request('/api/moments?album=album')).status,403);
  assert.equal((await request('/api/comments',{moment:'moment',body:'hello'})).status,403);
  assert.ok(!statements.some(s=>s.startsWith('INSERT')));
});

test('cloud photo requests enforce membership, photo types and parent-only approval',async()=>{
  role=null;
  assert.equal((await request('/api/photo-requests?album=album')).status,403);
  assert.equal((await request('/api/photo-requests/uploads',{moment:'moment',name:'x.png',type:'image/png',size:10})).status,403);
  assert.equal((await request('/api/photo-requests',{moment:'moment',files:[{id:'photo'}]})).status,403);
  role='viewer';
  assert.equal((await request('/api/photo-requests/uploads',{moment:'moment',name:'x.svg',type:'image/svg+xml',size:10})).status,400);
  assert.equal((await request('/api/photo-requests/review',{id:'photo',decision:'approved'})).status,403);
  assert.ok(!statements.some(s=>s.startsWith('INSERT INTO files')));
  assert.equal((await request('/api/photo-requests/files/photo')).status,403,'another viewer cannot preview pending photos');
  assert.equal((await request('/api/photo-requests',{moment:'moment',files:[{id:'x'},{id:'x'}]})).status,400);
});
test('parent deletion commits related record removal; missing events cause no deletion', async () => {
  role='parent';momentExists=true;
  assert.equal((await request('/api/moments/delete',{album:'album',id:'moment'})).status,200);
  assert.ok(statements.includes('UPDATE checklist SET moment_id=NULL WHERE moment_id=$1'));
  assert.deepEqual(statements.filter(s=>s.startsWith('DELETE')), [
    'DELETE FROM comments WHERE moment_id=$1',
    'DELETE FROM files WHERE moment_id=$1',
    'DELETE FROM moments WHERE id=$1 AND album_id=$2'
  ]);
  assert.equal(statements.at(-1),'COMMIT');
  momentExists=false;
  assert.equal((await request('/api/moments/delete',{album:'album',id:'missing'})).status,404);
  assert.ok(!statements.some(s=>s.startsWith('DELETE')));
  assert.equal(statements.at(-1),'ROLLBACK');
  momentExists=true;
});
test('cloud transfer reassigns files without deleting them and rejects the source as target', async () => {
  role='parent';momentExists=true;
  assert.equal((await request('/api/moments/delete',{album:'album',id:'moment',targetId:'target'})).status,200);
  assert.ok(statements.includes('UPDATE files SET moment_id=$1 WHERE moment_id=$2'));
  assert.ok(!statements.some(s=>s.startsWith('DELETE FROM files')));
  assert.equal(statements.at(-1),'COMMIT');
  assert.equal((await request('/api/moments/delete',{album:'album',id:'moment',targetId:'moment'})).status,400);
  assert.ok(!statements.some(s=>s.startsWith('DELETE')));
});
