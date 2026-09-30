import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
if(!process.env.SMOKE_BASE){console.log('Reusable invite smoke skipped.');process.exit(0);}
const base=process.env.SMOKE_BASE,suffix=randomBytes(8).toString('hex');
async function call(path,body,cookie=''){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const p=await call('/api/register',{childName:'Invite test',birthDate:'2026-01-01',name:'Test',email:`invite-${suffix}@example.test`,password:randomBytes(24).toString('hex')});assert.equal(p.status,200);
const album=(await call('/api/me',undefined,p.cookie)).value.albums[0].id;
const token=(await call('/api/invites',{album,role:'viewer'},p.cookie)).value.token;
const guests=await Promise.all(['First','Second'].map(name=>call('/api/family/join',{invite:token,name,phone:'0501234567',relationship:'other'})));
for(const guest of guests){assert.equal(guest.status,200,JSON.stringify(guest.value));assert.equal((await call('/api/me',undefined,guest.cookie)).value.albums[0].role,'viewer');}
assert.equal((await call('/api/invites/info?token='+token)).status,200);
for(const c of [p.cookie,...guests.map(g=>g.cookie)])await call('/api/logout',{},c);
console.log('PASS: two family members joined with one link; link remains valid.');
