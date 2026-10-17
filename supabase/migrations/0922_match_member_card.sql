-- 0922 · CatchTheMatch Phase 1, piece 2: the member's side, "Does your employer match?" in the member app (docs/CATCH_THE_MATCH.md
-- section 13, slice 6; owner request of 2026-10-17). NEEDS OWNER OK: RLS, personal data.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0759 already lets a member add, change and remove their employer, with their consent, from the app (app.my_match_employer,
--   app.set_my_match_employer, app.remove_my_match_employer). This adds what the member sees and does next:
--     app.my_match_card(center)                the member's own card: the employer they put on file (only if THIS sign-in consented to it,
--                                              0759's rule), the steps for that employer from the library, the organization's registered
--                                              name and tax ID the steps ask for, the member's OWN gifts that can still be claimed (the
--                                              day and the last day to ask, never an amount), and their OWN claims with where each stands.
--     app.report_my_match_request(center)      "I have asked my employer": the member's gifts that can still be claimed become claims
--                                              "requested" (a gift staff already marked "asked" moves to "requested"), marked as reported
--                                              by the member (requested_by_member_at) so staff see it came from the member.
--     app.undo_my_match_request(center, claim) takes it back, while staff have not moved it on.
--   AS FAR AS THE MEMBER IS CONCERNED: own data only (the sign-in's own person, which the existing functions resolve), adults only (a
--   sign-in whose person is under 18 gets nothing), nothing about anyone else, no amount anywhere, and nothing when CatchTheMatch is off.
--   A platform admin is a person like any other here: no platform-admin branch, so they see only their own card in a community where
--   they are a member. The member's own reads are not staff reads, so they are not in the organization's read log; every change is
--   audited (the private audit of app.match_claims).
--   THE STEPS FOR THE EMPLOYER. The directory entry staff confirmed for this person (0767); else the one active entry whose name (or one
--   of the names it goes by) is exactly the employer's, by app.employer_name_key. Two entries with the same name (two countries) show
--   nothing rather than guess. Public facts only, like the library itself.
--   STAFF SEE IT: app.match_claims gains requested_by_member_at; app.match_claims_list shows it ("the member reported this").
--   Gifts of a person: app._match_gifts_of is app._match_gifts (0886) for one person, without reading the whole community on every
--   member's visit; a database test keeps the two equal.
set client_min_messages = warning;

alter table app.match_claims add column if not exists requested_by_member_at timestamptz;
comment on column app.match_claims.requested_by_member_at is 'When the member said, in the app, that they asked their employer (0922). Set only by app.report_my_match_request; null for a claim staff moved to requested themselves.';

-- ── One person's gifts, by the same rule as app._match_gifts (0886) ──────────
create or replace function app._match_gifts_of(p_center uuid, p_person uuid)
returns table (payment_id uuid, person_id uuid, household_id uuid, received_on date, donation_cents bigint)
language sql stable security definer set search_path = app, public, extensions as $$
  with pay as (
    select p.id, p.payer_person_id, p.household_id, p.received_on, greatest(p.amount_cents - p.refunded_cents, 0)::bigint as net
      from app.payments p
     where p.center_id = p_center and p.payer_person_id = p_person
       and p.status in ('captured', 'settled', 'partially_refunded')
       and not p.is_opening_balance and not p.is_historical
       and not app.person_is_minor(p.payer_person_id)
  ),
  fee as (
    select al.payment_id, sum(al.amount_cents)::bigint as fee
      from app.payment_allocations al join app.pledges pl on pl.id = al.pledge_id
     where al.center_id = p_center and pl.source in ('membership_fee', 'pathshala_fee', 'store')
       and al.payment_id in (select id from pay)
     group by al.payment_id
  )
  select pay.id, pay.payer_person_id, pay.household_id, pay.received_on, pay.net - least(coalesce(fee.fee, 0), pay.net)
    from pay left join fee on fee.payment_id = pay.id
   where pay.net - least(coalesce(fee.fee, 0), pay.net) > 0
$$;
revoke execute on function app._match_gifts_of(uuid, uuid) from public, anon, authenticated;

-- ── The directory entry for a member's employer ──────────────────────────────
create or replace function app._match_member_program(p_center uuid, p_person uuid, p_employer text) returns uuid
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v uuid; n int; ids uuid[];
begin
  select g.id into v
    from app.person_match_programs l cross join lateral app._match_program_current(l.program_id) g
   where l.person_id = p_person and l.center_id = p_center and g.status = 'active' and g.gift_match;
  if v is not null then return v; end if;
  select count(distinct g.id), array_agg(distinct g.id) into n, ids
    from app.match_program_names nm
    cross join lateral app._match_program_current(nm.program_id) g
   where nm.name_key = app.employer_name_key(p_employer) and nm.retired_at is null and g.status = 'active' and g.gift_match;
  return case when n = 1 then ids[1] end;
end $$;
revoke execute on function app._match_member_program(uuid, uuid, text) from public, anon, authenticated;

-- The member's gifts for a program that can still be claimed or already have a claim: the day, the last day to ask, the claim if any.
create or replace function app._match_member_gifts(p_center uuid, p_person uuid, p_program uuid)
returns table (payment_id uuid, received_on date, deadline_on date, claim_id uuid, claim_state text)
language sql stable security definer set search_path = app, public, extensions as $$
  select gi.payment_id, gi.received_on,
         app._match_deadline(g.deadline_kind, g.deadline_months, g.deadline_month, g.deadline_day, gi.received_on),
         c.id, c.state
    from app._match_program_current(p_program) g
    join app._match_gifts_of(p_center, p_person) gi
      on (g.min_gift_cents is null or gi.donation_cents >= g.min_gift_cents) and gi.received_on > app._match_today(p_center) - 730
    left join lateral (select x.id, x.state from app.match_claims x
                        where x.payment_id = gi.payment_id and x.program_id = g.id and x.center_id = p_center limit 1) c on true
$$;
revoke execute on function app._match_member_gifts(uuid, uuid, uuid) from public, anon, authenticated;

-- ── The member's card ────────────────────────────────────────────────────────
create or replace function app.my_match_card(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_person uuid := app._my_person_or_raise(p_center);
  v_card jsonb := app._match_employer_card(v_person, auth.uid());
  v_employer text := v_card ->> 'employer';
  v_prog uuid; v_today date := app._match_today(p_center); v_program jsonb; v_process jsonb; v_org jsonb; v_claims jsonb; v_gifts jsonb;
begin
  -- Not an adult, or CatchTheMatch is off: nothing but the fact (the app hides the card).
  if not coalesce((v_card ->> 'is_adult')::boolean, false) or not coalesce((v_card ->> 'matching_on')::boolean, false) then
    return v_card || jsonb_build_object('program', null, 'process', null, 'org', null, 'claims', '[]'::jsonb, 'gifts', '[]'::jsonb, 'today', v_today);
  end if;
  select jsonb_build_object('name', c.name, 'legal_name', o.legal_name, 'ein', o.ein) into v_org
    from app.centers c left join app.org_profiles o on o.center_id = c.id where c.id = p_center;
  if v_employer is not null then
    v_prog := app._match_member_program(p_center, v_person, v_employer);
  end if;
  if v_prog is not null then
    select jsonb_build_object('id', g.id, 'company_name', g.company_name, 'portal', g.portal, 'portal_url', g.portal_url, 'deadline_note', g.deadline_note)
      into v_program from app._match_program_current(v_prog) g;
    select jsonb_build_object('summary', pr.summary, 'who_submits', pr.who_submits, 'steps', to_jsonb(pr.steps), 'documents', to_jsonb(pr.documents),
                              'links', pr.links, 'typical_days', pr.typical_days, 'tips', pr.tips)
      into v_process
      from app.match_processes pr
     where pr.program_id in (select y.id from app.match_programs y where y.id = v_prog or y.merged_into = v_prog)
     order by (pr.program_id = v_prog) desc limit 1;
    -- Gifts that can still be claimed (no claim yet, or staff asked and the member has not reported): the day and the last day to ask.
    select coalesce(jsonb_agg(jsonb_build_object('received_on', x.received_on, 'deadline_on', x.deadline_on) order by x.received_on desc), '[]'::jsonb)
      into v_gifts
      from app._match_member_gifts(p_center, v_person, v_prog) x
     where (x.claim_id is null or x.claim_state = 'asked') and (x.deadline_on is null or x.deadline_on >= v_today);
  else
    v_gifts := '[]'::jsonb;
  end if;
  -- The member's OWN claims, whichever program: where each stands. No amount, no household, nobody else. Like the employer itself (0759) they
  -- show only to the sign-in that consented to the employer on file: a claim names the employer's program.
  v_claims := '[]'::jsonb;
  if v_employer is not null then
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'state', c.state, 'state_at', c.state_at, 'company_name', m.company_name,
           'received_on', pay.received_on, 'deadline_on', app._match_deadline(m.deadline_kind, m.deadline_months, m.deadline_month, m.deadline_day, pay.received_on),
           'reported_by_member', c.requested_by_member_at is not null,
           'can_undo', c.state = 'requested' and c.requested_by_member_at is not null)
         order by c.state_at desc, c.id), '[]'::jsonb)
    into v_claims
    from app.match_claims c
    join app.match_programs m on m.id = c.program_id
    join app.payments pay on pay.id = c.payment_id
   where c.person_id = v_person and c.center_id = p_center;
  end if;
  return v_card || jsonb_build_object('program', v_program, 'process', v_process, 'org', v_org, 'claims', v_claims, 'gifts', v_gifts, 'today', v_today);
end $$;

-- ── "I have asked my employer" ───────────────────────────────────────────────
create or replace function app.report_my_match_request(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_person uuid := app._my_person_or_raise(p_center);
  v_card jsonb := app._match_employer_card(v_person, auth.uid());
  v_employer text := v_card ->> 'employer'; v_prog uuid; v_today date := app._match_today(p_center); r record; v_n int := 0;
begin
  if not coalesce((v_card ->> 'is_adult')::boolean, false) then
    raise exception 'Gift matching is for adults only.' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce((v_card ->> 'matching_on')::boolean, false) then
    raise exception '% is not on for this community.', app._module_label(p_center, 'matching') using errcode = 'insufficient_privilege';
  end if;
  if v_employer is null then
    raise exception 'Add your employer first. It is on file only with your consent.' using errcode = '22023';
  end if;
  v_prog := app._match_member_program(p_center, v_person, v_employer);
  if v_prog is null then
    raise exception 'We do not have the steps for your employer yet, so there is nothing to report. Your organization can add them.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app.report_my_match_request:' || v_person::text, 0));
  perform app.set_audit_context('The member said they asked their employer to match their gifts');
  for r in select * from app._match_member_gifts(p_center, v_person, v_prog) x
            where (x.claim_id is null or x.claim_state = 'asked') and (x.deadline_on is null or x.deadline_on >= v_today)
  loop
    insert into app.match_claims (center_id, person_id, program_id, payment_id, state, state_by, created_by, requested_by_member_at)
    values (p_center, v_person, v_prog, r.payment_id, 'requested', auth.uid(), auth.uid(), now())
    on conflict (payment_id, program_id) do update
      set state = 'requested', state_at = now(), state_by = auth.uid(), requested_by_member_at = now()
      where app.match_claims.state = 'asked';
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'You have no gift that can still be claimed. If you already said you asked, it is under your requests.' using errcode = '22023';
  end if;
  return jsonb_build_object('requested', v_n);
end $$;

create or replace function app.undo_my_match_request(p_center uuid, p_claim uuid) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid := app._my_person_or_raise(p_center); c app.match_claims;
begin
  if not app._org_private_module_on(p_center, 'matching') then
    raise exception '% is not on for this community.', app._module_label(p_center, 'matching') using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.match_claims where id = p_claim and person_id = v_person and center_id = p_center for update;
  if c.id is null then raise exception 'That request was not found.' using errcode = '22023'; end if;
  if c.state <> 'requested' or c.requested_by_member_at is null then
    raise exception 'Your organization has already moved this on, so it cannot be taken back here. Ask them.' using errcode = '22023';
  end if;
  perform app.set_audit_context('The member took back their request');
  -- A claim the member's report created disappears; one staff had already asked about goes back to asked.
  if c.created_by = auth.uid() and c.asked_by_message_at is null then
    delete from app.match_claims where id = c.id;
  else
    update app.match_claims set state = 'asked', state_at = now(), state_by = auth.uid(), requested_by_member_at = null where id = c.id;
  end if;
  return true;
end $$;

-- ── Staff see it came from the member (0921's body plus the one column) ──────
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
             'asked_by_message_at', x.asked_by_message_at, 'requested_by_member_at', x.requested_by_member_at,
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

revoke execute on function app.my_match_card(uuid), app.report_my_match_request(uuid), app.undo_my_match_request(uuid, uuid) from public, anon;
grant execute on function app.my_match_card(uuid), app.report_my_match_request(uuid), app.undo_my_match_request(uuid, uuid) to authenticated, service_role;
