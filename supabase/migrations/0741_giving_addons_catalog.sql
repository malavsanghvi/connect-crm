-- 0741 · Giving as a core plus seven add-ons: the catalog, their tables and their policies (docs/GIVING_REDESIGN.md
-- section 11, slice M2, part 1 of 3; 0742 and 0743 add the function guards).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   The core keeps the key `giving` (installed member apps know only `giving` and `bolis`, ignore keys they do not know and
--   treat a known key the server stops sending as on, so renaming it would switch everything on in old apps). Seven add-ons
--   join the catalog, each needing Giving only (no add-on needs another):
--
--     giving_bank           Bank reconciliation    bank_accounts, bank_statement_imports, bank_transactions,
--                                                  known_originators, payment_reports (Zelle reports)
--     giving_counts         Offering counts        counting_sessions, valuables_register   (the kind's own word, below)
--     giving_opportunities  Opportunities          opportunities
--     giving_recurring      Recurring gifts        recurring_gifts
--     labh                  Special-day offerings  labh_options, labh_fulfillments          ("Labh" for a Jain Center)
--     giving_statements     Statements             statements, and the `statements` storage bucket
--     giving_insights       Insights               no table yet (B98's later tables join it)
--
--   Which kinds have them (owner, 2026-10-12): each add-on copies the kind's availability of Giving, so a new community starts
--   with them on like Giving; Labh copies the kind's availability of Bolis (a Jain Center has it, every other kind never),
--   which is how the portal already decides it (src/lib/kind.ts, kindHas "labh"). Offering counts are named by the kind:
--   "Bhandar counts" (Jain Center), "Collection counts" (Church), "Offering counts" (other faiths), "Cash counts" (a kind
--   that is not faith-based); the portal reads these names from category_modules only.
--
--   Grandfathered (0740's rule): every existing community where Giving is granted (on or paused) gets a grant for each
--   add-on its kind offers, so nothing anyone sees changes, and resuming Giving brings every add-on back as it was.
--
--   The twelve tables move from `giving` to their add-on in app.module_tables, and each one's restrictive module_switch
--   policy is written again on the new key (no generator exists after 0103). Their policies today:
--     0103's generator loop: bank_accounts, bank_statement_imports, bank_transactions, known_originators, counting_sessions,
--                            valuables_register, opportunities, recurring_gifts, labh_options, labh_fulfillments, statements
--     0582:121 (written out): payment_reports
--   The new policies are the same expression with the add-on's key; 0740's module_off_centers already counts a community
--   whose Giving is off as off for every add-on (the module's chain), so pausing Giving hides all of them at once.
--
--   Also: the statements bucket follows Statements (storage_bucket_module, latest body 0587); three Setup steps follow their
--   add-on (bank accounts, past recurring gifts, past statements), so they are skipped where it is off; the demo pack lists
--   the rows it makes under their add-on. Money rules are unchanged: a switch only ever hides and refuses.

-- ── 1. The catalog ───────────────────────────────────────────────────────────
-- Sort 4 like Giving: the catalog orders by (sort, key), so the add-ons follow Giving and come before Bolis (5).
insert into app.modules (key, label, description, core, depends_on, sort) values
  ('giving_bank', 'Bank reconciliation',
   'Bank accounts, bank statement imports and their lines, known payers, and member Zelle reports matched to the bank statement.',
   false, '{giving}', 4),
  ('giving_counts', 'Offering counts',
   'Counting sessions for cash and checks collected in person (two counters from different households) and the valuables register.',
   false, '{giving}', 4),
  ('giving_opportunities', 'Opportunities',
   'Sponsorships and other opportunities inside campaigns that members choose from, with their options and slots.',
   false, '{giving}', 4),
  ('giving_recurring', 'Recurring gifts',
   'Gifts that repeat weekly, monthly, quarterly, yearly or on a family''s special day, and the pledge each cycle makes.',
   false, '{giving}', 4),
  ('labh', 'Special-day offerings',
   'The offerings menu shown on a family''s special days and the fulfillment of each offering taken.',
   false, '{giving}', 4),
  ('giving_statements', 'Statements',
   'Year-end and pledge statements issued to households, and their stored files. Receipts stay part of Giving.',
   false, '{giving}', 4),
  ('giving_insights', 'Insights',
   'Giving insights for the treasurer and the household panel under Giving at a glance.',
   false, '{giving}', 4)
on conflict (key) do update set label = excluded.label, description = excluded.description, core = excluded.core,
  depends_on = excluded.depends_on, sort = excluded.sort;

update app.modules
   set description = 'Funds, campaigns, pledges, payments, allocations, refunds, receipts and the ways to pay. Its add-ons: bank '
                  || 'reconciliation, offering counts, opportunities, recurring gifts, special-day offerings, statements and insights.'
 where key = 'giving';

-- ── 2. Which kinds have them (the 0594 trigger has already given every category a row for each) ──────────────────────
update app.category_modules cm
   set availability = coalesce((select src.availability from app.category_modules src
                                 where src.category_key = cm.category_key
                                   and src.module_key = case when cm.module_key = 'labh' then 'bolis' else 'giving' end),
                               'default_on')
 where cm.module_key in ('giving_bank', 'giving_counts', 'giving_opportunities', 'giving_recurring', 'labh',
                         'giving_statements', 'giving_insights');

update app.category_modules cm
   set label = case when cm.category_key = 'jain_center' then 'Bhandar counts'
                    when cm.category_key = 'church' then 'Collection counts'
                    when k.faith_based then 'Offering counts'
                    else 'Cash counts' end
  from app.organization_categories k
 where k.key = cm.category_key and cm.module_key = 'giving_counts';

update app.category_modules set label = 'Labh' where module_key = 'labh' and category_key = 'jain_center';

-- ── 3. The tables move to their add-on ─────────────────────────────────────
update app.module_tables set module_key = 'giving_bank'
 where table_name in ('bank_accounts', 'bank_statement_imports', 'bank_transactions', 'known_originators', 'payment_reports');
update app.module_tables set module_key = 'giving_counts' where table_name in ('counting_sessions', 'valuables_register');
update app.module_tables set module_key = 'giving_opportunities' where table_name = 'opportunities';
update app.module_tables set module_key = 'giving_recurring' where table_name = 'recurring_gifts';
update app.module_tables set module_key = 'labh' where table_name in ('labh_options', 'labh_fulfillments');
update app.module_tables set module_key = 'giving_statements' where table_name = 'statements';

-- ── 4. Their restrictive module_switch policies, on the new key (each written out) ──────────────────────────────────
-- Bank reconciliation
drop policy if exists module_switch on app.bank_accounts;
create policy module_switch on app.bank_accounts as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])));
drop policy if exists module_switch on app.bank_statement_imports;
create policy module_switch on app.bank_statement_imports as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])));
drop policy if exists module_switch on app.bank_transactions;
create policy module_switch on app.bank_transactions as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])));
-- known_originators: a platform-wide row (center_id null) is never hidden.
drop policy if exists module_switch on app.known_originators;
create policy module_switch on app.known_originators as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])));
drop policy if exists module_switch on app.payment_reports;
create policy module_switch on app.payment_reports as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_bank'))::uuid[])));
-- Offering counts
drop policy if exists module_switch on app.counting_sessions;
create policy module_switch on app.counting_sessions as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_counts'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_counts'))::uuid[])));
drop policy if exists module_switch on app.valuables_register;
create policy module_switch on app.valuables_register as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_counts'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_counts'))::uuid[])));
-- Opportunities
drop policy if exists module_switch on app.opportunities;
create policy module_switch on app.opportunities as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_opportunities'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_opportunities'))::uuid[])));
-- Recurring gifts
drop policy if exists module_switch on app.recurring_gifts;
create policy module_switch on app.recurring_gifts as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_recurring'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_recurring'))::uuid[])));
-- Special-day offerings (Labh)
drop policy if exists module_switch on app.labh_options;
create policy module_switch on app.labh_options as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('labh'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('labh'))::uuid[])));
drop policy if exists module_switch on app.labh_fulfillments;
create policy module_switch on app.labh_fulfillments as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('labh'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('labh'))::uuid[])));
-- Statements
drop policy if exists module_switch on app.statements;
create policy module_switch on app.statements as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_statements'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving_statements'))::uuid[])));

-- ── 5. The statements bucket follows Statements (0587's body; only 'statements' changes) ─────────────────────────────
create or replace function app.storage_bucket_module(p_bucket text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_bucket when 'content' then 'content' when 'photos' then 'content' when 'store' then 'store'
                       when 'statements' then 'giving_statements' when 'recordings' then 'gyan_path' when 'homework' then 'gyan_path' end
$$;

-- ── 6. Setup steps of an add-on are skipped where it is off ───────────────────
-- (tpl.statements, the receipt and statement templates and their approval, stays with Giving.)
update app.setup_steps set module_key = 'giving_bank' where key = 'svc.bank_accounts';
update app.setup_steps set module_key = 'giving_recurring' where key = 'hist.recurring';
update app.setup_steps set module_key = 'giving_statements' where key = 'hist.statements';

-- ── 7. The demo pack lists its rows under their add-on ─────────────────────────
update app.demo_packs p
   set contents = (
     select jsonb_agg(y.m order by y.o, y.sub)
       from (
         select x.o, 0 as sub,
                case when x.m->>'module' = 'giving'
                     then jsonb_set(x.m, '{rows}', (x.m->'rows') - array['bank_accounts', 'bank_transactions', 'opportunities',
                                                                         'recurring_gifts', 'labh_options', 'labh_fulfillments'])
                     else x.m end as m
           from jsonb_array_elements(p.contents) with ordinality x(m, o)
         union all
         select x.o, a.sub, jsonb_build_object('rows', a.rows, 'label', a.label, 'module', a.module)
           from jsonb_array_elements(p.contents) with ordinality x(m, o)
           cross join lateral (values
             (1, 'giving_bank', 'Bank reconciliation',
              jsonb_strip_nulls(jsonb_build_object('bank_accounts', x.m->'rows'->'bank_accounts', 'bank_transactions', x.m->'rows'->'bank_transactions'))),
             (2, 'giving_opportunities', 'Opportunities', jsonb_strip_nulls(jsonb_build_object('opportunities', x.m->'rows'->'opportunities'))),
             (3, 'giving_recurring', 'Recurring gifts', jsonb_strip_nulls(jsonb_build_object('recurring_gifts', x.m->'rows'->'recurring_gifts'))),
             (4, 'labh', 'Special-day offerings',
              jsonb_strip_nulls(jsonb_build_object('labh_options', x.m->'rows'->'labh_options', 'labh_fulfillments', x.m->'rows'->'labh_fulfillments')))
           ) a(sub, module, label, rows)
          where x.m->>'module' = 'giving' and a.rows <> '{}'::jsonb
       ) y)
 where p.key = 'community'
   and not exists (select 1 from jsonb_array_elements(p.contents) e where e->>'module' = 'giving_bank');

-- ── 8. Grandfathered grants (0740's table; written here as the migration, like 0740's own) ───────────────────────────
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
select c.id, a.key, true,
       'Enabled when Giving became a core plus add-ons (0741): Giving was enabled for this community.', null, now()
  from app.centers c
  cross join (values ('giving_bank'), ('giving_counts'), ('giving_opportunities'), ('giving_recurring'), ('labh'),
                     ('giving_statements'), ('giving_insights')) a(key)
 where app._module_granted(c.id, 'giving')
   and app.module_availability(c.id, a.key) <> 'not_available'
on conflict (center_id, module_key) do nothing;
