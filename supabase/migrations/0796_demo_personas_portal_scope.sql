-- 0796 · A demo person holds the scope the portal's Roles screen would give them (B88; docs/DEMO_ROLE_WORK.md).
--
-- app.demo_make_personas (0629) gave every demo person the role's own default scope. For the Pathshala principal, the Pathshala
-- committee member and the store lead that is 'pathshala' / 'store', which is not a scope the portal offers when it grants a role:
-- Settings > Roles grants "the whole center", "one event", "one Pathshala class" or "one zone" (src/app/(app)/settings/roles/
-- grant-form.tsx defaultScopeFor), and the portal's own permission check (src/lib/permissions.ts computePermissions) counts only
-- center-wide and platform grants. So those three demo people were signed in with permissions the database honoured but the
-- portal ignored: Pathshala, My Store and the task list stayed hidden and Home said "Nothing here for your role".
--
-- From now on a demo person's scope is the one the Roles screen would choose: the event, class or zone the role is about, and the
-- whole community for everything else. Nothing else about a demo person changes, no policy or grant of any other object is
-- touched, and a real community is not affected (this function only builds the demo people). The demo community picks the change
-- up at its next reset ("Start over" on Platform > Setup > Demo sign-in, or the nightly check).
set client_min_messages = warning;

create or replace function app.demo_make_personas(p_center uuid, p_pack text) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.demo_packs; n int;
begin
  select * into p from app.demo_packs where key = p_pack;
  insert into app.demo_personas (id, center_id, role_key, display_name, headline, story, email, person_id, household_id, scope_kind, scope_id, sort_order)
  select app.demo_id(p_center, 'persona:' || (x.value->>'role')), p_center, x.value->>'role', pe.first_name || ' ' || pe.last_name, r.name,
         x.value->>'story', lower(pe.email::text), pe.id,
         (select hm.household_id from app.household_members hm where hm.person_id = pe.id and hm.left_at is null order by hm.is_primary desc limit 1),
         case when r.default_scope in ('event', 'class', 'zone') then r.default_scope else 'center'::app.scope_kind end,
         case when x.value ? 'scope' then app.demo_id(p_center, x.value->>'scope') end, x.ord::int
    from jsonb_array_elements(p.content->'personas') with ordinality x(value, ord)
    join app.roles r on r.key = x.value->>'role'
    join app.people pe on pe.id = app.demo_p(p_center, x.value->>'person') and pe.center_id = p_center;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function app.demo_make_personas(uuid, text) from public, anon, authenticated;
