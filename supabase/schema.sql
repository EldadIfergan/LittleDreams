-- LittleDreams: server-only data. No anonymous/browser access to application tables.
-- Run once in a NEW, dedicated Supabase project, not in an existing app's database.
begin;
create schema if not exists little_dreams;
revoke all on schema little_dreams from public, anon, authenticated;
create table if not exists little_dreams.users (
  id text primary key, email text unique, name text not null, password text
);
create table if not exists little_dreams.albums (
  id text primary key, name text not null, child_name text, birth_date text,
  birth_weight real, birth_length real, sex text check (sex in ('boy','girl','unspecified')), avatar text, birth_time text
);
create table if not exists little_dreams.members (
  user_id text references little_dreams.users(id), album_id text references little_dreams.albums(id),
  role text not null check (role in ('parent','viewer')), primary key(user_id,album_id)
);
create table if not exists little_dreams.family_profiles (
  user_id text not null, album_id text not null,
  name text not null check(length(name) between 1 and 80),
  phone text not null check(length(phone) between 9 and 16), relationship text not null,
  primary key(user_id,album_id),
  foreign key(user_id,album_id) references little_dreams.members(user_id,album_id) on delete cascade
);
alter table little_dreams.family_profiles enable row level security;
create table if not exists little_dreams.sessions (
  token text primary key, user_id text not null references little_dreams.users(id), expires bigint not null
);
create table if not exists little_dreams.invites (
  token text primary key, album_id text not null references little_dreams.albums(id),
  role text not null check (role in ('parent','viewer')), expires bigint not null, used integer not null default 0
);
create table if not exists little_dreams.moments (
  id text primary key, album_id text not null references little_dreams.albums(id),
  title text not null, date text not null, description text not null, created bigint not null
);
create table if not exists little_dreams.files (
  id text primary key, moment_id text not null references little_dreams.moments(id), name text not null, type text not null
);
create table if not exists little_dreams.comments (
  id text primary key, moment_id text not null references little_dreams.moments(id),
  user_id text not null references little_dreams.users(id), body text not null check(length(body) between 1 and 2000), created bigint not null
);
create table if not exists little_dreams.pending_uploads (
  id text primary key, album_id text not null references little_dreams.albums(id),
  user_id text not null references little_dreams.users(id), name text not null, type text not null,
  size bigint not null check(size > 0 and size <= 52428800), expires bigint not null
);
create table if not exists little_dreams.login_attempts (
  key text primary key, count integer not null, expires bigint not null
);
create index if not exists comments_by_moment on little_dreams.comments(moment_id,created);
create index if not exists moments_by_album on little_dreams.moments(album_id,date);
create index if not exists membership_by_album on little_dreams.members(album_id);
alter table little_dreams.users enable row level security;
alter table little_dreams.albums enable row level security;
alter table little_dreams.members enable row level security;
alter table little_dreams.sessions enable row level security;
alter table little_dreams.invites enable row level security;
alter table little_dreams.moments enable row level security;
alter table little_dreams.files enable row level security;
alter table little_dreams.comments enable row level security;
alter table little_dreams.pending_uploads enable row level security;
alter table little_dreams.login_attempts enable row level security;
revoke all on all tables in schema little_dreams from public,anon,authenticated;
commit;

-- No public storage policies: signed access is issued by the server after membership checks.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('little-dreams','little-dreams',false,52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf'])
on conflict(id) do nothing;

begin;
create table if not exists little_dreams.checklist (
  album_id text not null references little_dreams.albums(id),
  key text not null, completed integer not null default 0 check(completed in (0,1)),
  moment_id text references little_dreams.moments(id),
  primary key(album_id,key)
);
alter table little_dreams.checklist enable row level security;
revoke all on little_dreams.checklist from public,anon,authenticated;
commit;

begin;
create table if not exists little_dreams.photo_requests (
  id text primary key,
  moment_id text not null references little_dreams.moments(id) on delete cascade,
  user_id text not null references little_dreams.users(id),
  name text not null, type text not null check(type in ('image/jpeg','image/png','image/webp','image/gif')),
  size bigint not null check(size>0 and size<=10485760), created bigint not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected'))
);
create table if not exists little_dreams.photo_request_uploads (
  id text primary key,
  moment_id text not null references little_dreams.moments(id) on delete cascade,
  user_id text not null references little_dreams.users(id),
  name text not null, type text not null check(type in ('image/jpeg','image/png','image/webp','image/gif')),
  size bigint not null check(size>0 and size<=10485760), expires bigint not null
);
create index if not exists photo_requests_by_moment on little_dreams.photo_requests(moment_id,status,user_id);
create index if not exists photo_uploads_by_moment on little_dreams.photo_request_uploads(moment_id,user_id,expires);
alter table little_dreams.photo_requests enable row level security;
alter table little_dreams.photo_request_uploads enable row level security;
revoke all on little_dreams.photo_requests,little_dreams.photo_request_uploads from public,anon,authenticated;
commit;

begin;
alter table little_dreams.moments add column if not exists visibility text not null default 'family' check (visibility in ('family','parents'));
commit;
