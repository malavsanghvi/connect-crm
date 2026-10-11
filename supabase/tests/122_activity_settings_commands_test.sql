-- 0663: the fifteen Settings and Setup commands are in the activity allowlist, each as a portal action with its command, with a plain
-- label; running the migration again changes nothing; the commands of 0625, 0651 and 0655 are untouched.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

select pg_temp.assert((select count(*) = 15 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action'
                          and c.commandable_key in ('settings.setup_status', 'settings.role_holders', 'settings.who_can_access', 'settings.integrations_health',
                                                    'settings.modules_state', 'settings.draft_role_grant', 'settings.enter_secret', 'settings.accept_agreements',
                                                    'settings.connect_quickbooks', 'settings.connect_payments', 'settings.change_domain_records',
                                                    'settings.confirm_as_owner', 'settings.send_nonprofit_proof', 'settings.go_live', 'settings.second_approval')
                          and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')),
  'A · every Settings command is a portal action under assistant.<area>_<verb>, with its command');
select pg_temp.assert((select bool_and(char_length(c.label) between 6 and 120 and c.label !~ '[._]') from app.activity_catalog c
                        where c.surface = 'portal' and c.key like 'assistant.settings\_%'),
  'A · the labels are plain verb phrases');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_search' and c.surface = 'portal' and c.commandable_key = 'people.search')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.events_set_field' and c.surface = 'portal' and c.commandable_key = 'events.set_field')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_add_person' and c.surface = 'portal' and c.commandable_key = 'people.add_person')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.events_summary' and c.surface = 'portal' and c.commandable_key = 'events.summary'),
  'A · the commands of 0625, 0651 and 0655 are untouched');

select count(*) as n_before,
       md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_before
  from app.activity_catalog c \gset
\i migrations/0663_activity_settings_commands.sql
select pg_temp.assert((select count(*) = :n_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_before'
                         from app.activity_catalog c),
  'B · running 0663 again leaves the allowlist exactly as it was');

rollback;
\echo 'PASS: activity Settings commands tests'
