begin;
-- Serialize the first deployment across parallel serverless instances.
select pg_advisory_xact_lock(718402006);
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
