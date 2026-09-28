import { visibility, canView } from './lib/visibility.js';
import { checklist, milestoneKey } from './lib/checklist.js';
import { planEdit } from './lib/event-edit.js';
import { photoDetails, requestFiles, reviewDecision, approvalCapacity } from './lib/photo-requests.js';
import { birthTime } from './lib/birth-time.js';
import {familyDetails,familyAuthor,familySessionSeconds,inviteToken} from './lib/family.js';
import http from 'node:http';
import { validateAvatar } from './lib/avatar.js';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname);
const data = resolve(process.env.DATA_DIR || join(root, 'data'));
mkdirSync(join(data, 'uploads'), { recursive: true });
const db = new DatabaseSync(join(data, 'album.sqlite'));
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, password TEXT);
CREATE TABLE IF NOT EXISTS albums(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS members(user_id TEXT REFERENCES users(id), album_id TEXT REFERENCES albums(id), role TEXT, PRIMARY KEY(user_id,album_id));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,album_id TEXT REFERENCES albums(id),role TEXT,expires INTEGER,used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS family_profiles(user_id TEXT NOT NULL,album_id TEXT NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,relationship TEXT NOT NULL,PRIMARY KEY(user_id,album_id),FOREIGN KEY(user_id,album_id) REFERENCES members(user_id,album_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS moments(id TEXT PRIMARY KEY,album_id TEXT REFERENCES albums(id),title TEXT,date TEXT,description TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS checklist(album_id TEXT NOT NULL REFERENCES albums(id),key TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),moment_id TEXT REFERENCES moments(id),PRIMARY KEY(album_id,key));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,moment_id TEXT REFERENCES moments(id),name TEXT,type TEXT);
CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,moment_id TEXT NOT NULL REFERENCES moments(id),user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS comments_moment ON comments(moment_id,created);
CREATE TABLE IF NOT EXISTS photo_requests(id TEXT PRIMARY KEY,moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')));
CREATE INDEX IF NOT EXISTS photo_requests_moment ON photo_requests(moment_id,status,user_id);
`);
const id = () => randomBytes(24).toString('hex');
let backingUp = false;
async function backupDatabase() {
  if (backingUp) return;
  backingUp = true;
  try {
    const directory = join(data,'backups'); mkdirSync(directory,{recursive:true});
    const name = `album-${new Date().toISOString().replaceAll(':','-')}.sqlite`;
    await backup(db,join(directory,name));
    const copies = readdirSync(directory).filter(n=>/^album-[\dT.Z-]+\.sqlite$/.test(n)).sort();
    for (const old of copies.slice(0,-14)) unlinkSync(join(directory,old));
    console.log('Database backup completed');
  } catch(e) { console.error('Database backup failed:',e.message); }
  finally { backingUp = false; }
}
for (const [column,type] of [['child_name','TEXT'],['birth_date','TEXT'],['birth_weight','REAL'],['birth_length','REAL'],['sex','TEXT'],['avatar','TEXT'],['birth_time','TEXT']]) {
  if (!db.prepare('PRAGMA table_info(albums)').all().some(c => c.name === column)) db.exec(`ALTER TABLE albums ADD COLUMN ${column} ${type}`);
}
function childProfile(b) {
  const name = text(b.childName,80,'שם הילד או הילדה');
  const date = b.birthDate;
  const now = new Date(); const today = new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date > today || date < '1900-01-01') fail(400,'יש להזין תאריך לידה תקין שאינו בעתיד');
  const measurement = (v,max,label) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); if (!Number.isFinite(n) || n <= 0 || n > max) fail(400,`יש לבדוק את ${label}`); return n; };
  const sex = b.sex || 'unspecified';
  if (!['boy','girl','unspecified'].includes(sex)) fail(400,'יש לבחור אפשרות תקינה בשדה מין הילד');
  return [name,date,measurement(b.birthWeight,15000,'משקל הלידה בגרמים'),measurement(b.birthLength,100,'האורך בלידה בס״מ'),sex];
}
const hash = value => createHash('sha256').update(value).digest('hex');
const passwordHash = (value, salt = id()) => `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf']);
const failures = new Map();
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `יש לבדוק את ${label}`);
  return value.trim();
}
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 140 * 1024 * 1024) fail(413,'הקבצים גדולים מדי. אפשר לצרף עד 100MB לרגע.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400,'הבקשה אינה תקינה'); }
}
function send(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(value));
}
if(!db.prepare('PRAGMA table_info(moments)').all().some(c=>c.name==='visibility')) db.exec("ALTER TABLE moments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'family' CHECK(visibility IN ('family','parents'))");
function membership(user, album) {
  const member = db.prepare('SELECT * FROM members WHERE user_id=? AND album_id=?').get(user,album);
  if (!member) fail(403,'אין גישה לאלבום הזה'); return member;
}
function editor(user, album) { const member = membership(user,album); if (member.role !== 'parent') fail(403,'רק הורים יכולים לערוך את האלבום'); }
function inviteRecord(token) {
  const invite = db.prepare('SELECT * FROM invites WHERE token=? AND used=0 AND expires>?').get(hash(token || ''),Date.now());
  if (!invite) fail(400,'ההזמנה אינה תקפה או שכבר נעשה בה שימוש');
  if (invite.role === 'parent' && db.prepare("SELECT count(*) AS n FROM members WHERE album_id=? AND role='parent'").get(invite.album_id).n >= 2) fail(400,'לאלבום כבר משויכים שני הורים');
  return invite;
}
function accept(user, token) {
  const invite = inviteRecord(token);
  if(invite.role==='parent'&&!db.prepare('SELECT password FROM users WHERE id=?').get(user)?.password)fail(403,'להצטרפות כהורה יש להיכנס לחשבון הורה עם דוא״ל וסיסמה.');
  if (db.prepare('SELECT 1 FROM members WHERE user_id=? AND album_id=?').get(user,invite.album_id)) fail(400,'כבר יש לך גישה לאלבום');
  db.prepare('INSERT INTO members VALUES(?,?,?)').run(user,invite.album_id,invite.role);
  db.prepare('UPDATE invites SET used=1 WHERE token=?').run(invite.token);
}
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url,'http://localhost'); const path = url.pathname;
    if (path === '/api/config' && req.method === 'GET') return send(res,200,{directUploads:false});
    if (path === '/healthz' && req.method === 'GET') {
      db.prepare('SELECT 1').get(); return send(res,200,{ok:true});
    }
    if (!['GET','HEAD'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) fail(403,'מקור הבקשה אינו מורשה');
      if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'נדרשת בקשת JSON');
    }
    if (req.method === 'GET' && ['/', '/app.js', '/style.css','/favicon.svg','/media.js','/photo-requests.js','/vendor/mediabunny.mjs','/fonts/Heebo.ttf'].includes(path)) {
      const name = path === '/' ? 'index.html' : path.slice(1);
      res.setHeader('Content-Type', {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',ttf:'font/ttf'}[name.split('.').pop()]);
      return res.end(readFileSync(join(root,'public',name)));
    }
    if(path==='/api/invites/info'&&req.method==='GET') {
      const invitation=db.prepare('SELECT i.*,a.child_name,a.name,a.sex FROM invites i JOIN albums a ON a.id=i.album_id WHERE i.token=?').get(hash(inviteToken(url.searchParams.get('token'))));
      if(!invitation)fail(400,'הקישור אינו תקף. בקשו מההורים קישור חדש.');
      const cookie=/(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1]||'';
      const signedIn=db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(hash(cookie),Date.now());
      if(signedIn&&db.prepare('SELECT 1 FROM members WHERE user_id=? AND album_id=?').get(signedIn.user_id,invitation.album_id))return send(res,200,{joined:true,album:invitation.album_id});
      if(invitation.used||invitation.expires<=Date.now())fail(410,'הקישור כבר נוצל או שפג תוקפו. בקשו מההורים קישור חדש.');
      return send(res,200,{role:invitation.role,childName:invitation.child_name||invitation.name,sex:invitation.sex});
    }
    if(path==='/api/family/join'&&req.method==='POST') {
      const b=await body(req),details=familyDetails(b),invitationHash=hash(inviteToken(b.invite));
      const cookie=/(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1]||'';
      const signedIn=db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(hash(cookie),Date.now());
      db.exec('BEGIN');
      let album,newToken,maxAge;
      try {
        const invitation=db.prepare('SELECT * FROM invites WHERE token=?').get(invitationHash);
        if(!invitation||invitation.role!=='viewer')fail(400,'נדרש קישור להזמנת בן או בת משפחה.');
        album=invitation.album_id;
        if(signedIn&&db.prepare('SELECT 1 FROM members WHERE user_id=? AND album_id=?').get(signedIn.user_id,album)) {db.exec('COMMIT');return send(res,200,{ok:true,album});}
        if(invitation.used||invitation.expires<=Date.now())fail(410,'הקישור כבר נוצל או שפג תוקפו. בקשו מההורים קישור חדש.');
        const user=signedIn?.user_id||id();
        if(!signedIn)db.prepare('INSERT INTO users(id,email,name,password) VALUES(?,NULL,?,NULL)').run(user,details.name);
        db.prepare('INSERT INTO members(user_id,album_id,role) VALUES(?,?,?)').run(user,album,'viewer');
        db.prepare('INSERT INTO family_profiles(user_id,album_id,name,phone,relationship) VALUES(?,?,?,?,?)').run(user,album,details.name,details.phone,details.relationship);
        db.prepare('UPDATE invites SET used=1 WHERE token=?').run(invitationHash);
        maxAge=db.prepare('SELECT password FROM users WHERE id=?').get(user).password?604800:familySessionSeconds;
        newToken=id();db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(newToken),user,Date.now()+maxAge*1000);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return send(res,200,{ok:true,album},{'Set-Cookie':`session=${newToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`});
    }
    if (req.method === 'POST' && ['/api/register','/api/login'].includes(path)) {
      const b = await body(req);
      const email = text(b.email,254,'כתובת הדוא״ל').toLowerCase();
      const key = email; const now = Date.now();
      for (const [k,v] of failures) if (v.until <= now) failures.delete(k);
      const limit = failures.get(key); if (limit && limit.until > now && limit.count >= 15) fail(429,'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.');
      failures.set(key,{ count: limit?.until > now ? limit.count + 1 : 1, until: limit?.until > now ? limit.until : now + 900000 });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'כתובת הדוא״ל אינה תקינה');
      if (typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128) fail(400,'הסיסמה צריכה להכיל בין 10 ל־128 תווים');
      let user;
      if (path === '/api/register') {
        const name = text(b.name,80,'השם');
        const profile = b.invite ? null : childProfile(b);
        if (b.invite) inviteRecord(b.invite);
        if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) fail(409,'לא ניתן ליצור חשבון עם הכתובת הזאת. נסו להתחבר.');
        user = {id:id()};
        db.exec('BEGIN');
        try {
          db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id,email,name,passwordHash(b.password));
          if (b.invite) accept(user.id,b.invite);
          else { const album = id(); db.prepare('INSERT INTO albums(id,name,child_name,birth_date,birth_weight,birth_length,sex,birth_time) VALUES(?,?,?,?,?,?,?,?)').run(album,profile[0],...profile,birthTime(b.birthTime)); db.prepare('INSERT INTO members VALUES(?,?,?)').run(user.id,album,'parent'); }
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      } else {
        user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const stored = user?.password || passwordHash('dummy-password');
        const [salt,digest] = stored.split(':');
        if (!timingSafeEqual(Buffer.from(digest,'hex'),scryptSync(b.password,salt,64)) || !user) fail(401,'הדוא״ל או הסיסמה אינם נכונים');
      }
      const token = id(); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),user.id,Date.now()+604800000);
      return send(res,200,{ok:true},{'Set-Cookie':`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`});
    }
    const token = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    const session = db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(hash(token || ''),Date.now());
    if (!session) fail(401,'יש להתחבר כדי לצפות באלבום');
    const user = session.user_id;
    if (path === '/api/albums' && req.method === 'POST') {
      if(!db.prepare('SELECT password FROM users WHERE id=?').get(user)?.password)fail(403,'יצירת אלבום חדש זמינה לחשבון הורה.');
      const b = await body(req); const profile = childProfile(b); const name = profile[0]; const album = id();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO albums(id,name,child_name,birth_date,birth_weight,birth_length,sex,avatar,birth_time) VALUES(?,?,?,?,?,?,?,?,?)').run(album,name,...profile,b.avatar===undefined?null:validateAvatar(b.avatar),birthTime(b.birthTime));
        db.prepare('INSERT INTO members VALUES(?,?,?)').run(user,album,'parent');
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
      return send(res,201,{id:album});
    }
    if (path === '/api/comments' && req.method === 'POST') {
      const b = await body(req);
      const momentId = text(b.moment,80,'הרגע');
      const moment = db.prepare('SELECT album_id,visibility FROM moments WHERE id=?').get(momentId);
      if (!moment) fail(404,'הרגע לא נמצא');
      if(!canView(membership(user,moment.album_id).role,moment))fail(404,'הרגע לא נמצא');
      const comment = {id:id(),body:text(b.body,2000,'התגובה (עד 2,000 תווים)'),created:Date.now()};
      db.prepare('INSERT INTO comments VALUES(?,?,?,?,?)').run(comment.id,momentId,user,comment.body,comment.created);
      comment.author = db.prepare('SELECT name FROM users WHERE id=?').get(user).name;
      const details=db.prepare('SELECT name,relationship FROM family_profiles WHERE user_id=? AND album_id=?').get(user,moment.album_id);
      comment.author=familyAuthor(details?.name||comment.author,details?.relationship);
      return send(res,201,comment);
    }
    if (path === '/api/profile' && req.method === 'POST') {
      const b = await body(req); editor(user,b.album); const profile = childProfile(b);
      db.prepare('UPDATE albums SET child_name=?,birth_date=?,birth_weight=?,birth_length=?,sex=?,name=COALESCE(?,name),avatar=COALESCE(?,avatar),birth_time=CASE WHEN ? THEN ? ELSE birth_time END WHERE id=?').run(...profile,profile[0],b.avatar===undefined?null:validateAvatar(b.avatar),Number(b.birthTime!==undefined),birthTime(b.birthTime),b.album);
      return send(res,200,{ok:true});
    }
    if (path === '/api/me' && req.method === 'GET') return send(res,200,{
      user:db.prepare('SELECT name,email FROM users WHERE id=?').get(user),
      albums:db.prepare('SELECT a.*,m.role FROM albums a JOIN members m ON a.id=m.album_id WHERE m.user_id=?').all(user).map(a=>({...a,name:a.child_name || a.name}))
    });
    if (path === '/api/logout' && req.method === 'POST') { db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); return send(res,200,{ok:true},{'Set-Cookie':'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); }
    if (path === '/api/accept' && req.method === 'POST') { const b = await body(req); accept(user,b.token); return send(res,200,{ok:true}); }
    if (path === '/api/invites' && req.method === 'POST') {
      const b = await body(req); editor(user,b.album);
      if (!['parent','viewer'].includes(b.role)) fail(400,'תפקיד לא תקין');
      if (b.role === 'parent' && db.prepare("SELECT count(*) AS n FROM members WHERE album_id=? AND role='parent'").get(b.album).n >= 2) fail(400,'לאלבום כבר משויכים שני הורים');
      const invite = id(); db.prepare('INSERT INTO invites(token,album_id,role,expires) VALUES(?,?,?,?)').run(hash(invite),b.album,b.role,Date.now()+172800000);
      return send(res,201,{token:invite});
    }
    if (path === '/api/checklist') {
      const b=req.method==='POST'?await body(req):null;
      const album=b?b.album:url.searchParams.get('album');
      if(b) {
        editor(user,album);milestoneKey(b.key);if(typeof b.completed!=='boolean') fail(400,'סימון לא תקין');
        db.prepare('INSERT INTO checklist(album_id,key,completed) VALUES(?,?,?) ON CONFLICT(album_id,key) DO UPDATE SET completed=excluded.completed').run(album,b.key,Number(b.completed));
      } else membership(user,album);
      return send(res,200,checklist(db.prepare("SELECT c.* FROM checklist c LEFT JOIN moments m ON m.id=c.moment_id WHERE c.album_id=? AND (? OR c.moment_id IS NULL OR m.visibility='family')").all(album,Number(membership(user,album).role==='parent')),db.prepare('SELECT sex FROM albums WHERE id=?').get(album).sex));
    }
    if (path === '/api/moments' && req.method === 'GET') {
      const album = url.searchParams.get('album'); membership(user,album);
      const moments = db.prepare("SELECT * FROM moments WHERE album_id=? AND (? OR visibility='family') ORDER BY date ASC,created ASC,id ASC").all(album,Number(membership(user,album).role==='parent'));
      for (const moment of moments) {
        moment.files = db.prepare('SELECT id,name,type FROM files WHERE moment_id=?').all(moment.id);
        moment.comments = db.prepare('SELECT c.id,c.body,c.created,u.name AS author,f.name AS family_name,f.relationship FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN family_profiles f ON f.user_id=c.user_id AND f.album_id=? WHERE c.moment_id=? ORDER BY c.created,c.rowid').all(album,moment.id).map(({family_name,relationship,...comment})=>({...comment,author:familyAuthor(family_name||comment.author,relationship)}));
      }
      return send(res,200,moments);
    }
    if(path==='/api/photo-requests' && req.method==='GET') {
      const album=url.searchParams.get('album'),member=membership(user,album);
      const sql=`SELECT r.*,u.name AS author,m.title AS moment_title FROM photo_requests r JOIN moments m ON m.id=r.moment_id JOIN users u ON u.id=r.user_id WHERE m.album_id=? AND ${member.role==='parent'?"r.status='pending'":"r.user_id=? AND m.visibility='family'"} ORDER BY r.created,r.id`;
      return send(res,200,db.prepare(sql).all(...(member.role==='parent'?[album]:[album,user])));
    }
    if(path==='/api/photo-requests' && req.method==='POST') {
      const b=await body(req);requestFiles(b.files);
      const moment=db.prepare('SELECT id,album_id,visibility FROM moments WHERE id=?').get(text(b.moment,80,'מזהה הרגע'));
      if(!moment)fail(404,'הרגע לא נמצא');if(!canView(membership(user,moment.album_id).role,moment))fail(404,'הרגע לא נמצא');
      const count=db.prepare("SELECT count(*) AS n FROM photo_requests WHERE moment_id=? AND user_id=? AND status='pending'").get(moment.id,user).n;
      if(count+b.files.length>10)fail(400,'אפשר לשלוח עד 10 תמונות שממתינות לאישור לכל רגע');
      const files=b.files.map(f=>{
        if(typeof f.data!=='string')fail(400,'התמונה אינה תקינה');
        const bytes=Buffer.from(f.data,'base64');return {id:id(),...photoDetails({...f,size:bytes.length}),bytes};
      });
      db.exec('BEGIN');
      try {
        for(const f of files) {
          writeFileSync(join(data,'uploads',f.id),f.bytes);
          db.prepare("INSERT INTO photo_requests VALUES(?,?,?,?,?,?,?,'pending')").run(f.id,moment.id,user,f.name,f.type,f.size,Date.now());
        }
        db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');for(const f of files){try{unlinkSync(join(data,'uploads',f.id));}catch{}}throw e;}
      return send(res,201,{ok:true});
    }
    if(path==='/api/photo-requests/review' && req.method==='POST') {
      const b=await body(req);reviewDecision(b.decision);
      const request=db.prepare('SELECT r.*,m.album_id,m.visibility FROM photo_requests r JOIN moments m ON m.id=r.moment_id WHERE r.id=?').get(text(b.id,80,'מזהה הבקשה'));
      if(!request)fail(404,'הבקשה לא נמצאה');editor(user,request.album_id);
      if(request.status===b.decision)return send(res,200,{ok:true});
      if(request.status!=='pending')fail(409,'הבקשה כבר טופלה. רעננו את האלבום');
      if(b.decision==='approved') {
        const files=db.prepare('SELECT id FROM files WHERE moment_id=?').all(request.moment_id);
        approvalCapacity(files.length+1,0);
        approvalCapacity(files.length+1,[...files,request].reduce((sum,f)=>sum+statSync(join(data,'uploads',f.id)).size,0));
      }
      db.exec('BEGIN');
      try {
        if(b.decision==='approved')db.prepare('INSERT INTO files VALUES(?,?,?,?)').run(request.id,request.moment_id,request.name,request.type);
        db.prepare('UPDATE photo_requests SET status=? WHERE id=?').run(b.decision,request.id);
        db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      if(b.decision==='rejected'){try{unlinkSync(join(data,'uploads',request.id));}catch(e){if(e.code!=='ENOENT')console.error('Rejected photo cleanup failed');}}
      return send(res,200,{ok:true});
    }
    if(path.startsWith('/api/photo-requests/files/') && req.method==='GET') {
      const request=db.prepare("SELECT r.*,m.album_id,m.visibility FROM photo_requests r JOIN moments m ON m.id=r.moment_id WHERE r.id=? AND r.status='pending'").get(path.split('/').pop());
      if(!request)fail(404,'התמונה לא נמצאה');const member=membership(user,request.album_id);
      if(!canView(member.role,request))fail(404,'התמונה לא נמצאה');
      if(member.role!=='parent' && request.user_id!==user)fail(403,'אין הרשאה לצפות בתמונה הזאת');
      const file=join(data,'uploads',request.id);if(!existsSync(file))fail(404,'התמונה לא נמצאה');
      res.setHeader('Content-Type',request.type);return res.end(readFileSync(file));
    }
    if (path === '/api/moments/delete' && req.method === 'POST') {
      const b=await body(req);editor(user,b.album);
      const moment=text(b.id,80,'מזהה האירוע');
      if(!db.prepare('SELECT id FROM moments WHERE id=? AND album_id=?').get(moment,b.album)) fail(404,'האירוע לא נמצא באלבום');
      const files=db.prepare('SELECT id FROM files WHERE moment_id=?').all(moment);
      const requested=db.prepare("SELECT id FROM photo_requests WHERE moment_id=? AND status='pending'").all(moment);
      const target=b.targetId===undefined?null:text(b.targetId,80,'אירוע היעד');
      if(target) {
        if(target===moment)fail(400,'יש לבחור אירוע אחר');
        if(!db.prepare('SELECT id FROM moments WHERE id=? AND album_id=?').get(target,b.album))fail(404,'אירוע היעד לא נמצא באלבום');
        const combined=[...files,...db.prepare('SELECT id FROM files WHERE moment_id=?').all(target)];
        if(combined.length>10)fail(400,'ההעברה תחרוג ממגבלת 10 קבצים באירוע. בחרו אירוע אחר');
        if(combined.reduce((sum,f)=>sum+statSync(join(data,'uploads',f.id)).size,0)>100*1024*1024)fail(400,'ההעברה תחרוג ממגבלת 100MB באירוע. בחרו אירוע אחר');
      }
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE checklist SET moment_id=NULL WHERE moment_id=?').run(moment);
        db.prepare('DELETE FROM comments WHERE moment_id=?').run(moment);
        if(target)db.prepare('UPDATE files SET moment_id=? WHERE moment_id=?').run(target,moment);
        else db.prepare('DELETE FROM files WHERE moment_id=?').run(moment);
        db.prepare('DELETE FROM moments WHERE id=? AND album_id=?').run(moment,b.album);
        db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      for(const f of [...requested,...(target?[]:files)]) {try {unlinkSync(join(data,'uploads',f.id));} catch(e) {if(e.code!=='ENOENT')console.error('Deleted event file cleanup failed');}}
      return send(res,200,{ok:true});
    }
    if (path === '/api/moments' && req.method === 'POST') {
      const b = await body(req); editor(user,b.album);
      const title = text(b.title,120,'שם הרגע');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !Number.isFinite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0,10) !== b.date) fail(400,'יש לבחור תאריך תקין');
      if (typeof b.description !== 'string' || b.description.length > 5000) fail(400,'התיאור ארוך מדי');
      if (!Array.isArray(b.files) || b.files.length > 10) fail(400,'אפשר לצרף עד 10 קבצים');
      let total = 0;
      const moment=b.id ? text(b.id,80,'מזהה האירוע') : id();
      if(b.milestoneKey!==undefined) {
        milestoneKey(b.milestoneKey);if(b.id) fail(400,'אפשר לקשר אבן דרך רק לאירוע חדש');
        if(db.prepare('SELECT moment_id FROM checklist WHERE album_id=? AND key=?').get(b.album,b.milestoneKey)?.moment_id) fail(409,'לאבן הדרך כבר יש אירוע. רעננו את האלבום כדי לצפות בו');
      }
      const existing=b.id?db.prepare('SELECT * FROM moments WHERE id=?').get(moment):null;
      const eventVisibility=visibility(b.visibility,existing?.visibility);
      const edit=b.id ? planEdit(b,db.prepare('SELECT * FROM moments WHERE id=?').get(moment),db.prepare('SELECT id,name,type FROM files WHERE moment_id=?').all(moment)) : null;
      if(edit) {if(edit.kept.length+b.files.length>10)fail(400,'אפשר לשמור עד 10 קבצים באירוע');total=edit.kept.reduce((sum,f)=>sum+statSync(join(data,'uploads',f.id)).size,0);}
      const files = b.files.map(f => {
        if (!allowed.has(f.type) || typeof f.data !== 'string') fail(400,'אפשר להעלות תמונות, סרטוני MP4 או WebM ומסמכי PDF');
        const bytes = Buffer.from(f.data,'base64'); total += bytes.length;
        if (!bytes.length || bytes.length > 50*1024*1024 || total > 100*1024*1024) fail(413,'אפשר לצרף עד 100MB לרגע');
        return {id:id(),name:text(f.name,200,'שם הקובץ'),type:f.type,bytes};
      });
      db.exec('BEGIN');
      try {
        if(edit) {
          db.prepare('UPDATE moments SET title=?,date=?,description=?,visibility=? WHERE id=?').run(title,b.date,b.description.trim(),eventVisibility,moment);
          for(const f of edit.removed) db.prepare('DELETE FROM files WHERE id=? AND moment_id=?').run(f.id,moment);
        } else db.prepare('INSERT INTO moments(id,album_id,title,date,description,created,visibility) VALUES(?,?,?,?,?,?,?)').run(moment,b.album,title,b.date,b.description.trim(),Date.now(),eventVisibility);
        if(b.milestoneKey!==undefined) db.prepare('INSERT INTO checklist(album_id,key,completed,moment_id) VALUES(?,?,1,?) ON CONFLICT(album_id,key) DO UPDATE SET completed=1,moment_id=excluded.moment_id').run(b.album,b.milestoneKey,moment);
        for (const f of files) { writeFileSync(join(data,'uploads',f.id),f.bytes); db.prepare('INSERT INTO files VALUES(?,?,?,?)').run(f.id,moment,f.name,f.type); }
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
      if(edit) for(const f of edit.removed) {try {unlinkSync(join(data,'uploads',f.id));}catch {console.error('Detached file cleanup failed');}}
      return send(res,edit?200:201,{id:moment});
    }
    if (path.startsWith('/api/files/') && req.method === 'GET') {
      const f = db.prepare('SELECT f.*,m.album_id,m.visibility FROM files f JOIN moments m ON m.id=f.moment_id WHERE f.id=?').get(path.split('/').pop());
      if (!f) fail(404,'הקובץ לא נמצא'); if(!canView(membership(user,f.album_id).role,f))fail(404,'הקובץ לא נמצא');
      const file = join(data,'uploads',f.id); if (!existsSync(file)) fail(404,'הקובץ לא נמצא');
      res.setHeader('Content-Type',f.type);
      res.setHeader('Content-Disposition',`${f.type === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      return res.end(readFileSync(file));
    }
    fail(404,'העמוד לא נמצא');
  } catch (e) { if (!e.status) console.error(e); send(res,e.status || 500,{error:e.status ? e.message : 'משהו השתבש. נסו שוב.'}); }
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',() => console.log(`LittleDreams: port ${server.address().port}`));
if (process.env.BACKUP_ENABLED === '1') {
  backupDatabase();
  setInterval(backupDatabase,24*60*60*1000).unref();
}
