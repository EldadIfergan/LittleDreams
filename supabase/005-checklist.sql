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
