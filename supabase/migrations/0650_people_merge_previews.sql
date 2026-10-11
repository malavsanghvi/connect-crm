-- 0650: read-only previews for merging two people and two households (docs/ADMIN_REDESIGN.md "Preview functions";
-- B90 phase 4, People). The merge buttons show a confirmation card that says what is about to move; this is where the
-- numbers and the reasons a merge would be refused come from, computed next to the merge functions so the two cannot
-- drift apart. Nothing here writes, and nothing here is more powerful than the person asking:
--
--   * security INVOKER (the default): row-level security applies, so a count only covers rows the caller may read,
--     exactly the rows app.merge_people / app.merge_households would touch when the caller runs them;
--   * search_path = app, public, extensions (hosted Supabase keeps pgcrypto in `extensions`);
--   * STABLE: the planner and the database both know it changes nothing;
--   * no policy, grant on a table, or permission is changed; the two functions are granted to `authenticated` like
--     the merge functions they describe.
--
-- app.merge_people_preview(keep, drop, take)  and  app.merge_households_preview(keep, drop)
--   return jsonb:  { can_merge, blockers[], keep{id,...}, drop{id,...}, moves{...counts...}, fields[] }
--   `blockers` holds, in plain English, every reason the merge function would raise an exception for (the same sentences),
--   `can_merge` is true only when there are none. Ids and counts only: names are read by the app, which keeps
--   anyone under 18 out of what a model sees (decision D2).

-- ---------------------------------------------------------------------------
-- Two people
-- ---------------------------------------------------------------------------
create or replace function app.merge_people_preview(p_keep uuid, p_drop uuid, p_take text[] default '{}')
returns jsonb
language plpgsql
stable
security invoker
set search_path = app, public, extensions
as $$
declare
  k app.people;
  d app.people;
  v_allowed text[] := array['first_name','last_name','preferred_name','date_of_birth','gender','email','phone_e164','profession','employer'];
  v_blockers text[] := '{}';
  v_field text;
begin
  if p_keep is null or p_drop is null then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('Choose both records first'));
  end if;
  if p_keep = p_drop then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('Choose two different records to merge'));
  end if;
  select * into k from app.people where id = p_keep;
  select * into d from app.people where id = p_drop;
  if k.id is null or d.id is null then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('One of the two records was not found, or you can''t see it'));
  end if;
  if k.center_id <> d.center_id then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('The two records belong to different centers'));
  end if;

  if not app.has_permission(k.center_id, 'people.manage') then
    v_blockers := array_append(v_blockers, 'Merging records needs the people.manage permission');
  end if;
  if k.merged_into_id is not null or d.merged_into_id is not null then
    v_blockers := array_append(v_blockers, 'One of the two records was already merged');
  end if;
  if not (app.module_enabled(k.center_id, 'membership') or app.is_platform_admin()) then
    v_blockers := array_append(v_blockers, 'Merging records needs the Membership module switched on, because the duplicate''s memberships move to the kept record.');
  end if;
  if exists (select 1 from app.center_users where person_id = p_drop) then
    if exists (select 1 from app.center_users where person_id = p_keep) then
      v_blockers := array_append(v_blockers, 'Both records sign in to the app, so they cannot be merged here. Ask the platform team to merge the two sign-ins first');
    else
      v_blockers := array_append(v_blockers, 'The duplicate signs in to the app. Keep that record instead (swap which record is kept)');
    end if;
  end if;
  foreach v_field in array coalesce(p_take, '{}') loop
    if not v_field = any(v_allowed) then
      v_blockers := array_append(v_blockers, format('The field "%s" cannot be copied in a merge', v_field));
    end if;
  end loop;

  return jsonb_build_object(
    'can_merge', coalesce(array_length(v_blockers, 1), 0) = 0,
    'blockers', to_jsonb(v_blockers),
    'keep', jsonb_build_object('id', k.id, 'member_number', k.member_number),
    'drop', jsonb_build_object('id', d.id, 'member_number', d.member_number),
    'moves', jsonb_build_object(
      -- the duplicate's current household links are re-pointed at the kept record
      'household_links', (select count(*) from app.household_members where person_id = p_drop and left_at is null),
      -- households where both records are already listed (the links fold into one)
      'shared_households', (select count(*) from app.household_members a
                              join app.household_members b on b.household_id = a.household_id and b.person_id = p_keep and b.left_at is null
                             where a.person_id = p_drop and a.left_at is null),
      'primary_links', (select count(*) from app.household_members where person_id = p_drop and left_at is null and is_primary),
      -- every identifier and membership row of the duplicate moves to the kept record
      'external_ids', (select count(*) from app.external_ids where person_id = p_drop),
      'memberships', (select count(*) from app.memberships where person_id = p_drop),
      'open_suggestions', (select count(*) from app.merge_candidates
                            where kind = 'person' and status = 'open'
                              and ((left_id = p_keep and right_id = p_drop) or (left_id = p_drop and right_id = p_keep)))),
    'fields', to_jsonb(coalesce(p_take, '{}'::text[])));
end $$;

-- ---------------------------------------------------------------------------
-- Two households
-- ---------------------------------------------------------------------------
create or replace function app.merge_households_preview(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = app, public, extensions
as $$
declare
  k app.households;
  d app.households;
  v_blockers text[] := '{}';
  v_keep_has_primary boolean;
begin
  if p_keep is null or p_drop is null then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('Choose both households first'));
  end if;
  if p_keep = p_drop then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('Choose two different households to merge'));
  end if;
  select * into k from app.households where id = p_keep;
  select * into d from app.households where id = p_drop;
  if k.id is null or d.id is null then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('One of the two households was not found, or you can''t see it'));
  end if;
  if k.center_id <> d.center_id then
    return jsonb_build_object('can_merge', false, 'blockers', jsonb_build_array('The two households belong to different centers'));
  end if;

  if not app.has_permission(k.center_id, 'people.manage') then
    v_blockers := array_append(v_blockers, 'Merging households needs the people.manage permission');
  end if;
  if k.merged_into_id is not null or d.merged_into_id is not null then
    v_blockers := array_append(v_blockers, 'One of the two households was already merged');
  end if;

  select exists (select 1 from app.household_members where household_id = p_keep and is_primary and left_at is null)
    into v_keep_has_primary;

  return jsonb_build_object(
    'can_merge', coalesce(array_length(v_blockers, 1), 0) = 0,
    'blockers', to_jsonb(v_blockers),
    'keep', jsonb_build_object('id', k.id, 'household_number', k.household_number),
    'drop', jsonb_build_object('id', d.id, 'household_number', d.household_number),
    'moves', jsonb_build_object(
      -- the duplicate's current members join the kept household
      'members_moving', (select count(*) from app.household_members where household_id = p_drop and left_at is null),
      -- of those, people the kept household already lists
      'already_in_keep', (select count(*) from app.household_members a
                           where a.household_id = p_drop and a.left_at is null
                             and exists (select 1 from app.household_members b where b.household_id = p_keep and b.person_id = a.person_id)),
      -- a second "primary" cannot join: it becomes "other" (and the duplicate's primary flag is not carried over)
      'primary_becomes_other', case when v_keep_has_primary
                                 then (select count(*) from app.household_members where household_id = p_drop and left_at is null and role = 'primary')
                                 else 0 end,
      -- what does NOT move: the duplicate keeps its identifiers, memberships and giving history
      'household_ids_staying', (select count(*) from app.external_ids where household_id = p_drop),
      'active_memberships_staying', (select count(*) from app.memberships where household_id = p_drop and status = 'active'),
      'open_suggestions', (select count(*) from app.merge_candidates
                            where kind = 'household' and status = 'open'
                              and ((left_id = p_keep and right_id = p_drop) or (left_id = p_drop and right_id = p_keep)))));
end $$;

grant execute on function app.merge_people_preview(uuid, uuid, text[]) to authenticated;
grant execute on function app.merge_households_preview(uuid, uuid) to authenticated;
revoke execute on function app.merge_people_preview(uuid, uuid, text[]) from public, anon;
revoke execute on function app.merge_households_preview(uuid, uuid) from public, anon;
