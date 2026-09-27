import {readFileSync} from 'node:fs';

// Additive, transaction-protected migration. Existing deployments can roll back
// safely because their tables and columns are left unchanged.
let ready;
export function ensurePhotoSchema(pool) {
  ready ||= (async()=>{
    const client=await pool.connect();
    try {
      const result=await client.query("SELECT to_regclass('little_dreams.photo_requests') AS requests, to_regclass('little_dreams.photo_request_uploads') AS uploads");
      if(result.rows[0]?.requests && result.rows[0]?.uploads)return;
      const sql=readFileSync(new URL('../supabase/006-photo-requests.sql',import.meta.url),'utf8');
      await client.query(sql);
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally {client.release();}
  })().catch(error=>{ready=undefined;throw error;});
  return ready;
}
