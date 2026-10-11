-- 0673: Platform console reads (BACKLOG B90 phase 4, B83 "Summary reads": the platform inbox and one-page community summary).
-- No table, column or policy changes. Two read-only SQL functions for the Weaver team's console and for Niva when a platform admin
-- asks it ("who is waiting, and what is missing?"):
--
--   app.platform_waiting(limit)              across all communities: go-live requests waiting for an approval, approved ones waiting to be
--                                            moved to production, sandboxes whose go-live checks do not pass, access requests waiting for a
--                                            first look, nonprofit verifications waiting for review, and each community's consent states
--   app.platform_community_summary(center)   one page about one community: what kind it is, how big, how far setup is, which go-live checks
--                                            fail, where its go-live request stands, verification, consent states, modules switched off,
--                                            ways to pay it accepts
--
-- Both are SECURITY INVOKER and refuse anyone who is not a Community Connect platform admin (errcode 42501) before reading anything.
-- They read what the platform pages already read (the same tables, under the same row-level security, and the existing
-- app.platform_onboarding_pipeline() and app.readiness() for the go-live checks); this migration adds no SECURITY DEFINER code and
-- no policy. They return counts, community names and plain sentences only: no member, no learner and no child is named, and no
-- contact detail of an owner or an applicant (the platform pages show those to the team on the screen).
-- "Consent states" = the activity-recording consent the community's own administrator gave (0621), whether it shares with Weaver,
-- and whether the owner has a support-access grant open for the team (0202).
set client_min_messages = warning;

create or replace function app.platform_waiting(p_limit integer default 50)
returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  v jsonb;
  v_limit integer := greatest(coalesce(p_limit, 50), 1);
begin
  if not app.is_platform_admin() then
    raise exception 'The waiting list is for the Community Connect team.' using errcode = '42501';
  end if;
  with pipe as (
    select * from app.platform_onboarding_pipeline()
  ),
  items as (
    select 'golive'::text as kind, 1 as prio, g.center_id, c.slug::text as slug, c.name, g.requested_at as since,
           case when g.first_approver is null
                then 'Asked to go live. It needs a first approval.'
                else 'Asked to go live. It needs a second approval from a different person.' end as detail,
           null::text[] as more
      from app.golive_requests g join app.centers c on c.id = g.center_id
     where g.status = 'requested' and c.sandbox_for is null
    union all
    select 'promote', 2, g.center_id, c.slug::text, c.name, coalesce(g.second_approved_at, g.requested_at),
           'Approved to go live. The sandbox can be moved to production.', null::text[]
      from app.golive_requests g join app.centers c on c.id = g.center_id
     where g.status = 'approved' and c.sandbox_for is null
    union all
    select 'verification', 3, p.center_id, c.slug::text, c.name, p.submitted_at,
           'Sent its nonprofit papers for review.', null::text[]
      from app.org_profiles p join app.centers c on c.id = p.center_id
     where p.verification_status = 'submitted'
    union all
    select 'access_request', 4, null::uuid, null::text, r.org_legal_name, r.created_at,
           concat_ws(', ', coalesce(nullif(r.org_type_label, ''), r.org_type), r.city, r.state),
           null::text[]
      from app.access_requests r
     where r.status = 'new'
    union all
    select 'readiness', 5, pp.center_id, pp.slug, pp.name, pp.stage_since,
           (pp.readiness_total - pp.readiness_ok) || ' of ' || pp.readiness_total || ' go-live checks do not pass yet.',
           pp.blockers[1:3]
      from pipe pp
     where pp.stage <> 'promoted' and pp.readiness_total is not null and pp.readiness_ok < pp.readiness_total
  ),
  ranked as (
    select i.*, row_number() over (order by i.prio, i.since nulls last, i.name) as rn from items i
  ),
  consent as (
    select c.id, c.slug::text as slug, c.name, c.environment,
           case when nullif(c.rules #>> '{activity,consent,at}', '') is null then 'not_agreed'
                when (c.rules #>> '{activity,enabled}') = 'true' then 'on'
                else 'off' end as recording,
           (c.rules #>> '{activity,share_with_weaver}') = 'true' as sharing,
           (select max(sg.expires_at) from app.support_grants sg
             where sg.center_id = c.id and sg.revoked_at is null and sg.expires_at > now()) as support_until
      from app.centers c
     order by c.name, c.id
     limit 200
  )
  select jsonb_build_object(
    'as_of', now(),
    'counts', jsonb_build_object(
      'golive', (select count(*) from items where kind = 'golive')::integer,
      'promote', (select count(*) from items where kind = 'promote')::integer,
      'verification', (select count(*) from items where kind = 'verification')::integer,
      'access_requests', (select count(*) from items where kind = 'access_request')::integer,
      'readiness', (select count(*) from items where kind = 'readiness')::integer,
      'access_requests_waiting_on_them', (select count(*) from app.access_requests r where r.status = 'more_info')::integer),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', r.kind,
               'center_id', r.center_id,
               'slug', r.slug,
               'community', r.name,
               'since', r.since,
               'detail', r.detail,
               'more', coalesce(to_jsonb(r.more), '[]'::jsonb))
             order by r.rn)
        from ranked r
       where r.rn <= v_limit), '[]'::jsonb),
    'consent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'center_id', k.id,
               'slug', k.slug,
               'community', k.name,
               'environment', k.environment,
               'activity_recording', k.recording,
               'shares_with_weaver', k.sharing,
               'support_access_until', k.support_until)
             order by k.name, k.id)
        from consent k), '[]'::jsonb))
    into v;
  return v;
end $$;

create or replace function app.platform_community_summary(p_center uuid)
returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  c app.centers;
  v_ready jsonb;
  v_steps jsonb;
  v_golive jsonb;
  v_verify jsonb;
  v_owner text;
  v_tools integer;
begin
  if not app.is_platform_admin() then
    raise exception 'The community summary is for the Community Connect team.' using errcode = '42501';
  end if;
  select * into c from app.centers where id = p_center;
  if not found then
    return null;
  end if;

  begin
    select jsonb_build_object(
             'passing', count(*) filter (where r.ok),
             'total', count(*),
             'failing', coalesce(jsonb_agg(jsonb_build_object('check', r.title, 'detail', r.detail) order by r.title) filter (where not r.ok), '[]'::jsonb))
      into v_ready
      from app.readiness(p_center) r;
  exception when others then
    v_ready := null;
  end;

  begin
    select jsonb_build_object(
             'done', count(*) filter (where s.status in ('done', 'skipped')),
             'total', count(*))
      into v_steps
      from app.setup_checklist(p_center) s
     where s.required;
  exception when others then
    v_steps := null;
  end;

  select jsonb_build_object(
           'status', g.status,
           'requested_at', g.requested_at,
           'first_approved', g.first_approved_at is not null,
           'second_approved', g.second_approved_at is not null)
    into v_golive
    from app.golive_requests g
   where g.center_id = p_center
   order by g.requested_at desc
   limit 1;

  select jsonb_build_object('status', p.verification_status, 'submitted_at', p.submitted_at, 'verified_at', p.verified_at)
    into v_verify
    from app.org_profiles p
   where p.center_id = p_center;

  select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name
    into v_owner
    from app.center_owners o
    left join app.center_users cu on cu.center_id = o.center_id and cu.user_id = o.user_id
    left join app.people pe on pe.id = cu.person_id
   where o.center_id = p_center
   limit 1;

  v_tools := case when jsonb_typeof(c.rules #> '{assistant,tools}') = 'object'
                  then (select count(*) from jsonb_each(c.rules #> '{assistant,tools}') e where e.value = 'true'::jsonb)::integer
                  else 0 end;

  return jsonb_build_object(
    'community', jsonb_build_object(
      'id', c.id,
      'slug', c.slug::text,
      'name', c.name,
      'status', c.status,
      'environment', c.environment,
      'kind', c.category_key,
      'tradition', c.tradition::text,
      'time_zone', c.time_zone,
      'created_at', c.created_at,
      'moved_to_production_as', (select p.slug::text from app.centers p where p.id = c.sandbox_for),
      'owner', v_owner),
    'size', jsonb_build_object(
      'households', (select count(*) from app.households h where h.center_id = p_center and h.merged_into_id is null)::integer,
      'people', (select count(*) from app.people pe where pe.center_id = p_center and pe.merged_into_id is null)::integer,
      'signed_in_accounts', (select count(*) from app.center_users cu where cu.center_id = p_center)::integer,
      'active_memberships', (select count(*) from app.memberships m where m.center_id = p_center and m.status = 'active')::integer),
    'setup', v_steps,
    'readiness', v_ready,
    'go_live', v_golive,
    'verification', v_verify,
    'consent', jsonb_build_object(
      'activity_recording',
        case when nullif(c.rules #>> '{activity,consent,at}', '') is null then 'not_agreed'
             when (c.rules #>> '{activity,enabled}') = 'true' then 'on'
             else 'off' end,
      'shares_with_weaver', (c.rules #>> '{activity,share_with_weaver}') = 'true',
      'support_access_until', (select max(sg.expires_at) from app.support_grants sg
                                where sg.center_id = p_center and sg.revoked_at is null and sg.expires_at > now()),
      'niva_actions_switched_on', v_tools),
    'modules_off', coalesce((select jsonb_agg(m.key order by m.key) from app.my_modules(p_center) m where not m.enabled and not m.core), '[]'::jsonb),
    'ways_to_pay', coalesce((select jsonb_agg(pm.method::text order by pm.method::text)
                               from app.center_payment_methods pm where pm.center_id = p_center and pm.accepted), '[]'::jsonb),
    'portal_addresses', (select count(*) from app.center_domains d where d.center_id = p_center)::integer,
    'last_staff_activity_at', (select max(l.occurred_at) from app.audit_log l where l.center_id = p_center and l.actor_user_id is not null)
  );
end $$;

revoke execute on function app.platform_waiting(integer), app.platform_community_summary(uuid) from public, anon;
grant execute on function app.platform_waiting(integer), app.platform_community_summary(uuid) to authenticated;

comment on function app.platform_waiting(integer) is
  'Platform inbox across communities: go-live requests, approved sandboxes, verifications, access requests, failing go-live checks, and consent states. Platform admins only. Security invoker. Read only.';
comment on function app.platform_community_summary(uuid) is
  'One page about one community: kind, size, setup, go-live checks, go-live request, verification, consent states, modules off, ways to pay. Platform admins only. Security invoker. Read only.';
