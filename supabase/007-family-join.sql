begin;
select pg_advisory_xact_lock(718402007);
-- Invite-authenticated viewers have no email/password login. Existing accounts
-- keep their credentials, and phone numbers are deliberately not unique.
alter table little_dreams.users alter column email drop not null;
alter table little_dreams.users alter column password drop not null;
create table if not exists little_dreams.family_profiles (
  user_id text not null, album_id text not null,
  name text not null check(length(name) between 1 and 80),
  phone text not null check(length(phone) between 9 and 16),
  relationship text not null,
  primary key(user_id,album_id),
  foreign key(user_id,album_id) references little_dreams.members(user_id,album_id) on delete cascade
);
alter table little_dreams.family_profiles enable row level security;
revoke all on little_dreams.family_profiles from public,anon,authenticated;
commit;
