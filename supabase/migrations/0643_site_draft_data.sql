-- 0643_site_draft_data.sql (backlog B92, phase W3: what Weaver itself knows, for the first draft of the website)
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   When staff press "Build my first draft" (Setup › Your website), the portal builds the draft from two things: what Weaver
--   found on the organization's current website (0640), and Weaver's own records of the organization. This is the second one:
--   app.site_draft_data(center) gives, in one answer, the parts of those records that are meant to be public:
--     center         the name, short name and time zone
--     profile        mission, about, public email and phone, office hours, address, map pin, social links
--                    (the organization's profile in Setup; the registered address is the only address Weaver has)
--     leaders        the leaders the organization chose to show publicly (org_leaders.show_publicly): name and title only
--     events         upcoming events that are open to the public or to guests, not confidential, published (or about to start
--                    or under way): title, times, place, description; at most 12; no prices, no RSVP, no people
--     giving         published campaigns that are visible now, with their open, visible opportunities (names and descriptions;
--                    no amounts, no pledges, no donors)
--     today          today's opening and closing time, when the organization keeps daily timings
--     albums         public photo albums with the number of approved photos that do not show children
--     store          whether the store is on, and the names of up to 8 active items
--     school         whether the school is on and has classes set up, its levels and its current term
--   Nothing is written. Nothing about any person other than the leaders chosen for the public is returned, and nothing about
--   money other than the names of campaigns and opportunities the organization already shows to everyone.
--
-- WHO MAY CALL IT
--   settings.manage of that community only (the pattern of 0640): SECURITY DEFINER, "Sign in first" for a caller with no user,
--   execute revoked from public, anon and service_role and granted to authenticated. No policy and no grant is added.
--
-- Idempotent: create or replace function.

set client_min_messages = warning;

create or replace function app.site_draft_data(p_center uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_center app.centers;
  v_prof app.org_profiles;
  v_addr jsonb;
  v_address text;
  v_tz text;
  v_events_on boolean;
  v_giving_on boolean;
  v_store_on boolean;
  v_school_on boolean;
  v_events jsonb := '[]'::jsonb;
  v_campaigns jsonb := '[]'::jsonb;
  v_leaders jsonb;
  v_today jsonb;
  v_albums jsonb;
  v_store_items jsonb := '[]'::jsonb;
  v_levels jsonb := '[]'::jsonb;
  v_term jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Drafting the website from Weaver''s records needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_center from app.centers where id = p_center;
  if not found then raise exception 'That community was not found.'; end if;
  select * into v_prof from app.org_profiles where center_id = p_center;
  v_tz := coalesce(nullif(btrim(v_center.time_zone), ''), 'UTC');

  v_addr := v_prof.registered_address;
  if v_addr is not null and jsonb_typeof(v_addr) = 'object' then
    v_address := nullif(concat_ws(', ',
        nullif(btrim(coalesce(v_addr ->> 'line1', '')), ''),
        nullif(btrim(coalesce(v_addr ->> 'line2', '')), ''),
        nullif(btrim(coalesce(v_addr ->> 'city', '')), ''),
        nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_addr ->> 'state', '')), ''), nullif(btrim(coalesce(v_addr ->> 'postal_code', '')), ''))), '')), '');
  end if;

  v_events_on := app.module_enabled(p_center, 'events');
  v_giving_on := app.module_enabled(p_center, 'giving');
  v_store_on := app.module_enabled(p_center, 'store');
  v_school_on := app.module_enabled(p_center, 'pathshala');

  -- Upcoming events open to the public or to guests.
  if v_events_on then
    select coalesce(jsonb_agg(jsonb_build_object('title', e.name, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue', e.venue,
                                                 'description', left(e.description, 400)) order by e.starts_at), '[]'::jsonb)
      into v_events
      from (select ev.name, ev.starts_at, ev.ends_at, ev.venue, ev.description
              from app.events ev
             where ev.center_id = p_center
               and ev.status in ('published', 'rsvp_closed', 'live')
               and ev.audience in ('public', 'members_and_guests')
               and not coalesce(ev.confidential, false)
               and coalesce(ev.ends_at, ev.starts_at) >= now()
             order by ev.starts_at
             limit 12) e;
  end if;

  -- Published campaigns visible now, with their open opportunities.
  if v_giving_on then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', c.name, 'kind', c.kind, 'description', left(c.description, 500),
             'items', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'description', left(o.description, 300)) order by o.sort_order, o.name)
                                  from (select op.name, op.description, op.sort_order
                                          from app.opportunities op
                                         where op.campaign_id = c.id and op.status = 'open'
                                           and app.giving_row_visible(op.active, op.visible_from, op.visible_until)
                                         order by op.sort_order, op.name
                                         limit 10) o), '[]'::jsonb)) order by c.starts_on nulls last, c.name), '[]'::jsonb)
      into v_campaigns
      from (select ca.id, ca.name, ca.kind, ca.description, ca.starts_on
              from app.campaigns ca
             where ca.center_id = p_center and ca.status = 'published'
               and app.giving_row_visible(ca.active, ca.visible_from, ca.visible_until)
               and (ca.ends_on is null or ca.ends_on >= current_date)
             order by ca.starts_on nulls last, ca.name
             limit 8) c;
  end if;

  -- The leaders the organization chose to show publicly: name and title, nothing else.
  select coalesce(jsonb_agg(jsonb_build_object('name', l.full_name, 'title', l.title) order by l.sort, l.full_name), '[]'::jsonb)
    into v_leaders
    from (select ol.full_name, ol.title, ol.sort from app.org_leaders ol
           where ol.center_id = p_center and ol.show_publicly
           order by ol.sort, ol.full_name limit 40) l;

  -- Today's opening and closing time (daily timings are kept by organizations that keep a tradition).
  select jsonb_build_object('date', t.on_date, 'open', left(t.temple_open::text, 5), 'close', left(t.temple_close::text, 5))
    into v_today
    from app.daily_timings t
   where t.center_id = p_center and t.on_date = (now() at time zone v_tz)::date;

  -- Public albums, with the number of approved photos that do not show children (plus the count of a linked album).
  select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'photos', a.n) order by a.created_at desc), '[]'::jsonb)
    into v_albums
    from (select pa.title, pa.created_at,
                 (select count(*) from app.photos ph where ph.album_id = pa.id and ph.status = 'approved' and not ph.contains_children)
                   + coalesce(pa.external_photo_count, 0) as n
            from app.photo_albums pa
           where pa.center_id = p_center and pa.visibility = 'public'
           order by pa.created_at desc limit 12) a;

  if v_store_on then
    select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) into v_store_items
      from (select si.name from app.store_items si where si.center_id = p_center and si.status = 'active' order by si.name limit 8) s;
  end if;

  if v_school_on then
    select coalesce(jsonb_agg(lv.name order by lv.sort_order, lv.name), '[]'::jsonb) into v_levels
      from (select pl.name, pl.sort_order from app.pathshala_levels pl where pl.center_id = p_center and pl.active order by pl.sort_order, pl.name limit 12) lv;
    select jsonb_build_object('name', pt.name, 'starts_on', pt.starts_on, 'ends_on', pt.ends_on, 'status', pt.status)
      into v_term
      from app.pathshala_terms pt
     where pt.center_id = p_center and pt.status in ('registration', 'active')
     order by pt.starts_on desc limit 1;
  end if;

  return jsonb_build_object(
    'center', jsonb_build_object('name', v_center.name, 'short_name', v_center.short_name, 'time_zone', v_center.time_zone),
    'profile', jsonb_build_object(
        'mission', v_prof.mission, 'about', v_prof.about, 'public_email', v_prof.public_email::text, 'public_phone', v_prof.public_phone,
        'office_hours', v_prof.office_hours, 'address', v_address, 'latitude', v_prof.latitude, 'longitude', v_prof.longitude,
        'social', coalesce(v_prof.social, '{}'::jsonb)),
    'leaders', v_leaders,
    'events', jsonb_build_object('on', v_events_on, 'items', v_events),
    'giving', jsonb_build_object('on', v_giving_on, 'campaigns', v_campaigns),
    'today', v_today,
    'albums', v_albums,
    'store', jsonb_build_object('on', v_store_on, 'items', v_store_items),
    'school', jsonb_build_object('on', v_school_on and (jsonb_array_length(v_levels) > 0 or v_term is not null), 'levels', v_levels, 'term', v_term));
end $$;
comment on function app.site_draft_data(uuid) is
  'Weaver''s own public-facing records of a community, for the first draft of its website (0643). settings.manage only. Reads only: events open to the public or guests, visible published giving, leaders chosen for the public, public albums, store and school basics.';

revoke execute on function app.site_draft_data(uuid) from public, anon, authenticated, service_role;
grant execute on function app.site_draft_data(uuid) to authenticated;
