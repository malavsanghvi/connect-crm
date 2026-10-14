-- 0796 + 0797 (B88, docs/DEMO_ROLE_WORK.md): in the faith demo community every one of the 26 roles has something real waiting right after
-- signing in. The demo is created, every demo person gets their sign-in and role (app.demo_signin_setup + app.set_demo_signin, which link
-- them the way app.demo_link_personas does), and each role is then asked the same questions the portal's Home "My tasks" and the screens one
-- click away ask, as that person (their token claims, the `authenticated` database role, row level security on):
--   A. who is who: the owner, the scopes     B. each role's work, found through its own door (the permission, or the role, that opens the screen)
--   C. the roles that have no portal screen at all (their work is in the member app or the event-day app) are listed and checked, not skipped
--   D. what a child never sees     E. a reset keeps all of it      F. the work is still there after a reset, for every role
-- Every failure is collected and reported together, so one run names everything that is missing.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- Sign in as the demo person of a role: their own token, the `authenticated` role, so row level security applies.
create or replace function pg_temp.as_role(p_role text) returns void language plpgsql as $$
declare v_user uuid;
begin
  reset role;
  select a.user_id into v_user from app.demo_personas d join app.demo_auth_users a on a.email = d.email
   where d.center_id = current_setting('t.center')::uuid and d.role_key = p_role;
  if v_user is null then raise exception 'FAIL: the demo person of role % has no sign-in', p_role; end if;
  perform pg_temp.claims(v_user::text, false);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;

\set admin '''18400000-0000-4000-8000-0000000000a1'''
select pg_temp.as_none();
insert into auth.users (id, email) values (:admin, 'admin184@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;
select pg_temp.claims(:admin, true);
select (app.create_demo_community('faith'))->>'center_id' as fc \gset
select (app.create_demo_community('neutral'))->>'center_id' as nc \gset
select set_config('t.center', :'fc', false);
select app.demo_signin_setup('Set up the demo sign-ins for the role-work test') as setup \gset
select app.set_demo_signin(true, 'Switch the demo on for the role-work test') as sw \gset
select app.demo_id(:'fc', 'ev:tapasvi') as ev_tap, app.demo_id(:'fc', 'class:j2') as cls_j2, app.demo_id(:'fc', 'zone:north') as zone_n,
       app.demo_id(:'fc', 'boli:diwali') as boli_d \gset

-- ══ A. Who is who ═══════════════════════════════════════════════════════════
select pg_temp.assert((:'setup'::jsonb ->> 'created')::int = 47 and jsonb_array_length(:'setup'::jsonb -> 'refused') = 0,
  'A · every demo person (26 of the faith community and 21 of the other) got a sign-in');
select pg_temp.assert((select count(*) = 26 from app.demo_personas p join app.demo_auth_users a on a.email = p.email where p.center_id = :'fc')
                      and (select count(*) = 26 from app.role_grants g where g.center_id = :'fc' and g.status = 'active'
                                and g.user_id in (select a.user_id from app.demo_auth_users a)),
  'A · and an active role each (they are linked: an account, a membership of their person, the role)');
select pg_temp.assert((select count(*) = 26 from app.demo_personas where center_id = :'fc' and scope_kind in ('center', 'event', 'class', 'zone')),
  'A · every role is held at the scope the portal''s Roles screen would choose: the whole community, one event, one class or one zone');
select pg_temp.assert((select count(*) = 3 from app.demo_personas where center_id = :'fc' and scope_kind = 'event' and role_key in ('event_lead', 'checkin_volunteer', 'boli_recorder')
                          and scope_id = :'ev_tap')
                      and (select count(*) = 1 from app.demo_personas where center_id = :'fc' and role_key = 'teacher' and scope_kind = 'class' and scope_id = :'cls_j2')
                      and (select count(*) = 1 from app.demo_personas where center_id = :'fc' and role_key = 'zone_lead' and scope_kind = 'zone' and scope_id = :'zone_n'),
  'A · the event lead, the check-in volunteer and the boli recorder hold the Tapasvi event, the teacher class 2, the zone lead the north zone');
select pg_temp.as_role('center_admin');
select pg_temp.assert(app.is_center_owner(:'fc'), 'A · the demo administrator is the owner, so every queue below that she can act on is hers too');
select pg_temp.as_none();

-- ══ B. Each role's work ═════════════════════════════════════════════════════
-- door: how the person reaches it in the portal. perm:<key> = they hold that permission center-wide; role:<key> = they hold that role in any scope;
-- none = they hold no permission the portal opens a screen with (none+kitchen.view: only the kitchen's, which opens no tab).
create temp table work (role_key text not null, what text not null, door text not null, q text not null, min_n bigint not null default 1);
insert into pg_temp.work (role_key, what, door, q, min_n)
select v.role_key, v.what, v.door, format(v.q, :'fc', :'ev_tap', :'cls_j2', :'zone_n', :'boli_d'), v.min_n
  from (values
  -- ── The community's administrator (also its owner, so she holds every permission) ──
  ('center_admin', 'data requests to answer (Home task "Privacy")', 'perm:privacy.manage',
   $q$select count(*) from app.data_requests where center_id = %1$L and status in ('open', 'in_progress')$q$, 2),
  ('center_admin', 'volunteers missing a signed waiver for an event in the next 14 days (Home task "Event")', 'perm:events.manage',
   $q$select count(*) from app.volunteer_assignments a join app.volunteer_shifts s on s.id = a.shift_id join app.events e on e.id = s.event_id
       where e.center_id = %1$L and e.status in ('published', 'rsvp_closed', 'live') and e.starts_at >= now() and e.starts_at <= now() + interval '14 days'
         and a.status in ('assigned', 'confirmed') and a.waiver_consent_id is null$q$, 1),
  ('center_admin', 'bank lines to match (the owner can act on the treasurer''s queue)', 'perm:giving.view',
   $q$select count(*) from app.bank_transactions where center_id = %1$L and status in ('unmatched', 'suggested') and amount_cents > 0$q$, 4),
  -- ── Executive committee and board ──
  ('executive_committee', 'membership applications to decide, one of them a life membership waiting for the executive committee (Home task "Membership")', 'perm:people.approve',
   $q$select count(*) from app.membership_applications where center_id = %1$L and status = 'awaiting_ec'$q$, 1),
  ('executive_committee', 'membership applications waiting in all', 'perm:people.approve',
   $q$select count(*) from app.membership_applications where center_id = %1$L and status in ('awaiting_center', 'awaiting_ec')$q$, 2),
  ('executive_viewer', 'people coming to the next event (Home "At a glance"), read only', 'perm:events.view',
   $q$select count(*) from app.attendees where event_id = %2$L and status in ('rsvpd', 'confirmed', 'attended')$q$, 5),
  ('executive_viewer', 'bolis open to read (Bolis, read only)', 'perm:bolis.view',
   $q$select count(*) from app.bolis where center_id = %1$L and status = 'open'$q$, 2),
  -- ── Finance ──
  ('treasurer', 'a write-off a colleague asked for, waiting for the second approver (Home task "Write-off")', 'perm:giving.approve',
   $q$select count(*) from app.pledges where center_id = %1$L and written_off_by is not null and written_off_by <> auth.uid()
        and written_off_second_approver is null and status in ('open', 'partially_paid')$q$, 1),
  ('treasurer', 'bank lines to match (Home task "Deposits")', 'perm:giving.record_offline',
   $q$select count(*) from app.bank_transactions where center_id = %1$L and status in ('unmatched', 'suggested') and amount_cents > 0$q$, 4),
  ('treasurer', 'a month still to close (Accounting > Month-end close)', 'perm:accounting.close',
   $q$select (not exists (select 1 from app.accounting_periods where center_id = %1$L and status = 'closed'))::int$q$, 1),
  ('finance_volunteer', 'bank lines to match (Home task "Deposits")', 'perm:giving.record_offline',
   $q$select count(*) from app.bank_transactions where center_id = %1$L and status in ('unmatched', 'suggested') and amount_cents > 0$q$, 4),
  ('finance_volunteer', 'open pledges a gift can be recorded against (Giving > Payments)', 'perm:giving.record_offline',
   $q$select count(*) from app.pledges where center_id = %1$L and status in ('open', 'partially_paid')$q$, 3),
  -- ── People, religion, communications, content, privacy, volunteers ──
  ('membership_coordinator', 'membership applications to decide (Home task "Membership")', 'perm:people.approve',
   $q$select count(*) from app.membership_applications where center_id = %1$L and status in ('awaiting_center', 'awaiting_ec')$q$, 2),
  ('membership_coordinator', 'a family change request to decide (People > Family change requests)', 'perm:people.manage',
   $q$select count(*) from app.household_change_requests where center_id = %1$L and status = 'open'$q$, 1),
  ('religious_coordinator', 'a religious text waiting for approval (Home task "Content")', 'perm:content.approve',
   $q$select count(*) from app.content_items where center_id = %1$L and status = 'in_review'$q$, 1),
  ('religious_coordinator', 'a digital boli that closes within 7 days (Home task "Bolis")', 'perm:bolis.manage',
   $q$select count(*) from app.bolis where center_id = %1$L and status = 'open' and kind = 'digital' and closes_at >= now() and closes_at <= now() + interval '7 days'$q$, 1),
  ('communications_officer', 'a message waiting for approval (Home task "Newsletter")', 'perm:comms.approve',
   $q$select count(*) from app.comms_campaigns where center_id = %1$L and status = 'pending_approval'$q$, 1),
  ('communications_officer', 'member questions nobody has taken (Home task "Inbox")', 'perm:comms.inbox',
   $q$select count(*) from app.threads where center_id = %1$L and status = 'open' and assignee_user is null$q$, 5),
  ('communications_officer', 'WhatsApp join requests (Home task "WhatsApp")', 'perm:comms.send',
   $q$select count(*) from app.whatsapp_join_requests where center_id = %1$L and status = 'pending'$q$, 2),
  ('communications_officer', 'a draft message to finish and send (Communications > Newsletters)', 'perm:comms.send',
   $q$select count(*) from app.comms_campaigns where center_id = %1$L and status = 'draft'$q$, 1),
  ('content_editor', 'drafts to write and send for approval (Content > Library)', 'perm:content.draft',
   $q$select count(*) from app.content_items where center_id = %1$L and status = 'draft'$q$, 2),
  ('privacy_officer', 'data requests in progress (Home task "Privacy")', 'perm:privacy.manage',
   $q$select count(*) from app.data_requests where center_id = %1$L and status in ('open', 'in_progress')$q$, 2),
  ('volunteer_coordinator', 'people who asked to volunteer (Events > Volunteers)', 'perm:volunteers.manage',
   $q$select count(*) from app.volunteer_interests where center_id = %1$L and status = 'interested'$q$, 1),
  ('volunteer_coordinator', 'a background check that was asked for and has not come back (Events > Volunteers > Background checks)', 'perm:safety.view',
   $q$select count(*) from app.background_checks where center_id = %1$L and status = 'requested'$q$, 1),
  ('volunteer_coordinator', 'shifts with places still free (the Tapasvi event)', 'perm:volunteers.view',
   $q$select count(*) from app.volunteer_shifts s where s.center_id = %1$L
        and coalesce(s.capacity, 0) > (select count(*) from app.volunteer_assignments a where a.shift_id = s.id and a.status in ('assigned', 'confirmed'))$q$, 2),
  -- ── Event day ──
  ('event_lead', 'people to check in at the Tapasvi event', 'none',
   $q$select count(*) from app.attendees where event_id = %2$L and checked_in_at is null and status in ('rsvpd', 'confirmed')$q$, 5),
  ('event_lead', 'open actions on the event''s checklist', 'none',
   $q$select count(*) from app.actions where event_id = %2$L and state not in ('completed', 'removed')$q$, 3),
  ('event_lead', 'the event''s live numbers (people confirmed)', 'none',
   $q$select coalesce(max(confirmed), 0) from app.event_live_stats(%2$L)$q$, 1),
  ('checkin_volunteer', 'people to check in at the Tapasvi event', 'none',
   $q$select count(*) from app.attendees where event_id = %2$L and checked_in_at is null and status in ('rsvpd', 'confirmed')$q$, 5),
  ('checkin_volunteer', 'their own shift at the door', 'none',
   $q$select count(*) from app.volunteer_assignments where status in ('assigned', 'confirmed')$q$, 1),
  ('kitchen_lead', 'the store orders to prepare (prep list)', 'none+kitchen.view',
   $q$select count(*) from app.store_order_lines l join app.store_orders o on o.id = l.order_id where o.center_id = %1$L and o.status in ('placed', 'preparing', 'ready')$q$, 2),
  ('kitchen_lead', 'the headcount for the Tapasvi event', 'none+kitchen.view',
   $q$select coalesce(max(confirmed), 0) from app.event_live_stats(%2$L)$q$, 1),
  ('boli_recorder', 'an in-person boli to record at the Tapasvi event', 'none',
   $q$select count(*) from app.bolis where event_id = %2$L and kind = 'in_person' and status = 'open'$q$, 1),
  -- ── Store ──
  ('store_lead', 'items at or under their reorder level (Home task "Inventory")', 'perm:store.manage',
   $q$select count(*) from app.store_items where center_id = %1$L and status = 'active' and track_inventory and low_stock_threshold is not null and stock_on_hand <= low_stock_threshold$q$, 2),
  ('store_lead', 'orders to prepare and hand out (My Store > Orders by pickup)', 'perm:store.manage',
   $q$select count(*) from app.store_orders where center_id = %1$L and status in ('placed', 'preparing', 'ready')$q$, 2),
  ('store_pickup', 'orders waiting for pickup (My Store > Orders by pickup)', 'perm:store.pickup',
   $q$select count(*) from app.store_orders where center_id = %1$L and status in ('placed', 'preparing', 'ready')$q$, 2),
  -- ── Pathshala ──
  ('pathshala_principal', 'a registration waiting to be placed in a class (Pathshala > Enrollments)', 'perm:pathshala.manage',
   $q$select coalesce((app.pathshala_task_counts(%1$L) ->> 'to_place')::bigint, 0)$q$, 1),
  ('pathshala_principal', 'a learner on a waitlist (Home task "Pathshala")', 'perm:pathshala.manage',
   $q$select count(*) from app.pathshala_enrollments where center_id = %1$L and status = 'waitlisted'$q$, 1),
  ('pathshala_committee', 'event actions overdue, due within 3 days or nobody''s yet (Pathshala > Committee)', 'perm:pathshala.view',
   $q$select count(*) from app.actions where center_id = %1$L and not is_idea and state not in ('completed', 'removed') and (owner_person_id is null or due_on <= current_date + 3)$q$, 3),
  ('teacher', 'the students of class 2 (Pathshala > My classes)', 'role:teacher',
   $q$select count(*) from app.pathshala_enrollments where class_id = %3$L and status in ('placed', 'active')$q$, 3),
  ('teacher', 'attendance not taken for the latest Sunday', 'role:teacher',
   $q$select (not exists (select 1 from app.pathshala_sessions s where s.class_id = %3$L and s.held_on = current_date - extract(dow from current_date)::int))::int$q$, 1),
  -- ── Zone ──
  ('zone_lead', 'questions in the north zone''s inbox', 'none',
   $q$select count(*) from app.threads t join app.inboxes i on i.id = t.inbox_id where i.zone_id = %4$L and t.status = 'open'$q$, 2),
  ('zone_lead', 'the families of the north zone (their contact details)', 'none',
   $q$select count(*) from app.households where zone_id = %4$L$q$, 4),
  -- ── Families and members: the member app is their surface ──
  ('community_member', 'her membership application, waiting for her reference to answer', 'none',
   $q$select count(*) from app.my_membership_application(%1$L) where status = 'awaiting_reference'$q$, 1),
  ('community_member', 'an open pledge to pay', 'none',
   $q$select count(*) from app.pledges where center_id = %1$L and status in ('open', 'partially_paid')$q$, 1),
  ('community_member', 'a parking shift to confirm', 'none',
   $q$select count(*) from app.volunteer_assignments where status = 'assigned'$q$, 1),
  ('community_member', 'events to RSVP to', 'none',
   $q$select count(*) from app.events where center_id = %1$L and status = 'published' and starts_at > now()$q$, 2),
  ('community_member', 'a notice she has not read', 'none',
   $q$select count(*) from app.alerts where center_id = %1$L and starts_at <= now() and (ends_at is null or ends_at > now())$q$, 1),
  ('membership_reference', 'an application that names her, waiting for her answer (app.my_reference_requests)', 'none',
   $q$select count(*) from app.my_reference_requests()$q$, 1),
  ('primary_adult', 'an open family pledge', 'none',
   $q$select count(*) from app.pledges where center_id = %1$L and status in ('open', 'partially_paid')$q$, 1),
  ('primary_adult', 'the family''s membership application, waiting for the membership team', 'none',
   $q$select count(*) from app.my_membership_application(%1$L) where status = 'awaiting_center'$q$, 1),
  ('primary_adult', 'a digital boli open for pledges', 'none',
   $q$select count(*) from app.bolis where id = %5$L and status = 'open'$q$, 1),
  ('adult_member', 'an open family pledge', 'none',
   $q$select count(*) from app.pledges where center_id = %1$L and status in ('open', 'partially_paid')$q$, 1),
  ('adult_member', 'a parking shift to confirm', 'none',
   $q$select count(*) from app.volunteer_assignments where status = 'assigned'$q$, 1),
  ('child', 'events to see', 'none',
   $q$select count(*) from app.events where center_id = %1$L and status = 'published' and starts_at > now()$q$, 2),
  ('child', 'a Pathshala registration for her level, waiting to be placed', 'none',
   $q$select count(*) from app.pathshala_enrollments where center_id = %1$L and status = 'requested'$q$, 1),
  ('child', 'a notice to read', 'none',
   $q$select count(*) from app.alerts where center_id = %1$L and starts_at <= now() and (ends_at is null or ends_at > now())$q$, 1)
) v(role_key, what, door, q, min_n);

select pg_temp.assert((select count(distinct role_key) = 26 from pg_temp.work)
                      and not exists (select 1 from app.demo_personas d where d.center_id = :'fc' and d.role_key not in (select role_key from pg_temp.work)),
  'B · every one of the 26 roles has at least one question below');

-- Ask every question as the person, through their own door; collect what is missing and say it all at once.
create or replace function pg_temp.run_work(p_when text) returns void language plpgsql as $$
declare w jsonb := (select jsonb_agg(to_jsonb(x) order by x.role_key, x.what) from pg_temp.work x);
        r record; c uuid := current_setting('t.center')::uuid; n bigint; v_ok boolean; v_fail text := ''; v_roles text[] := '{}'; v_all text[];
begin
  select array_agg(distinct d.role_key order by d.role_key) into v_all from app.demo_personas d where d.center_id = c;
  for r in select e.value as x from jsonb_array_elements(w) e loop
    begin
      perform pg_temp.as_role(r.x ->> 'role_key');
      execute r.x ->> 'q' into n;
      if r.x ->> 'door' like 'perm:%' then
        execute format('select app.has_permission(%L, %L)', c, substr(r.x ->> 'door', 6)) into v_ok;
      elsif r.x ->> 'door' like 'role:%' then
        execute format('select exists (select 1 from app.role_grants g where g.user_id = auth.uid() and g.center_id = %L and g.role_key = %L and g.status = ''active'')',
                       c, substr(r.x ->> 'door', 6)) into v_ok;
      else
        -- no permission that opens a portal screen: the person holds nothing center-wide (or only the kitchen's, which opens no tab)
        execute format('select not exists (select 1 from app.role_grants g join app.roles ro on ro.key = g.role_key, jsonb_array_elements_text(ro.permissions) p
                          where g.user_id = auth.uid() and g.center_id = %L and g.status = ''active'' and g.scope_kind in (''center'', ''platform'')
                            and p <> all (%L::text[]))', c, case r.x ->> 'door' when 'none' then '{}' else '{kitchen.view}' end) into v_ok;
      end if;
      reset role;
      if n < (r.x ->> 'min_n')::bigint then
        v_fail := v_fail || format(E'\n  %s: %s: found %s, expected at least %s', r.x ->> 'role_key', r.x ->> 'what', n, r.x ->> 'min_n');
      elsif not coalesce(v_ok, false) then
        v_fail := v_fail || format(E'\n  %s: %s: the door (%s) is not open to them', r.x ->> 'role_key', r.x ->> 'what', r.x ->> 'door');
      else
        v_roles := v_roles || (r.x ->> 'role_key');
        raise notice 'PASS: % · % · % (%)', p_when, r.x ->> 'role_key', r.x ->> 'what', n;
      end if;
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      v_fail := v_fail || format(E'\n  %s: %s: %s', r.x ->> 'role_key', r.x ->> 'what', sqlerrm);
    end;
  end loop;
  reset role;
  if v_fail <> '' then raise exception 'FAIL: % · some roles have nothing (or cannot reach it):%', p_when, v_fail; end if;
  if exists (select 1 from unnest(v_all) a where a <> all (v_roles)) then
    raise exception 'FAIL: % · a role has no passing question: %', p_when, (select string_agg(a, ', ') from unnest(v_all) a where a <> all (v_roles));
  end if;
  raise notice 'PASS: % · all % roles have something waiting', p_when, cardinality(v_all);
end $$;
select pg_temp.run_work('B');
select pg_temp.as_none();

-- ══ C. The roles with no portal screen: said plainly, and checked ═══════════
-- These hold nothing the portal opens a screen with, so Home says "Nothing here for your role" and the navigation shows only Home. Their work above is
-- real and sits in the database, but they do it in the member app (family and members) or the event-day app (event lead, check-in, boli recorder,
-- kitchen lead, zone lead). docs/DEMO_ROLE_WORK.md says what the smallest addition would be.
select pg_temp.assert((select count(distinct role_key) = 10 from pg_temp.work where door like 'none%')
                      and not exists (select 1 from pg_temp.work where door like 'none%'
                                       and role_key not in ('event_lead', 'checkin_volunteer', 'kitchen_lead', 'boli_recorder', 'zone_lead',
                                                            'community_member', 'membership_reference', 'primary_adult', 'adult_member', 'child')),
  'C · exactly these 10 roles have no portal screen: event lead, check-in volunteer, kitchen lead, boli recorder, zone lead, and the five family roles');

-- ══ D. What a child never sees ══════════════════════════════════════════════
select pg_temp.as_role('child');
select pg_temp.assert((select count(*) = 0 from app.pledges where center_id = :'fc') and (select count(*) = 0 from app.payments where center_id = :'fc')
                      and (select count(*) = 0 from app.boli_entries where center_id = :'fc'),
  'D · the child sees no pledge, payment or boli entry of the family (money is for adults)');
select pg_temp.as_none();

-- ══ E. A reset keeps all of it ══════════════════════════════════════════════
select pg_temp.claims(:admin, true);
select app.reset_demo_community(:'fc') as rr \gset
select pg_temp.as_none();
select pg_temp.assert((select count(*) = 26 from app.role_grants g where g.center_id = :'fc' and g.status = 'active' and g.user_id in (select a.user_id from app.demo_auth_users a)),
  'E · after a reset every demo person has their role again');

-- ══ F. And the work is there again, for every role ══════════════════════════
select pg_temp.run_work('F');
select pg_temp.as_none();

-- ══ G. The other demo community (a club that is not faith-based, 21 roles) has the same ══════════════════
-- The questions are the faith community's, minus what a club does not have (bolis, Pathshala). Its event is the spring clean-up day, five days away.
select app.demo_id(:'nc', 'ev:cleanup') as ev_cu, app.demo_id(:'nc', 'zone:north') as zone_nn \gset
select set_config('t.center', :'nc', false);
truncate pg_temp.work;
insert into pg_temp.work (role_key, what, door, q, min_n)
select v.role_key, v.what, v.door, format(v.q, :'nc', :'ev_cu', :'ev_cu', :'zone_nn'), v.min_n
  from (values
  ('center_admin', 'data requests to answer (Home task "Privacy")', 'perm:privacy.manage',
   $q$select count(*) from app.data_requests where center_id = %1$L and status in ('open', 'in_progress')$q$, 2),
  ('center_admin', 'volunteers missing a signed waiver for an event in the next 14 days (Home task "Event")', 'perm:events.manage',
   $q$select count(*) from app.volunteer_assignments a join app.volunteer_shifts s on s.id = a.shift_id join app.events e on e.id = s.event_id
       where e.center_id = %1$L and e.status in ('published', 'rsvp_closed', 'live') and e.starts_at >= now() and e.starts_at <= now() + interval '14 days'
         and a.status in ('assigned', 'confirmed') and a.waiver_consent_id is null$q$, 1),
  ('center_admin', 'bank lines to match', 'perm:giving.view',
   $q$select count(*) from app.bank_transactions where center_id = %1$L and status in ('unmatched', 'suggested') and amount_cents > 0$q$, 4),
  ('executive_committee', 'a membership application waiting for the executive committee (Home task "Membership")', 'perm:people.approve',
   $q$select count(*) from app.membership_applications where center_id = %1$L and status = 'awaiting_ec'$q$, 1),
  ('executive_viewer', 'people coming to the next event (Home "At a glance"), read only', 'perm:events.view',
   $q$select count(*) from app.attendees where event_id = %2$L and status in ('rsvpd', 'confirmed', 'attended')$q$, 5),
  ('treasurer', 'a write-off a colleague asked for, waiting for the second approver (Home task "Write-off")', 'perm:giving.approve',
   $q$select count(*) from app.pledges where center_id = %1$L and written_off_by is not null and written_off_by <> auth.uid()
        and written_off_second_approver is null and status in ('open', 'partially_paid')$q$, 1),
  ('treasurer', 'bank lines to match (Home task "Deposits")', 'perm:giving.record_offline',
   $q$select count(*) from app.bank_transactions where center_id = %1$L and status in ('unmatched', 'suggested') and amount_cents > 0$q$, 4),
  ('finance_volunteer', 'bank lines to match (Home task "Deposits")', 'perm:giving.record_offline',
   $q$select count(*) from app.bank_transactions where center_id = %1$L and status in ('unmatched', 'suggested') and amount_cents > 0$q$, 4),
  ('membership_coordinator', 'membership applications to decide (Home task "Membership")', 'perm:people.approve',
   $q$select count(*) from app.membership_applications where center_id = %1$L and status in ('awaiting_center', 'awaiting_ec')$q$, 2),
  ('membership_coordinator', 'a family change request to decide', 'perm:people.manage',
   $q$select count(*) from app.household_change_requests where center_id = %1$L and status = 'open'$q$, 1),
  ('communications_officer', 'a message waiting for approval (Home task "Newsletter")', 'perm:comms.approve',
   $q$select count(*) from app.comms_campaigns where center_id = %1$L and status = 'pending_approval'$q$, 1),
  ('communications_officer', 'member questions nobody has taken (Home task "Inbox")', 'perm:comms.inbox',
   $q$select count(*) from app.threads where center_id = %1$L and status = 'open' and assignee_user is null$q$, 5),
  ('communications_officer', 'WhatsApp join requests (Home task "WhatsApp")', 'perm:comms.send',
   $q$select count(*) from app.whatsapp_join_requests where center_id = %1$L and status = 'pending'$q$, 2),
  ('content_editor', 'drafts to write and send for approval', 'perm:content.draft',
   $q$select count(*) from app.content_items where center_id = %1$L and status = 'draft'$q$, 2),
  ('privacy_officer', 'data requests in progress (Home task "Privacy")', 'perm:privacy.manage',
   $q$select count(*) from app.data_requests where center_id = %1$L and status in ('open', 'in_progress')$q$, 2),
  ('volunteer_coordinator', 'people who asked to volunteer (Events > Volunteers)', 'perm:volunteers.manage',
   $q$select count(*) from app.volunteer_interests where center_id = %1$L and status = 'interested'$q$, 1),
  ('volunteer_coordinator', 'a background check that was asked for and has not come back', 'perm:safety.view',
   $q$select count(*) from app.background_checks where center_id = %1$L and status = 'requested'$q$, 1),
  ('event_lead', 'people to check in at the clean-up day', 'none',
   $q$select count(*) from app.attendees where event_id = %2$L and checked_in_at is null and status in ('rsvpd', 'confirmed')$q$, 5),
  ('event_lead', 'open actions on the event''s checklist', 'none',
   $q$select count(*) from app.actions where event_id = %2$L and state not in ('completed', 'removed')$q$, 3),
  ('checkin_volunteer', 'people to check in at the clean-up day', 'none',
   $q$select count(*) from app.attendees where event_id = %2$L and checked_in_at is null and status in ('rsvpd', 'confirmed')$q$, 5),
  ('kitchen_lead', 'the store orders to prepare (prep list)', 'none+kitchen.view',
   $q$select count(*) from app.store_order_lines l join app.store_orders o on o.id = l.order_id where o.center_id = %1$L and o.status in ('placed', 'preparing', 'ready')$q$, 2),
  ('store_lead', 'items at or under their reorder level (Home task "Inventory")', 'perm:store.manage',
   $q$select count(*) from app.store_items where center_id = %1$L and status = 'active' and track_inventory and low_stock_threshold is not null and stock_on_hand <= low_stock_threshold$q$, 2),
  ('store_pickup', 'orders waiting for pickup (My Store > Orders by pickup)', 'perm:store.pickup',
   $q$select count(*) from app.store_orders where center_id = %1$L and status in ('placed', 'preparing', 'ready')$q$, 2),
  ('zone_lead', 'questions in the north shore''s inbox', 'none',
   $q$select count(*) from app.threads t join app.inboxes i on i.id = t.inbox_id where i.zone_id = %4$L and t.status = 'open'$q$, 2),
  ('community_member', 'his membership application, waiting for his reference to answer', 'none',
   $q$select count(*) from app.my_membership_application(%1$L) where status = 'awaiting_reference'$q$, 1),
  ('community_member', 'a tools shift to confirm', 'none',
   $q$select count(*) from app.volunteer_assignments where status = 'assigned'$q$, 1),
  ('membership_reference', 'an application that names him, waiting for his answer', 'none',
   $q$select count(*) from app.my_reference_requests()$q$, 1),
  ('primary_adult', 'an open family pledge', 'none',
   $q$select count(*) from app.pledges where center_id = %1$L and status in ('open', 'partially_paid')$q$, 1),
  ('adult_member', 'a welcome shift to confirm', 'none',
   $q$select count(*) from app.volunteer_assignments where status = 'assigned'$q$, 1),
  ('child', 'events to see', 'none',
   $q$select count(*) from app.events where center_id = %1$L and status = 'published' and starts_at > now()$q$, 2)
) v(role_key, what, door, q, min_n);
select pg_temp.assert((select count(distinct role_key) = 21 from pg_temp.work)
                      and not exists (select 1 from app.demo_personas d where d.center_id = :'nc' and d.role_key not in (select role_key from pg_temp.work)),
  'G · every one of the 21 roles of the club has at least one question');
select pg_temp.assert((select count(distinct role_key) = 9 from pg_temp.work where door like 'none%')
                      and not exists (select 1 from pg_temp.work where door like 'none%'
                                       and role_key not in ('event_lead', 'checkin_volunteer', 'kitchen_lead', 'zone_lead',
                                                            'community_member', 'membership_reference', 'primary_adult', 'adult_member', 'child')),
  'G · its roles with no portal screen are the same, minus the boli recorder it does not have (9)');
select pg_temp.run_work('G');
select pg_temp.as_none();
select pg_temp.claims(:admin, true);
select app.reset_demo_community(:'nc') as rn \gset
select pg_temp.as_none();
select pg_temp.run_work('H');
select pg_temp.as_none();
rollback;
