-- 0860 · The areas a kind of organization does not have read as "not available" in the member app's access answer, not as missing.
-- (owner decision 2026-10-15, "go with your recommendations": the neutral faith demo must not show darshan, puja or timings)
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.feature_access_for_me(community) is the one call the member app makes to learn which areas it may show (live darshan, virtual puja,
--   today's timings, the guide, listen, look, learn, Ask Niva). Since 0600 it LEFT OUT an area the community's kind of organization does not have
--   (darshan, puja and timings are Jain Center only; learn is Jain Center and faith communities). The member app reads an area the answer does not
--   mention as ALLOWED (the rule from before access levels: a signed-in person may use everything), so a faith demo, a chamber or a club could still
--   be shown a darshan tile ("the live stream is offline"), a puja door and today's timings.
--
--   Now such an area is IN the answer, as not available:  {"allowed": false, "reason": "module_off", "min_level": {...}}.  "module_off" is the reason
--   the app already understands for an area the community does not offer ("{area} isn't offered by {community} right now"), and the member app
--   (connect-mobile 1.20.1 and later) already hides an area the answer marks not allowed. Nothing else changes.
--
-- WHAT CHANGES FOR WHOM
--   A Jain Center (JSH and every Jain Center sandbox): NOTHING. Every area is part of its kind, so the answer is byte for byte what 0600 gave
--     (test 860 compares the full answer with 0600's own body, for a guest, a stranger, a member and an administrator).
--   Any other kind (Faith community, Church, Mosque, Swaminarayan Temple, Chamber of commerce, Community organization):
--     the areas its kind does not have appear as not allowed, reason module_off, for every caller (guest, member, staff alike):
--       Jain Center only: darshan, puja, timings       (every other kind)
--       Jain Center and faith communities: learn       (Chamber of commerce, Community organization)
--     Every other entry of the answer is exactly what it was.
--   Settings > Access levels (app.access_settings) still lists only the areas the kind has: it is NOT changed. Neither is app.can_use_feature
--     (already false for an area the kind does not have, which is what the live darshan row level security policy calls).
--   member_experience / category_profile embed this answer, so their `access` now carries the same extra entries for those kinds, and the stamp of
--     the member app's one read changes for them once (the app refreshes). A Jain Center's stamp does not change.
--
-- WHAT THIS DOES NOT DO
--   It only REMOVES availability for kinds that do not have an area; it grants nothing to anyone. It touches no RLS policy, no role or permission,
--   no grant, no money. The one function is redefined with the same signature, language, volatility, security definer and the same pinned
--   search path (app, public, extensions: 0019), so its privileges are kept: callable without a session, as before. Generated types do not change.
--
-- THE DIFF AGAINST 0600's BODY (everything else is word for word)
--   declare:  + v_has boolean
--   loop:     - for f in select * from app.access_features a where app.catalog_shows(a.category_keys, v_cat) order by a.sort, a.key loop
--             + for f in select * from app.access_features a order by a.sort, a.key loop
--   status:   + v_has := app.catalog_shows(f.category_keys, v_cat);
--             - v_on := f.module_key is null or app.module_enabled(p_center, f.module_key);
--             + v_on := v_has and (f.module_key is null or app.module_enabled(p_center, f.module_key));
--   (v_cat, the loop's order, the minimum level, `v_ok`, the reason ladder and the shape of each entry are untouched: an area the kind does not have
--   is "not on", so it is not allowed and its reason is module_off, which comes before sign_in and level in the reason ladder.)
--
-- ROLLBACK (paste into the SQL editor: it is 0600's function, word for word; nothing else needs undoing, no data is written here)
--   create or replace function app.feature_access_for_me(p_center uuid) returns jsonb
--   language plpgsql stable security definer set search_path = app, public, extensions as $fn$
--   declare me record; f record; v_out jsonb := '{}'::jsonb; v_on boolean; v_ok boolean; v_reason text;
--           v_min_key text; v_min_label text; v_min_rank integer; v_cat text;
--   begin
--     if p_center is null or not app.access_center_open(p_center) then
--       raise exception 'That community was not found.';
--     end if;
--     v_cat := app.center_category(p_center);
--     select * into me from app.my_access(p_center);
--     for f in select * from app.access_features a where app.catalog_shows(a.category_keys, v_cat) order by a.sort, a.key loop
--       select m.key, m.label, m.rank into v_min_key, v_min_label, v_min_rank from app.feature_min_level(p_center, f.key) m;
--       if v_min_key is null then
--         v_min_key := f.default_level;
--         v_min_label := case f.default_level when 'community' then 'Community member' else 'Public' end;
--         v_min_rank := case f.default_level when 'community' then 10 else 0 end;
--       end if;
--       v_on := f.module_key is null or app.module_enabled(p_center, f.module_key);
--       v_ok := v_on and me.rank >= v_min_rank;
--       v_reason := case when not v_on then 'module_off'
--                        when v_ok then null
--                        when not me.signed_in then 'sign_in'
--                        else 'level' end;
--       v_out := v_out || jsonb_build_object(f.key, jsonb_build_object(
--                  'allowed', v_ok, 'reason', v_reason,
--                  'min_level', jsonb_build_object('key', v_min_key, 'label', v_min_label, 'rank', v_min_rank)));
--     end loop;
--     return jsonb_build_object('level', jsonb_build_object('key', me.key, 'label', me.label, 'rank', me.rank),
--                               'signed_in', me.signed_in, 'features', v_out);
--   end $fn$;
set client_min_messages = warning;

create or replace function app.feature_access_for_me(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare me record; f record; v_out jsonb := '{}'::jsonb; v_has boolean; v_on boolean; v_ok boolean; v_reason text;
        v_min_key text; v_min_label text; v_min_rank integer; v_cat text;
begin
  if p_center is null or not app.access_center_open(p_center) then
    raise exception 'That community was not found.';
  end if;
  v_cat := app.center_category(p_center);
  select * into me from app.my_access(p_center);
  for f in select * from app.access_features a order by a.sort, a.key loop
    select m.key, m.label, m.rank into v_min_key, v_min_label, v_min_rank from app.feature_min_level(p_center, f.key) m;
    if v_min_key is null then
      -- the community's ladder is missing (it should not be): the catalog default, by the platform's own names
      v_min_key := f.default_level;
      v_min_label := case f.default_level when 'community' then 'Community member' else 'Public' end;
      v_min_rank := case f.default_level when 'community' then 10 else 0 end;
    end if;
    -- An area the community's kind of organization does not have (0600's category_keys) is part of the answer as "not on": not allowed, and the
    -- reason is module_off (the reason the app already shows as "not offered here"), so the app hides it instead of reading its absence as yes.
    v_has := app.catalog_shows(f.category_keys, v_cat);
    v_on := v_has and (f.module_key is null or app.module_enabled(p_center, f.module_key));
    v_ok := v_on and me.rank >= v_min_rank;
    v_reason := case when not v_on then 'module_off'
                     when v_ok then null
                     when not me.signed_in then 'sign_in'
                     else 'level' end;
    v_out := v_out || jsonb_build_object(f.key, jsonb_build_object(
               'allowed', v_ok, 'reason', v_reason,
               'min_level', jsonb_build_object('key', v_min_key, 'label', v_min_label, 'rank', v_min_rank)));
  end loop;
  return jsonb_build_object('level', jsonb_build_object('key', me.key, 'label', me.label, 'rank', me.rank),
                            'signed_in', me.signed_in, 'features', v_out);
end $$;

comment on function app.feature_access_for_me(uuid) is
  'What the member app asks once per community, with or without a session (0586): {level, signed_in, features: {area: {allowed, reason, min_level}}}. Every area of the catalog is in the answer. An area the community''s kind of organization does not have (0600 category_keys; 0860) is there as not allowed with reason module_off, so the app hides it. app.access_settings still lists only the areas the kind has.';
