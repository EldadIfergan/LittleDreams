import { checklist, milestoneKey } from '../lib/checklist.js';
import { birthTime } from '../lib/birth-time.js';
import pg from 'pg';
import { planEdit } from '../lib/event-edit.js';
import { photoDetails, requestFiles, reviewDecision, approvalCapacity } from '../lib/photo-requests.js';
import { ensurePhotoSchema } from '../lib/photo-schema.js';
import { validateAvatar } from '../lib/avatar.js';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

let pool, storage;
const id = () => randomBytes(24).toString('hex');
const hash = s => createHash('sha256').update(s).digest('hex');
const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
const text = (v,max) => { if(typeof v !== 'string' || !v.trim() || v.trim().length>max) fail(400,'יש למלא את השדות בצורה תקינה'); return v.trim(); };
const types = ['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf'];
function profile(b) {
  const date = b.birthDate;
  if(typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || date>new Date().toISOString().slice(0,10) || date<'1900-01-01') fail(400,'תאריך הלידה אינו תקין');
  const number = (v,max) => { if(v==null || v==='') return null; const n=Number(v); if(!Number.isFinite(n)||n<=0||n>max) fail(400,'מידות הלידה אינן תקינות'); return n; };
  const sex=b.sex || 'unspecified'; if(!['boy','girl','unspecified'].includes(sex)) fail(400,'יש לבחור מין ילד תקין');
  return [text(b.childName,80),date,number(b.birthWeight,15000),number(b.birthLength,100),sex];
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  let client;
  try {
    if(!process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) fail(503,'החיבור לאחסון עדיין לא הושלם');
    pool ||= new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
    storage ||= createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}).storage.from('little-dreams');
    const url=new URL(req.url,'https://localhost'); const path=url.pathname;
    const write=req.method==='POST';
    if(!['GET','POST'].includes(req.method)) fail(405,'הפעולה אינה נתמכת');
    if(write && req.headers.origin !== `https://${req.headers.host}` && !(process.env.NODE_ENV!=='production' && req.headers.origin===`http://${req.headers.host}`)) fail(403,'מקור הבקשה אינו מורשה');
    if(write && !req.headers['content-type']?.startsWith('application/json')) fail(415,'נדרשת בקשת JSON');
    const b=write ? req.body : {};
    if(write && (!b || typeof b!=='object' || Array.isArray(b) || Buffer.byteLength(JSON.stringify(b))>65536)) fail(400,'הבקשה אינה תקינה או גדולה מדי');
    await ensurePhotoSchema(pool);
    client=await pool.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO little_dreams, pg_catalog');
    const query=async(sql,values=[]) => (await client.query(sql,values)).rows;
    const one=async(sql,values=[]) => (await query(sql,values))[0];
    const finish=async(status,result)=>{await client.query('COMMIT');send(status,result);};
    if(path==='/api/config' && !write) return await finish(200,{directUploads:true});
    if(path==='/api/health' && !write) {await query('SELECT id FROM albums LIMIT 1');return await finish(200,{ok:true});}
    async function member(user,album,parent=false) {
      const m=await one('SELECT role FROM members WHERE user_id=$1 AND album_id=$2',[user,album]);
      if(!m || (parent && m.role!=='parent')) fail(403,'אין הרשאה לפעולה באלבום הזה');
      return m;
    }
    async function accept(user,token) {
      const invite=await one('SELECT * FROM invites WHERE token=$1 AND used=0 AND expires>$2 FOR UPDATE',[hash(text(token,100)),Date.now()]);
      if(!invite) fail(400,'ההזמנה אינה תקפה או שכבר נוצלה');
      await query('SELECT id FROM albums WHERE id=$1 FOR UPDATE',[invite.album_id]);
      if(invite.role==='parent' && Number((await one("SELECT count(*) AS n FROM members WHERE album_id=$1 AND role='parent'",[invite.album_id])).n)>=2) fail(400,'לאלבום כבר משויכים שני הורים');
      if(await one('SELECT 1 FROM members WHERE user_id=$1 AND album_id=$2',[user,invite.album_id])) fail(400,'כבר יש לך גישה לאלבום');
      await query('INSERT INTO members VALUES($1,$2,$3)',[user,invite.album_id,invite.role]);await query('UPDATE invites SET used=1 WHERE token=$1',[invite.token]);
    }
    async function createAlbum(user,b) {
      const album=id();await query('INSERT INTO albums(id,name,child_name,birth_date,birth_weight,birth_length,sex,avatar,birth_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[album,text(b.childName,80),...profile(b),b.avatar===undefined?null:validateAvatar(b.avatar),birthTime(b.birthTime)]);
      await query('INSERT INTO members VALUES($1,$2,$3)',[user,album,'parent']);return album;
    }
    if(write && ['/api/login','/api/register'].includes(path)) {
      const email=text(b.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'כתובת הדוא״ל אינה תקינה');
      if(typeof b.password!=='string'||b.password.length<10||b.password.length>128) fail(400,'הסיסמה צריכה להכיל בין 10 ל־128 תווים');
      const now=Date.now();
      const attempt=await one(`INSERT INTO login_attempts VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.expires<$3 THEN 1 ELSE login_attempts.count+1 END, expires=CASE WHEN login_attempts.expires<$3 THEN $2 ELSE login_attempts.expires END RETURNING count`,[hash(email),now+900000,now]);
      // Persist attempts even when authentication fails.
      await client.query('COMMIT');await client.query('BEGIN');await client.query('SET LOCAL search_path TO little_dreams, pg_catalog');
      if(attempt.count>15) fail(429,'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה');
      let user=await one('SELECT * FROM users WHERE email=$1',[email]);
      if(path==='/api/register') {
        if(user) fail(409,'לא ניתן ליצור חשבון עם הכתובת הזאת. נסו להתחבר');
        const salt=id();user={id:id()};await query('INSERT INTO users VALUES($1,$2,$3,$4)',[user.id,email,text(b.name,80),`${salt}:${scryptSync(b.password,salt,64).toString('hex')}`]);
        if(b.invite) await accept(user.id,b.invite);else await createAlbum(user.id,b);
      } else {
        const [salt,digest]=(user?.password || `${'0'.repeat(48)}:${'0'.repeat(128)}`).split(':');
        if(!timingSafeEqual(Buffer.from(digest,'hex'),scryptSync(b.password,salt,64))||!user) fail(401,'הדוא״ל או הסיסמה אינם נכונים');
      }
      const token=id();await query('INSERT INTO sessions VALUES($1,$2,$3)',[hash(token),user.id,Date.now()+604800000]);
      res.setHeader('Set-Cookie',`session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
      return await finish(200,{ok:true});
    }
    const token=/(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1]||'';
    const session=await one('SELECT user_id FROM sessions WHERE token=$1 AND expires>$2',[hash(token),Date.now()]);if(!session) fail(401,'יש להתחבר כדי לצפות באלבום');
    const user=session.user_id;
    if(path==='/api/me'&&!write) return await finish(200,{user:await one('SELECT name,email FROM users WHERE id=$1',[user]),albums:(await query('SELECT a.*,m.role FROM albums a JOIN members m ON a.id=m.album_id WHERE m.user_id=$1 ORDER BY a.child_name,a.name',[user])).map(a=>({...a,name:a.child_name || a.name}))});
    if(path==='/api/logout'&&write) {await query('DELETE FROM sessions WHERE token=$1',[hash(token)]);res.setHeader('Set-Cookie','session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return await finish(200,{ok:true});}
    if(path==='/api/albums'&&write) return await finish(201,{id:await createAlbum(user,b)});
    if(path==='/api/profile'&&write) {await member(user,b.album,true);await query('UPDATE albums SET child_name=$1,birth_date=$2,birth_weight=$3,birth_length=$4,sex=$5,name=COALESCE($7,name),avatar=COALESCE($8,avatar),birth_time=CASE WHEN $9 THEN $10 ELSE birth_time END WHERE id=$6',[...profile(b),b.album,text(b.childName,80),b.avatar===undefined?null:validateAvatar(b.avatar),b.birthTime!==undefined,birthTime(b.birthTime)]);return await finish(200,{ok:true});}
    if(path==='/api/accept'&&write) {await accept(user,b.token);return await finish(200,{ok:true});}
    if(path==='/api/invites'&&write) {
      await member(user,b.album,true);if(!['parent','viewer'].includes(b.role)) fail(400,'תפקיד לא תקין');
      const token=id();await query('INSERT INTO invites(token,album_id,role,expires) VALUES($1,$2,$3,$4)',[hash(token),b.album,b.role,Date.now()+172800000]);return await finish(201,{token});
    }
    if(path==='/api/comments'&&write) {
      const moment=await one('SELECT album_id FROM moments WHERE id=$1',[text(b.moment,80)]);if(!moment) fail(404,'הרגע לא נמצא');await member(user,moment.album_id);
      const comment={id:id(),body:text(b.body,2000),created:Date.now(),author:(await one('SELECT name FROM users WHERE id=$1',[user])).name};await query('INSERT INTO comments VALUES($1,$2,$3,$4,$5)',[comment.id,b.moment,user,comment.body,comment.created]);return await finish(201,comment);
    }
    if(path==='/api/checklist') {
      const album=write?b.album:url.searchParams.get('album');await member(user,album,write);
      if(write) {
        milestoneKey(b.key);if(typeof b.completed!=='boolean') fail(400,'סימון לא תקין');
        await query('INSERT INTO checklist(album_id,key,completed) VALUES($1,$2,$3) ON CONFLICT(album_id,key) DO UPDATE SET completed=excluded.completed',[album,b.key,Number(b.completed)]);
      }
      return await finish(200,checklist(await query('SELECT * FROM checklist WHERE album_id=$1',[album]),(await one('SELECT sex FROM albums WHERE id=$1',[album])).sex));
    }
    if(path==='/api/moments'&&!write) {
      const album=url.searchParams.get('album');await member(user,album);
      const moments=await query('SELECT * FROM moments WHERE album_id=$1 ORDER BY date ASC,created ASC,id ASC',[album]);
      for(const m of moments) {m.created=Number(m.created);m.files=await query('SELECT id,name,type FROM files WHERE moment_id=$1',[m.id]);m.comments=(await query('SELECT c.id,c.body,c.created,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE moment_id=$1 ORDER BY c.created,c.id',[m.id])).map(c=>({...c,created:Number(c.created)}));}
      return await finish(200,moments);
    }
    if(path==='/api/photo-requests'&&!write) {
      const album=url.searchParams.get('album'),m=await member(user,album);
      const requests=await query(`SELECT r.*,u.name AS author,m.title AS moment_title FROM photo_requests r JOIN moments m ON m.id=r.moment_id JOIN users u ON u.id=r.user_id WHERE m.album_id=$1 AND ${m.role==='parent'?"r.status='pending'":'r.user_id=$2'} ORDER BY r.created,r.id`,m.role==='parent'?[album]:[album,user]);
      return await finish(200,requests.map(r=>({...r,size:Number(r.size),created:Number(r.created)})));
    }
    if(path==='/api/photo-requests/uploads'&&write) {
      const moment=await one('SELECT id,album_id FROM moments WHERE id=$1 FOR UPDATE',[text(b.moment,80)]);
      if(!moment)fail(404,'הרגע לא נמצא');await member(user,moment.album_id);
      const file=photoDetails(b);
      const count=await one("SELECT count(*) AS n FROM photo_requests WHERE moment_id=$1 AND user_id=$2 AND status='pending'",[moment.id,user]);
      if(Number(count.n)>=10)fail(400,'כבר שלחתם 10 תמונות לרגע הזה. המתינו לאישור ההורים');
      const reserved=await one('SELECT count(*) AS n FROM photo_request_uploads WHERE moment_id=$1 AND user_id=$2 AND expires>$3',[moment.id,user,Date.now()]);
      if(Number(reserved.n)>=20)fail(429,'יש יותר מדי העלאות ממתינות. נסו שוב בעוד שעתיים');
      const fileId=id();
      await query('INSERT INTO photo_request_uploads VALUES($1,$2,$3,$4,$5,$6,$7)',[fileId,moment.id,user,file.name,file.type,file.size,Date.now()+7200000]);
      const signed=await storage.createSignedUploadUrl(fileId);if(signed.error)throw signed.error;
      return await finish(201,{id:fileId,url:signed.data.signedUrl});
    }
    if(path==='/api/photo-requests'&&write) {
      requestFiles(b.files);
      if(b.files.some(f=>typeof f.id!=='string') || new Set(b.files.map(f=>f.id)).size!==b.files.length)fail(400,'רשימת התמונות אינה תקינה');
      const moment=await one('SELECT id,album_id FROM moments WHERE id=$1 FOR UPDATE',[text(b.moment,80)]);
      if(!moment)fail(404,'הרגע לא נמצא');await member(user,moment.album_id);
      const existing=await query('SELECT id FROM photo_requests WHERE moment_id=$1 AND user_id=$2 AND id=ANY($3::text[])',[moment.id,user,b.files.map(f=>f.id)]);
      if(existing.length===b.files.length)return await finish(200,{ok:true});
      const count=await one("SELECT count(*) AS n FROM photo_requests WHERE moment_id=$1 AND user_id=$2 AND status='pending'",[moment.id,user]);
      if(Number(count.n)+b.files.length>10)fail(400,'אפשר לשלוח עד 10 תמונות שממתינות לאישור לכל רגע');
      for(const file of b.files) {
        const pending=await one('SELECT * FROM photo_request_uploads WHERE id=$1 AND moment_id=$2 AND user_id=$3 AND expires>$4 FOR UPDATE',[text(file.id,80),moment.id,user,Date.now()]);
        if(!pending)fail(400,'העלאת התמונה אינה תקפה. בחרו אותה שוב');
        const info=await storage.info(pending.id);
        if(info.error || Number(info.data.size)!==Number(pending.size) || info.data.contentType!==pending.type)fail(400,'התמונה לא הועלתה במלואה או שסוגה אינו תואם');
        await query("INSERT INTO photo_requests VALUES($1,$2,$3,$4,$5,$6,$7,'pending')",[pending.id,moment.id,user,pending.name,pending.type,pending.size,Date.now()]);
        await query('DELETE FROM photo_request_uploads WHERE id=$1',[pending.id]);
      }
      return await finish(201,{ok:true});
    }
    if(path==='/api/photo-requests/review'&&write) {
      reviewDecision(b.decision);
      const found=await one('SELECT moment_id FROM photo_requests WHERE id=$1',[text(b.id,80)]);if(!found)fail(404,'הבקשה לא נמצאה');
      // Use the event lock first, matching edits, deletion and request submission.
      const moment=await one('SELECT id,album_id FROM moments WHERE id=$1 FOR UPDATE',[found.moment_id]);
      if(!moment)fail(404,'הרגע לא נמצא');await member(user,moment.album_id,true);
      const request=await one('SELECT * FROM photo_requests WHERE id=$1 FOR UPDATE',[b.id]);
      if(!request)fail(404,'הבקשה לא נמצאה');
      if(request.status===b.decision)return await finish(200,{ok:true});
      if(request.status!=='pending')fail(409,'הבקשה כבר טופלה. רעננו את האלבום');
      if(b.decision==='approved') {
        const files=await query('SELECT id FROM files WHERE moment_id=$1',[moment.id]);
        approvalCapacity(files.length+1,0);
        const sizes=await Promise.all([...files,request].map(async f=>{const info=await storage.info(f.id);if(info.error)throw info.error;return Number(info.data.size);}));
        approvalCapacity(files.length+1,sizes.reduce((sum,size)=>sum+size,0));
        await query('INSERT INTO files VALUES($1,$2,$3,$4)',[request.id,moment.id,request.name,request.type]);
      }
      await query('UPDATE photo_requests SET status=$1 WHERE id=$2',[b.decision,request.id]);
      await client.query('COMMIT');
      if(b.decision==='rejected') {try {const cleanup=await storage.remove([request.id]);if(cleanup.error)console.error('Rejected photo cleanup failed');}catch{console.error('Rejected photo cleanup failed');}}
      return send(200,{ok:true});
    }
    if(path.startsWith('/api/photo-requests/files/')&&!write) {
      const request=await one("SELECT r.*,m.album_id FROM photo_requests r JOIN moments m ON m.id=r.moment_id WHERE r.id=$1 AND r.status='pending'",[path.split('/').pop()]);
      if(!request)fail(404,'התמונה לא נמצאה');const m=await member(user,request.album_id);
      if(m.role!=='parent' && request.user_id!==user)fail(403,'אין הרשאה לצפות בתמונה הזאת');
      const result=await storage.createSignedUrl(request.id,300);if(result.error)throw result.error;
      await client.query('COMMIT');res.statusCode=302;res.setHeader('Location',result.data.signedUrl);res.end();return;
    }
    if(path==='/api/uploads'&&write) {
      await member(user,b.album,true);
      if(!types.includes(b.type)||!Number.isInteger(b.size)||b.size<=0||b.size>52428800) fail(400,'סוג הקובץ או גודלו אינם נתמכים');
      const name=text(b.name,200),file=id();
      await query('INSERT INTO pending_uploads VALUES($1,$2,$3,$4,$5,$6,$7)',[file,b.album,user,name,b.type,b.size,Date.now()+7200000]);
      const signed=await storage.createSignedUploadUrl(file);if(signed.error) throw signed.error;
      return await finish(201,{id:file,url:signed.data.signedUrl});
    }
    if(path==='/api/moments/delete'&&write) {
      await member(user,b.album,true);
      const moment=text(b.id,80);
      const target=b.targetId===undefined?null:text(b.targetId,80);
      if(target===moment)fail(400,'יש לבחור אירוע אחר');
      // Lock both events in stable order to serialize transfers and concurrent edits.
      if(target)await query('SELECT id FROM moments WHERE id IN ($1,$2) ORDER BY id FOR UPDATE',[moment,target]);
      const existing=await one('SELECT id FROM moments WHERE id=$1 AND album_id=$2 FOR UPDATE',[moment,b.album]);
      if(!existing) fail(404,'האירוע לא נמצא באלבום');
      const files=await query('SELECT id FROM files WHERE moment_id=$1',[moment]);
      const requested=await query("SELECT id FROM photo_requests WHERE moment_id=$1 AND status='pending' UNION SELECT id FROM photo_request_uploads WHERE moment_id=$1",[moment]);
      if(target) {
        if(!await one('SELECT id FROM moments WHERE id=$1 AND album_id=$2 FOR UPDATE',[target,b.album]))fail(404,'אירוע היעד לא נמצא באלבום');
        const combined=[...files,...await query('SELECT id FROM files WHERE moment_id=$1',[target])];
        if(combined.length>10)fail(400,'ההעברה תחרוג ממגבלת 10 קבצים באירוע. בחרו אירוע אחר');
        const sizes=await Promise.all(combined.map(async f=>{const info=await storage.info(f.id);if(info.error)throw info.error;return Number(info.data.size);}));
        const total=sizes.reduce((sum,size)=>sum+size,0);
        if(!Number.isFinite(total)||total>104857600)fail(400,'ההעברה תחרוג ממגבלת 100MB באירוע. בחרו אירוע אחר');
      }
      await query('UPDATE checklist SET moment_id=NULL WHERE moment_id=$1',[moment]);
      await query('DELETE FROM comments WHERE moment_id=$1',[moment]);
      if(target)await query('UPDATE files SET moment_id=$1 WHERE moment_id=$2',[target,moment]);
      else await query('DELETE FROM files WHERE moment_id=$1',[moment]);
      await query('DELETE FROM moments WHERE id=$1 AND album_id=$2',[moment,b.album]);
      await client.query('COMMIT');
      const discarded=[...requested,...(target?[]:files)];
      if(discarded.length) {try {const cleanup=await storage.remove(discarded.map(f=>f.id));if(cleanup.error)console.error('Deleted event file cleanup failed');} catch {console.error('Deleted event file cleanup failed');}}
      return send(200,{ok:true});
    }
    if(path==='/api/moments'&&write) {
      await member(user,b.album,true);const title=text(b.title,120);
      if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date))||new Date(b.date).toISOString().slice(0,10)!==b.date) fail(400,'תאריך האירוע אינו תקין');
      if(typeof b.description!=='string'||b.description.length>5000||!Array.isArray(b.files)||b.files.length>10||b.files.some(f=>!f||typeof f.id!=='string')||new Set(b.files.map(f=>f.id)).size!==b.files.length) fail(400,'פרטי הרגע אינם תקינים');
      const moment=b.id ? text(b.id,80) : id();const files=[];let total=0;
      if(b.milestoneKey!==undefined) {
        milestoneKey(b.milestoneKey);if(b.id) fail(400,'אפשר לקשר אבן דרך רק לאירוע חדש');
        await query('INSERT INTO checklist(album_id,key,completed) VALUES($1,$2,1) ON CONFLICT(album_id,key) DO NOTHING',[b.album,b.milestoneKey]);
        const item=await one('SELECT * FROM checklist WHERE album_id=$1 AND key=$2 FOR UPDATE',[b.album,b.milestoneKey]);
        if(item.moment_id) fail(409,'לאבן הדרך כבר יש אירוע. רעננו את האלבום כדי לצפות בו');
      }
      let edit;
      if (b.id) {
        const existing=await one('SELECT * FROM moments WHERE id=$1 FOR UPDATE',[moment]);
        const existingFiles=await query('SELECT id,name,type FROM files WHERE moment_id=$1',[moment]);
        edit=planEdit(b,existing,existingFiles);
        if(edit.kept.length+b.files.length>10) fail(400,'אפשר לשמור עד 10 קבצים באירוע');
        const sizes=await Promise.all(edit.kept.map(async f=>{const result=await storage.info(f.id);if(result.error) throw result.error;return Number(result.data.size);}));
        total=sizes.reduce((sum,size)=>sum+size,0);
        if(!Number.isFinite(total)||total>104857600) fail(400,'אפשר לצרף עד 100MB לרגע');
      }
      for(const f of b.files) {
        const pending=await one('SELECT * FROM pending_uploads WHERE id=$1 AND user_id=$2 AND album_id=$3 AND expires>$4 FOR UPDATE',[text(f.id,80),user,b.album,Date.now()]);
        if(!pending) fail(400,'העלאת הקובץ אינה תקפה');
        const info=await storage.info(pending.id);if(info.error||Number(info.data.size)!==Number(pending.size)||info.data.contentType!==pending.type) fail(400,'הקובץ לא הועלה במלואו או שסוגו אינו תואם');
        total+=Number(pending.size);if(total>104857600) fail(400,'אפשר לצרף עד 100MB לרגע');files.push(pending);
      }
      if(edit) {
        await query('UPDATE moments SET title=$1,date=$2,description=$3 WHERE id=$4',[title,b.date,b.description.trim(),moment]);
        for(const f of edit.removed) await query('DELETE FROM files WHERE id=$1 AND moment_id=$2',[f.id,moment]);
      } else await query('INSERT INTO moments VALUES($1,$2,$3,$4,$5,$6)',[moment,b.album,title,b.date,b.description.trim(),Date.now()]);
      if(b.milestoneKey!==undefined) await query('UPDATE checklist SET completed=1,moment_id=$1 WHERE album_id=$2 AND key=$3',[moment,b.album,b.milestoneKey]);
      for(const f of files){await query('INSERT INTO files VALUES($1,$2,$3,$4)',[f.id,moment,f.name,f.type]);await query('DELETE FROM pending_uploads WHERE id=$1',[f.id]);}
      await client.query('COMMIT');
      // Remove objects only after the event update has committed. Never delete retained files.
      if(edit?.removed.length) {try {const cleanup=await storage.remove(edit.removed.map(f=>f.id));if(cleanup.error) console.error('Detached file cleanup failed');} catch {console.error('Detached file cleanup failed');}}
      return send(edit?200:201,{id:moment});
    }
    if(path.startsWith('/api/files/')&&!write) {
      const f=await one('SELECT f.*,m.album_id FROM files f JOIN moments m ON m.id=f.moment_id WHERE f.id=$1',[path.split('/').pop()]);if(!f) fail(404,'הקובץ לא נמצא');await member(user,f.album_id);
      const result=await storage.createSignedUrl(f.id,300,f.type==='application/pdf'?{download:f.name}:{});if(result.error) throw result.error;
      await client.query('COMMIT');res.statusCode=302;res.setHeader('Location',result.data.signedUrl);res.end();return;
    }
    fail(404,'העמוד לא נמצא');
  } catch(e) {
    if(client) await client.query('ROLLBACK').catch(()=>{});
    if(!e.status) console.error('Cloud request failed',e.code||e.name);
    send(e.status||500,{error:e.status?e.message:'משהו השתבש. נסו שוב.'});
  } finally {client?.release();}
}
