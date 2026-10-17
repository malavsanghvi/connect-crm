-- 0888 · CatchTheMatch Phase 1, part 3: the reads of the catch list and of the claims (docs/CATCH_THE_MATCH.md section 12). Builder CTM3.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.match_catch_list(center, filter, limit, offset)   the members whose gift may be matched and who have not asked, because
--       another member with the same employer's program got a match paid to this community (0886's proof). One row per person
--       and program, with the household as the community knows it (never a name alone), the employer on file, the program, how
--       many matches it has paid here, whether the library has its steps, and the gifts that can still be claimed (the day, the
--       last day to ask, the amount only for someone who also sees giving). Filters: catchable (still within the deadline, or
--       with none) and missed (the deadline has passed with no claim: what was lost). Also the community's own name, legal name
--       and tax ID, which the steps ask for. The organization's own CatchTheMatch readers only; the read is logged.
--   app.match_claims_list(center, filter, limit, offset)  the claims: open (asked, requested, verified) or ended (received,
--       declined, expired, withdrawn), newest first. The organization's own readers only; the read is logged.
--   Neither read names a child, a minor's gift or an amount the caller may not see. Nothing here sends a message.
set client_min_messages = warning;

create or replace function app.match_catch_list(p_center uuid, p_filter text default 'catchable', p_limit int default 50,
                                                p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_filter text := case when p_filter in ('catchable', 'missed') then p_filter else 'catchable' end;
        v_today date; v_amounts boolean; v_total int; v_rows jsonb; v_counts jsonb; v_org jsonb;
begin
  perform app._match_org_reader_or_raise(p_center);
  v_today := app._match_today(p_center);
  v_amounts := app.match_amounts_can(p_center);
  with open as (
    select c.*, (c.deadline_on is null or c.deadline_on >= v_today) as can_ask
      from app._match_catch(p_center) c where c.claim_id is null
  ),
  grp as (
    select o.person_id, o.program_id, min(o.household_id::text)::uuid as household_id, max(o.employer) as employer,
           min(o.deadline_on) filter (where o.can_ask) as next_deadline, max(o.deadline_on) filter (where not o.can_ask) as last_missed,
           bool_or(o.can_ask) as any_catchable, bool_or(not o.can_ask) as any_missed
      from open o group by o.person_id, o.program_id
  ),
  shown as (
    select g.*, row_number() over (
             order by case when v_filter = 'catchable' then g.next_deadline end asc nulls last,
                      case when v_filter = 'missed' then g.last_missed end desc nulls last,
                      lower(app._care_person_name(g.person_id)), g.person_id, g.program_id) as ord
      from grp g where (v_filter = 'catchable' and g.any_catchable) or (v_filter = 'missed' and g.any_missed)
  ),
  pg as (select * from shown order by ord
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from shown),
         coalesce((select jsonb_agg(jsonb_build_object(
             'person', jsonb_build_object('id', x.person_id, 'name', app._care_person_name(x.person_id)),
             'household', app._care_household_head(x.household_id),
             'employer', x.employer,
             'program', (select jsonb_build_object('id', m.id, 'company_name', m.company_name, 'portal', m.portal, 'portal_url', m.portal_url,
                                                   'deadline_note', m.deadline_note)
                           from app.match_programs m where m.id = x.program_id),
             'proven', (select jsonb_build_object('received', count(*), 'last_on', max(c.received_on))
                          from app.match_claims c
                         where c.center_id = p_center and c.state = 'received'
                           and c.program_id in (select y.id from app.match_programs y where y.id = x.program_id or y.merged_into = x.program_id)),
             'process', (select jsonb_build_object('who_submits', pr.who_submits, 'version', pr.version)
                           from app.match_processes pr
                          where pr.program_id in (select y.id from app.match_programs y where y.id = x.program_id or y.merged_into = x.program_id)
                          order by (pr.program_id = x.program_id) desc limit 1),
             'gifts', (select coalesce(jsonb_agg(jsonb_build_object(
                          'payment_id', o.payment_id, 'received_on', o.received_on,
                          'amount_cents', case when v_amounts then o.donation_cents end,
                          'deadline_on', o.deadline_on,
                          'days_left', case when o.deadline_on is null then null else o.deadline_on - v_today end)
                          order by o.received_on desc), '[]'::jsonb)
                         from open o where o.person_id = x.person_id and o.program_id = x.program_id
                          and ((v_filter = 'catchable') = o.can_ask))) order by x.ord) from pg x), '[]'::jsonb)
    into v_total, v_rows;

  select jsonb_build_object(
    'catchable', (select count(distinct (o.person_id, o.program_id)) from app._match_catch(p_center) o
                   where o.claim_id is null and (o.deadline_on is null or o.deadline_on >= v_today)),
    'missed', (select count(distinct (o.person_id, o.program_id)) from app._match_catch(p_center) o
                where o.claim_id is null and o.deadline_on < v_today),
    'open', (select count(*) from app.match_claims c where c.center_id = p_center and c.state in ('asked', 'requested', 'verified')),
    'ended', (select count(*) from app.match_claims c where c.center_id = p_center and c.state in ('received', 'declined', 'expired', 'withdrawn')))
    into v_counts;

  select jsonb_build_object('name', c.name, 'legal_name', o.legal_name, 'ein', o.ein)
    into v_org
    from app.centers c left join app.org_profiles o on o.center_id = c.id where c.id = p_center;

  perform app.log_private_read(p_center, 'matching', 'catch_list', jsonb_array_length(v_rows));
  return jsonb_build_object('filter', v_filter, 'total', v_total, 'rows', v_rows, 'counts', v_counts, 'amounts', v_amounts,
                            'today', v_today, 'org', v_org, 'can_manage', app.org_private_can(p_center, 'matching.manage'));
end $$;

create or replace function app.match_claims_list(p_center uuid, p_filter text default 'open', p_limit int default 50,
                                                 p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_filter text := case when p_filter in ('open', 'ended') then p_filter else 'open' end;
        v_today date; v_amounts boolean; v_total int; v_rows jsonb; v_states text[];
begin
  perform app._match_org_reader_or_raise(p_center);
  v_today := app._match_today(p_center);
  v_amounts := app.match_amounts_can(p_center);
  v_states := case when v_filter = 'open' then array['asked', 'requested', 'verified']
                   else array['received', 'declined', 'expired', 'withdrawn'] end;
  with base as (
    select c.*, pay.household_id, pay.received_on as gift_on, greatest(pay.amount_cents - pay.refunded_cents, 0)::bigint as gift_cents,
           m.company_name, m.portal, m.portal_url, m.deadline_kind, m.deadline_months, m.deadline_month, m.deadline_day
      from app.match_claims c
      join app.payments pay on pay.id = c.payment_id
      join app.match_programs m on m.id = c.program_id
     where c.center_id = p_center and c.state = any (v_states) and not app.person_is_minor(c.person_id)
  ),
  pg as (select * from base order by state_at desc, id
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', x.id, 'state', x.state, 'state_at', x.state_at, 'received_on', x.received_on, 'note', x.note,
             'person', jsonb_build_object('id', x.person_id, 'name', app._care_person_name(x.person_id)),
             'household', app._care_household_head(x.household_id),
             'program', jsonb_build_object('id', x.program_id, 'company_name', x.company_name, 'portal', x.portal, 'portal_url', x.portal_url),
             'gift', jsonb_build_object('payment_id', x.payment_id, 'received_on', x.gift_on,
                                        'amount_cents', case when v_amounts then x.gift_cents end),
             'deadline_on', app._match_deadline(x.deadline_kind, x.deadline_months, x.deadline_month, x.deadline_day, x.gift_on))
             order by x.state_at desc, x.id) from pg x), '[]'::jsonb)
    into v_total, v_rows;
  perform app.log_private_read(p_center, 'matching', 'claims', jsonb_array_length(v_rows));
  return jsonb_build_object('filter', v_filter, 'total', v_total, 'rows', v_rows, 'amounts', v_amounts, 'today', v_today,
                            'can_manage', app.org_private_can(p_center, 'matching.manage'));
end $$;

-- One adult's gifts that can be matched (the last two years), each with its claim if there is one, and the program their employer
-- on file is linked to: what the office needs to record a match somebody already got. The organization's own readers; logged.
create or replace function app.match_person_gifts(p_center uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_today date; v_amounts boolean; v_program jsonb; v_rows jsonb; v_household uuid;
begin
  perform app._match_org_reader_or_raise(p_center);
  if not exists (select 1 from app.people x where x.id = p_person and x.center_id = p_center) or app.person_is_minor(p_person) then
    raise exception 'That person was not found.' using errcode = '22023';
  end if;
  v_today := app._match_today(p_center);
  v_amounts := app.match_amounts_can(p_center);
  select jsonb_build_object('id', m.id, 'company_name', m.company_name, 'portal', m.portal)
    into v_program
    from app.person_match_programs l cross join lateral app._match_program_current(l.program_id) m
   where l.person_id = p_person and l.center_id = p_center;
  select hm.household_id into v_household from app.household_members hm
   where hm.person_id = p_person and hm.left_at is null order by hm.is_primary desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', g.payment_id, 'received_on', g.received_on,
           'amount_cents', case when v_amounts then g.donation_cents end,
           'claim', (select jsonb_build_object('id', c.id, 'state', c.state) from app.match_claims c
                      where c.payment_id = g.payment_id and c.center_id = p_center order by c.created_at desc limit 1))
           order by g.received_on desc), '[]'::jsonb)
    into v_rows
    from app._match_gifts(p_center) g
   where g.person_id = p_person and g.received_on > v_today - 730;
  perform app.log_private_read(p_center, 'matching', 'person_gifts', jsonb_array_length(v_rows));
  return jsonb_build_object('person', jsonb_build_object('id', p_person, 'name', app._care_person_name(p_person)),
                            'household', case when v_household is null then null else app._care_household_head(v_household) end,
                            'program', v_program, 'gifts', v_rows, 'amounts', v_amounts, 'today', v_today,
                            'can_manage', app.org_private_can(p_center, 'matching.manage'));
end $$;

revoke execute on function app.match_catch_list(uuid, text, int, int), app.match_claims_list(uuid, text, int, int),
  app.match_person_gifts(uuid, uuid) from public, anon;
grant execute on function app.match_catch_list(uuid, text, int, int), app.match_claims_list(uuid, text, int, int),
  app.match_person_gifts(uuid, uuid) to authenticated, service_role;

-- ── The screens (the activity catalog lists every tab: 0620) ─────────────────
select app.activity_register('screen:/giving/matching/catch', 'screen', 'portal', 'Gift matching: the members to catch');
select app.activity_register('screen:/giving/matching/claims', 'screen', 'portal', 'Gift matching: claims');
select app.activity_register('screen:/giving/matching/library', 'screen', 'portal', 'Gift matching: how to claim');
