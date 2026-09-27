import {readFileSync} from 'node:fs';
let ready;
export function ensureFamilySchema(pool) {
  ready ||= (async()=>{
    const client=await pool.connect();
    try {
      const result=await client.query("SELECT to_regclass('little_dreams.family_profiles') AS family");
      if(result.rows[0]?.family)return;
      await client.query(readFileSync(new URL('../supabase/007-family-join.sql',import.meta.url),'utf8'));
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally {client.release();}
  })().catch(error=>{ready=undefined;throw error;});
  return ready;
}
