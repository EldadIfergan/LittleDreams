import http from 'node:http';
import { validateAvatar } from './lib/avatar.js';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
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
CREATE TABLE IF NOT EXISTS moments(id TEXT PRIMARY KEY,album_id TEXT REFERENCES albums(id),title TEXT,date TEXT,description TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,moment_id TEXT REFERENCES moments(id),name TEXT,type TEXT);
CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,moment_id TEXT NOT NULL REFERENCES moments(id),user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS comments_moment ON comments(moment_id,created);
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
for (const [column,type] of [['child_name','TEXT'],['birth_date','TEXT'],['birth_weight','REAL'],['birth_length','REAL'],['sex','TEXT'],['avatar','TEXT']]) {
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
    if (req.method === 'GET' && ['/', '/app.js', '/style.css','/favicon.svg'].includes(path)) {
      const name = path === '/' ? 'index.html' : path.slice(1);
      res.setHeader('Content-Type', {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'}[name.split('.').pop()]);
      return res.end(readFileSync(join(root,'public',name)));
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
        const albumName = b.invite ? null : text(b.albumName,80,'שם האלבום');
        const profile = b.invite ? null : childProfile(b);
        if (b.invite) inviteRecord(b.invite);
        if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) fail(409,'לא ניתן ליצור חשבון עם הכתובת הזאת. נסו להתחבר.');
        user = {id:id()};
        db.exec('BEGIN');
        try {
          db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id,email,name,passwordHash(b.password));
          if (b.invite) accept(user.id,b.invite);
          else { const album = id(); db.prepare('INSERT INTO albums(id,name,child_name,birth_date,birth_weight,birth_length,sex) VALUES(?,?,?,?,?,?,?)').run(album,albumName,...profile); db.prepare('INSERT INTO members VALUES(?,?,?)').run(user.id,album,'parent'); }
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
      const b = await body(req); const name = text(b.albumName,80,'שם האלבום'); const profile = childProfile(b); const album = id();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO albums(id,name,child_name,birth_date,birth_weight,birth_length,sex,avatar) VALUES(?,?,?,?,?,?,?,?)').run(album,name,...profile,b.avatar===undefined?null:validateAvatar(b.avatar));
        db.prepare('INSERT INTO members VALUES(?,?,?)').run(user,album,'parent');
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
      return send(res,201,{id:album});
    }
    if (path === '/api/comments' && req.method === 'POST') {
      const b = await body(req);
      const momentId = text(b.moment,80,'הרגע');
      const moment = db.prepare('SELECT album_id FROM moments WHERE id=?').get(momentId);
      if (!moment) fail(404,'הרגע לא נמצא');
      membership(user,moment.album_id);
      const comment = {id:id(),body:text(b.body,2000,'התגובה (עד 2,000 תווים)'),created:Date.now()};
      db.prepare('INSERT INTO comments VALUES(?,?,?,?,?)').run(comment.id,momentId,user,comment.body,comment.created);
      comment.author = db.prepare('SELECT name FROM users WHERE id=?').get(user).name;
      return send(res,201,comment);
    }
    if (path === '/api/profile' && req.method === 'POST') {
      const b = await body(req); editor(user,b.album); const profile = childProfile(b);
      db.prepare('UPDATE albums SET child_name=?,birth_date=?,birth_weight=?,birth_length=?,sex=?,name=COALESCE(?,name),avatar=COALESCE(?,avatar) WHERE id=?').run(...profile,b.albumName===undefined?null:text(b.albumName,80,'שם האלבום'),b.avatar===undefined?null:validateAvatar(b.avatar),b.album);
      return send(res,200,{ok:true});
    }
    if (path === '/api/me' && req.method === 'GET') return send(res,200,{
      user:db.prepare('SELECT name,email FROM users WHERE id=?').get(user),
      albums:db.prepare('SELECT a.*,m.role FROM albums a JOIN members m ON a.id=m.album_id WHERE m.user_id=?').all(user)
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
    if (path === '/api/moments' && req.method === 'GET') {
      const album = url.searchParams.get('album'); membership(user,album);
      const moments = db.prepare('SELECT * FROM moments WHERE album_id=? ORDER BY date DESC,created DESC').all(album);
      for (const moment of moments) {
        moment.files = db.prepare('SELECT id,name,type FROM files WHERE moment_id=?').all(moment.id);
        moment.comments = db.prepare('SELECT c.id,c.body,c.created,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.moment_id=? ORDER BY c.created,c.rowid').all(moment.id);
      }
      return send(res,200,moments);
    }
    if (path === '/api/moments' && req.method === 'POST') {
      const b = await body(req); editor(user,b.album);
      const title = text(b.title,120,'שם הרגע');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !Number.isFinite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0,10) !== b.date) fail(400,'יש לבחור תאריך תקין');
      if (typeof b.description !== 'string' || b.description.length > 5000) fail(400,'התיאור ארוך מדי');
      if (!Array.isArray(b.files) || b.files.length > 10) fail(400,'אפשר לצרף עד 10 קבצים');
      let total = 0;
      const files = b.files.map(f => {
        if (!allowed.has(f.type) || typeof f.data !== 'string') fail(400,'אפשר להעלות תמונות, סרטוני MP4 או WebM ומסמכי PDF');
        const bytes = Buffer.from(f.data,'base64'); total += bytes.length;
        if (!bytes.length || bytes.length > 50*1024*1024 || total > 100*1024*1024) fail(413,'אפשר לצרף עד 100MB לרגע');
        return {id:id(),name:text(f.name,200,'שם הקובץ'),type:f.type,bytes};
      });
      const moment = id();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO moments VALUES(?,?,?,?,?,?)').run(moment,b.album,title,b.date,b.description.trim(),Date.now());
        for (const f of files) { writeFileSync(join(data,'uploads',f.id),f.bytes); db.prepare('INSERT INTO files VALUES(?,?,?,?)').run(f.id,moment,f.name,f.type); }
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
      return send(res,201,{id:moment});
    }
    if (path.startsWith('/api/files/') && req.method === 'GET') {
      const f = db.prepare('SELECT f.*,m.album_id FROM files f JOIN moments m ON m.id=f.moment_id WHERE f.id=?').get(path.split('/').pop());
      if (!f) fail(404,'הקובץ לא נמצא'); membership(user,f.album_id);
      const file = join(data,'uploads',f.id); if (!existsSync(file)) fail(404,'הקובץ לא נמצא');
      res.setHeader('Content-Type',f.type);
      res.setHeader('Content-Disposition',`${f.type === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      return res.end(readFileSync(file));
    }
    fail(404,'העמוד לא נמצא');
  } catch (e) { if (!e.status) console.error(e); send(res,e.status || 500,{error:e.status ? e.message : 'משהו השתבש. נסו שוב.'}); }
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',() => console.log(`LittleDreams: port ${process.env.PORT || 3000}`));
if (process.env.BACKUP_ENABLED === '1') {
  backupDatabase();
  setInterval(backupDatabase,24*60*60*1000).unref();
}

