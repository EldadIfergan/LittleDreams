begin;
alter table little_dreams.moments add column if not exists visibility text not null default 'family' check (visibility in ('family','parents'));
commit;
