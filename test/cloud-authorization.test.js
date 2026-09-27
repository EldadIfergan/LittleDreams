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
let signedIn = true, role = 'viewer', statements = [];
pg.Pool.prototype.connect = async () => ({
  async query(sql) {
    statements.push(sql);
    if (sql.startsWith('SELECT user_id FROM sessions')) return {rows:signedIn ? [{user_id:'user'}] : []};
    if (sql.startsWith('SELECT role FROM members')) return {rows:role ? [{role}] : []};
    if (sql.startsWith('SELECT album_id FROM moments')) return {rows:[{album_id:'album'}]};
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
  for(const path of ['/api/uploads','/api/moments']) {
    assert.equal((await request(path,{album:'album'})).status,403);
    assert.ok(!statements.some(s=>s.startsWith('INSERT')));
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
