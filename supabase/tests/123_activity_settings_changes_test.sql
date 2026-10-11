-- 0664: the three Settings changes (give a role, take a role away, switch a module) are in the activity allowlist, each as a portal
-- action with its command, with a plain label; running the migration again changes nothing; the commands of 0663 are untouched.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

select pg_temp.assert((select count(*) = 3 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action'
                          and c.commandable_key in ('settings.grant_role', 'settings.revoke_role', 'settings.set_module')
                          and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')),
  'A · each change is a portal action under assistant.<area>_<verb>, with its command');
select pg_temp.assert((select bool_and(char_length(c.label) between 6 and 120 and c.label !~ '[._]') from app.activity_catalog c
                        where c.surface = 'portal' and c.key in ('assistant.settings_grant_role', 'assistant.settings_revoke_role', 'assistant.settings_set_module')),
  'A · the labels are plain verb phrases');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.settings_draft_role_grant' and c.surface = 'portal' and c.commandable_key = 'settings.draft_role_grant')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_search' and c.surface = 'portal' and c.commandable_key = 'people.search'),
  'A · the commands of 0625 and 0663 are untouched');

select count(*) as n_before,
       md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_before
  from app.activity_catalog c \gset
\i migrations/0664_activity_settings_changes.sql
select pg_temp.assert((select count(*) = :n_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_before'
                         from app.activity_catalog c),
  'B · running 0664 again leaves the allowlist exactly as it was');

rollback;
\echo 'PASS: activity Settings changes tests'
