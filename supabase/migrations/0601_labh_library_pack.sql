-- 0601 · Labh as its own module, and the library pack on the shared rows (experiences, stream 0600-0605;
-- docs/ORGANIZATION_CATEGORIES_PLAN.md "PR 4", owner decisions C3 and C13 of 2026-10-06, direction 2026-10-08).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   1. LABH IS ITS OWN SWITCH (module "labh", under Pledges & donations). JSH keeps it on and could switch it off without
--      switching off giving. A Chamber of commerce, the neutral Community organization, a Faith community and every experience
--      that inherits from them never has Labh, not even as a switch. The two labh tables (labh_options, labh_fulfillments)
--      move to the new module and commit_labh checks it as well as Giving. Giving cannot be switched off while Labh is on (the
--      existing dependency rule). A community that already had Giving switched off gets Labh switched off with it, so nothing
--      that was hidden becomes visible.
--   2. THE LIBRARY PACK. The shared libraries (center_id null) of lessons, practices, calendar and sources get a column
--      library_pack: null = every experience, 'jain' = the experiences whose library pack is 'jain' (Jain Center and anything
--      that inherits from it). Today's shared Jain rows are tagged 'jain'; the school-district calendars and shared rows with
--      no tradition stay shared. A trigger tags new shared Jain rows, so the seed and later content packs need no change.
--      Niva's search offers a shared source only to an experience that has its library pack, so a chamber is never given a
--      Jain source even if one were left without a tradition.
--   JSH: Jain Center has the pack 'jain' and Labh on, so every row it saw it still sees and every answer is the same.
--   The member app and the portal filter the shared libraries by the same column (experience.library_pack in
--   app.member_experience); old app builds keep filtering by tradition, which is still 'other' for a non-Jain experience.
set client_min_messages = warning;

-- ════════════════════════════════════════════════════════════════════════════
-- A · The Labh module
-- ════════════════════════════════════════════════════════════════════════════
insert into app.modules (key, label, description, core, depends_on, sort) values
  ('labh', 'Labh', 'The labh menu for a family''s special days, the pledges taken from it and who fulfils each labh.', false, '{giving}', 4)
on conflict (key) do update set label = excluded.label, description = excluded.description, core = excluded.core,
  depends_on = excluded.depends_on, sort = excluded.sort;
update app.modules set description = replace(description, 'recurring gifts, labh, receipts', 'recurring gifts, receipts')
 where key = 'giving' and description like '%recurring gifts, labh, receipts%';

-- Jain Center (and everything that inherits from it) has Labh on; every other experience never has it. The trigger of 0594
-- already gave each category a row for the new module (off for all but Jain Center); this states the answer.
update app.category_modules cm
   set availability = case when 'jain_center' = any (k.lineage) then 'default_on' else 'not_available' end
  from app.organization_categories k
 where cm.module_key = 'labh' and k.key = cm.category_key;

-- Where Giving was already switched off, Labh goes off with it (it was hidden by the Giving switch until now).
do $$ begin
  perform app.set_audit_context('Labh becomes its own module (migration 0601): switched off where Giving already was');
  insert into app.center_modules (center_id, module_key, enabled, changed_at, reason)
  select g.center_id, 'labh', false, now(),
         'Giving was already switched off when Labh became its own module (0601), so Labh stays off with it.'
    from app.center_modules g
   where g.module_key = 'giving' and not g.enabled
  on conflict (center_id, module_key) do nothing;
end $$;

-- The two tables of the module and their restrictive switch policy (the generator of 0103, for the new module).
update app.module_tables set module_key = 'labh' where table_name in ('labh_options', 'labh_fulfillments');
do $$
declare t text; v_qual text;
begin
  foreach t in array array['labh_options', 'labh_fulfillments'] loop
    v_qual := format('(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(%L))::uuid[]))', 'labh');
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)', t, v_qual, v_qual);
  end loop;
end $$;
update app.import_entities set module_key = 'labh' where key = 'labh_options';

-- commit_labh (0104) with one more guard: the Labh module, next to Giving.
create or replace function app.commit_labh(p_special_day uuid, p_option_ids uuid[], p_dedication text DEFAULT NULL::text, p_repeat_yearly boolean DEFAULT false)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare d app.special_days; o record; v_numbers text[] := '{}'; v_number text; v_pledge uuid; v_me uuid; v_next date;
begin
  select * into d from app.special_days where id = p_special_day;
  perform app.assert_module_enabled(d.center_id, 'giving');
  perform app.assert_module_enabled(d.center_id, 'labh');
  if d.id is null then raise exception 'special day not found'; end if;
  if not app.adult_of_household(d.center_id, d.household_id) then
    raise exception 'only an adult of the family can take a labh';
  end if;
  if coalesce(array_length(p_option_ids, 1), 0) = 0 then raise exception 'choose at least one labh'; end if;
  if exists (select 1 from unnest(p_option_ids) i where not exists (
       select 1 from app.labh_options lo where lo.id = i and lo.center_id = d.center_id and lo.active)) then
    raise exception 'one of the chosen labh options is no longer offered';
  end if;
  v_me := app.my_person_id(d.center_id);
  v_next := app.next_special_day_on(d.id, current_date);
  for o in
    select lo.*, array_position(p_option_ids, lo.id) as pos from app.labh_options lo
     where lo.id = any(p_option_ids) order by array_position(p_option_ids, lo.id)
  loop
    insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, fund_id, source, source_ref_id,
                             amount_cents, dedication, due_on, created_by)
      values (d.center_id, d.household_id, v_me, o.campaign_id, o.fund_id, 'labh', d.id,
              o.amount_cents, nullif(trim(p_dedication), ''), v_next, auth.uid())
      returning id, pledge_number into v_pledge, v_number;
    v_numbers := v_numbers || v_number;
    -- Fulfillment starts "to schedule" and remembers which labh was chosen (0060).
    insert into app.labh_fulfillments (pledge_id, center_id, labh_option_id, occasion)
      values (v_pledge, d.center_id, o.id, coalesce(nullif(trim(d.label), ''), initcap(d.kind)));
    if coalesce(p_repeat_yearly, false) then
      insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, amount_cents, frequency,
                                       special_day_id, status, starts_on, next_charge_on, end_kind)
        values (d.center_id, d.household_id, v_me, o.campaign_id, o.fund_id, o.amount_cents, 'yearly',
                d.id, 'pending_payment_method', (v_next + interval '1 year')::date, (v_next + interval '1 year')::date, 'until_stopped');
    end if;
  end loop;
  return v_numbers;
end $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · The library pack on the shared rows
-- ════════════════════════════════════════════════════════════════════════════
alter table app.content_items add column if not exists library_pack text check (library_pack is null or library_pack ~ '^[a-z][a-z0-9_]{1,39}$');
alter table app.gyan_goals add column if not exists library_pack text check (library_pack is null or library_pack ~ '^[a-z][a-z0-9_]{1,39}$');
alter table app.practices add column if not exists library_pack text check (library_pack is null or library_pack ~ '^[a-z][a-z0-9_]{1,39}$');
alter table app.calendar_layers add column if not exists library_pack text check (library_pack is null or library_pack ~ '^[a-z][a-z0-9_]{1,39}$');
alter table app.tithi_days add column if not exists library_pack text check (library_pack is null or library_pack ~ '^[a-z][a-z0-9_]{1,39}$');
comment on column app.content_items.library_pack is
  'Which experiences get this SHARED row (0601): null = every experience, otherwise the experiences whose organization_categories.library_pack is the same. Meaningless on a community''s own row.';
comment on column app.gyan_goals.library_pack is 'As content_items.library_pack (0601): the shared Gyan Path goals of a library pack.';
comment on column app.practices.library_pack is 'As content_items.library_pack (0601): the shared My Jain Way practices of a library pack.';
comment on column app.calendar_layers.library_pack is 'As content_items.library_pack (0601): the shared Jain tithi and festival layers are the jain pack; the school districts stay shared.';
comment on column app.tithi_days.library_pack is 'As content_items.library_pack (0601): the shared tithi table of a tradition is the jain pack.';

-- Today's shared Jain rows. (A shared row with a tradition is a row of the Jain library: the traditions are the Jain ones, and
-- "other" is the value for a community that has none. A shared calendar layer has no tradition; the tithi and festival layers
-- are Jain, the school districts are not.)
update app.content_items set library_pack = 'jain'
 where center_id is null and library_pack is null and tradition is not null and tradition <> 'other';
update app.gyan_goals set library_pack = 'jain'
 where center_id is null and library_pack is null and tradition is not null and tradition <> 'other';
update app.practices set library_pack = 'jain'
 where center_id is null and library_pack is null and tradition is not null and tradition <> 'other';
update app.tithi_days set library_pack = 'jain'
 where center_id is null and library_pack is null and tradition is not null and tradition <> 'other';
update app.calendar_layers set library_pack = 'jain'
 where center_id is null and library_pack is null and kind in ('tithi', 'festival');

-- A new shared Jain row (a seed, a migration, a content pack) is tagged the same way, so nothing has to remember.
create or replace function app.library_pack_default() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if new.center_id is null and new.library_pack is null then
    if tg_table_name = 'calendar_layers' then
      if new.kind in ('tithi', 'festival') then new.library_pack := 'jain'; end if;
    elsif new.tradition is not null and new.tradition <> 'other' then
      new.library_pack := 'jain';
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.library_pack_default() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['content_items', 'gyan_goals', 'practices', 'calendar_layers', 'tithi_days'] loop
    execute format('drop trigger if exists library_pack_default on app.%I', t);
    execute format('create trigger library_pack_default before insert on app.%I for each row execute function app.library_pack_default()', t);
  end loop;
end $$;

-- Does a shared row of this pack show for this community? (null pack = everyone; otherwise the community's experience has the pack)
create or replace function app.library_pack_shows(p_pack text, p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_pack is null
      or exists (select 1 from app.centers c join app.organization_categories k on k.key = c.category_key
                  where c.id = p_center and k.library_pack = p_pack)
$$;
grant execute on function app.library_pack_shows(text, uuid) to anon, authenticated, service_role;
revoke execute on function app.library_pack_shows(text, uuid) from public;

-- ════════════════════════════════════════════════════════════════════════════
-- C · Niva's search offers a shared source only to an experience that has its library pack
-- ════════════════════════════════════════════════════════════════════════════
-- 0575's search (the latest definition) with one more condition on the shared rows. The community's own sources are not
-- affected. For a Jain Center every shared row it was offered before still passes (the pack is 'jain').
create or replace function app.niva_worker_search_sources(p_center uuid, p_query text, p_limit int, p_statuses text[])
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_statuses text[] := case when cardinality(p_statuses) > 0 then p_statuses else array['published'] end;
  v_tradition app.tradition;
  v_pack text;
  v_from text[];
  v_guide boolean;
  v_faq boolean;
  v_tsq tsquery;
  v_out jsonb;
begin
  perform app.assert_worker();
  if exists (select 1 from unnest(v_statuses) s where s is null or s not in ('published', 'in_review')) then
    raise exception 'Niva answers only from published sources, or also from sources waiting for approval in a staff test (asked for: %).',
      array_to_string(v_statuses, ', ', '(none)') using errcode = '22023';
  end if;

  select c.tradition, k.library_pack into v_tradition, v_pack
    from app.centers c left join app.organization_categories k on k.key = c.category_key where c.id = p_center;
  if not found then return '[]'::jsonb; end if;
  v_tsq := app.niva_search_tsquery(p_center, p_query);
  if v_tsq is null then return '[]'::jsonb; end if;
  v_from := app.niva_answer_from(p_center);
  v_guide := 'guide' = any (v_from);
  v_faq := 'faq' = any (v_from);

  with cand as (
    -- The community's own sources, and the shared pack for its tradition (or for every tradition) when its experience has the library pack (0601).
    select c.id::text as ref, c.kind, c.title, coalesce(c.body_md, '') as body, c.metadata->>'source_url' as source_url,
           c.updated_at, ts_rank_cd(c.niva_tsv, v_tsq, 1 | 32) as score
      from app.content_items c
     where c.kind = 'niva_source'
       and c.status = any (v_statuses)
       and (c.status = 'published' or c.center_id = p_center)   -- 0575: never a shared source the platform has not approved
       and (c.center_id = p_center or (c.center_id is null and (c.tradition is null or c.tradition = v_tradition)
                                       and (c.library_pack is null or c.library_pack is not distinct from v_pack)))
       and c.niva_tsv @@ v_tsq
    union all
    -- FAQ, when the community answers from it.
    select c.id::text, c.kind, c.title, coalesce(c.body_md, ''), c.metadata->>'source_url',
           c.updated_at, ts_rank_cd(c.niva_tsv, v_tsq, 1 | 32)
      from app.content_items c
     where v_faq and c.kind = 'faq'
       and c.status = any (v_statuses)
       and (c.status = 'published' or c.center_id = p_center)   -- 0575: never a shared source the platform has not approved
       and (c.center_id = p_center or (c.center_id is null and (c.tradition is null or c.tradition = v_tradition)
                                       and (c.library_pack is null or c.library_pack is not distinct from v_pack)))
       and c.niva_tsv @@ v_tsq
    union all
    -- Public Guide sections, when the community answers from them. Weighed like a hand-written source.
    select 'guide_section:' || g.id::text, 'guide_section', g.title, g.body_md, null,
           g.updated_at, ts_rank_cd(v.tsv, v_tsq, 1 | 32)
      from app.guide_sections g
     cross join lateral (select setweight(to_tsvector('english', g.title), 'A')
                                || setweight(to_tsvector('english', g.body_md), 'B')
                                || setweight(to_tsvector('simple', g.body_md), 'D') as tsv) v
     where v_guide and g.center_id = p_center and g.public
       and v.tsv @@ v_tsq
  ), ranked as (
    select cand.*, row_number() over (order by cand.score desc, cand.updated_at desc, cand.ref collate "C") as rn
      from cand
  ), picked as (
    -- A long text: its first 1500 characters, then excerpts from the rest when the rest holds matching words.
    -- When it does not (the match is in the heading, keywords or page title, or only in those first 1500
    -- characters) ts_headline would find nothing and repeat the opening, so the first 4000 characters come back
    -- instead, as in 0541. The rest is read up to character 100000, as far as niva_tsv indexes.
    select r.*, case when char_length(r.body) <= 4000 then r.body
                     when to_tsvector('english', substr(r.body, 1501, 98500)) @@ v_tsq
                       then left(r.body, 1500) || E'\n\n[…]\n\n' || app.niva_excerpt(substr(r.body, 1501, 98500), v_tsq)
                     else left(r.body, 4000) end as excerpt
      from ranked r
     where r.rn <= v_limit
  ), budget as (
    select p.*, sum(char_length(p.title) + char_length(p.excerpt)) over (order by p.rn) as used
      from picked p
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', b.ref, 'kind', b.kind, 'title', b.title, 'body_md', b.excerpt,
                                               'rank', b.score, 'source_url', b.source_url, 'updated_at', b.updated_at)
                            order by b.rn), '[]'::jsonb)
    into v_out
    from budget b
   where b.rn = 1 or b.used <= 24000;
  return v_out;
end $$;
