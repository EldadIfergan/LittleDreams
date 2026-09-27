import {test} from 'node:test';
import assert from 'node:assert/strict';
import {familyDetails,familyAuthor,inviteToken} from '../lib/family.js';

test('family details require only a name, phone and supported relationship',()=>{
  const details={name:' דורית ',phone:'050-1234567',relationship:'grandmother'};
  assert.deepEqual(familyDetails(details),{name:'דורית',phone:'+972501234567',relationship:'grandmother'});
  assert.equal(familyDetails({...details,phone:'00972 (50) 123-4567'}).phone,'+972501234567');
  for(const invalid of [null,[],{}, {...details,name:' '},{...details,phone:'123'},{...details,relationship:'parent'},{...details,relationship:'toString'},{...details,relationship:['aunt']}])assert.throws(()=>familyDetails(invalid),{status:400});
  assert.throws(()=>inviteToken('bad'),{status:400});
});
test('authors use the album relationship, with backwards compatible plain names',()=>{
  assert.equal(familyAuthor('דורית','grandmother'),'סבתא דורית');
  assert.equal(familyAuthor('לירז','aunt'),'דודה לירז');
  assert.equal(familyAuthor('סבתא דורית','grandmother'),'סבתא דורית');
  assert.equal(familyAuthor('דני','other'),'דני');
  assert.equal(familyAuthor('דני',undefined),'דני');
});
test('family schema setup shares concurrent requests and retries a failed migration',async()=>{
  const {ensureFamilySchema}=await import('../lib/family-schema.js');
  let connects=0,released=0,failMigration=true;
  const statements=[];
  const pool={async connect(){connects++;return {
    async query(sql){
      statements.push(sql);
      if(sql.startsWith('SELECT to_regclass'))return {rows:[{family:null}]};
      if(sql.startsWith('begin;')){
        assert.match(sql,/pg_advisory_xact_lock/);
        assert.match(sql,/revoke all on little_dreams.family_profiles/);
        if(failMigration)throw new Error('Transient migration error');
      }
      return {rows:[]};
    },release(){released++;}
  };}};
  const first=await Promise.allSettled([ensureFamilySchema(pool),ensureFamilySchema(pool)]);
  assert.ok(first.every(r=>r.status==='rejected'));assert.equal(connects,1);assert.equal(released,1);assert.ok(statements.includes('ROLLBACK'));
  failMigration=false;
  await Promise.all([ensureFamilySchema(pool),ensureFamilySchema(pool)]);
  assert.equal(connects,2);assert.equal(released,2);
  await ensureFamilySchema(pool);assert.equal(connects,2);
});
