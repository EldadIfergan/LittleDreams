import {test} from 'node:test';
import assert from 'node:assert/strict';

test('photo schema setup is shared by concurrent requests and retries a failed migration',async()=>{
  const {ensurePhotoSchema}=await import('../lib/photo-schema.js');
  let connects=0,released=0,failMigration=true;
  const statements=[];
  const pool={async connect(){connects++;return {
    async query(sql){
      statements.push(sql);
      if(sql.startsWith('SELECT to_regclass'))return {rows:[{requests:null,uploads:null}]};
      if(sql.startsWith('begin;')){
        assert.match(sql,/pg_advisory_xact_lock/);
        assert.match(sql,/revoke all on little_dreams.photo_requests,little_dreams.photo_request_uploads/);
        if(failMigration)throw new Error('Transient migration error');
      }
      return {rows:[]};
    },release(){released++;}
  };}};
  const first=await Promise.allSettled([ensurePhotoSchema(pool),ensurePhotoSchema(pool)]);
  assert.ok(first.every(r=>r.status==='rejected'));assert.equal(connects,1);assert.equal(released,1);assert.ok(statements.includes('ROLLBACK'));
  failMigration=false;
  await Promise.all([ensurePhotoSchema(pool),ensurePhotoSchema(pool)]);
  assert.equal(connects,2);assert.equal(released,2);
  await ensurePhotoSchema(pool);assert.equal(connects,2);
});
