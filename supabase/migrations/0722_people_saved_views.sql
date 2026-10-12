-- 0722: a person's own saved People views and pinned families (People redesign, slice 8; docs/PEOPLE_REDESIGN.md sections 4, 6, 9).
--
-- ONE table, app.people_saved, per signed-in person and community, two kinds of row:
--   kind 'view'  a named list the person came back to: which list ('households' | 'people'), its filters as the URL values the
--                page reads (params), and a sort. A typed search is never stored (it can be a person's name); the portal drops it.
--   kind 'pin'   a family (household_id) the person keeps at the top of the People home.
-- `position` orders each kind; the portal puts a new row last.
--
-- Private to the person. A person reads, adds, changes and deletes ONLY their own rows (user_id = auth.uid()); there is no staff
-- read, no platform read, no center-admin read, and the service key has no table privileges at all (the portal reads through the
-- signed-in person's own session). Writing needs a person to be in the community and to hold people.view or people.manage (the
-- People area); a pin must point at a family the writer can see in that community (the check runs under the writer's own access,
-- so it also leaves no way to learn whether a household id exists). A pin is read again under the viewer's own access every time the
-- People home draws it, so a family someone can no longer see is skipped, never shown.
--
-- Limits (the portal says the same words): a view name is 1 to 60 characters on one line; a person keeps at most 30 views and 40 pins
-- per community; one pin per family; one view per name (any case). A name or a pin is the person's own convenience, not a record of
-- the community, so the table is NOT in the row-level audit (like the activity stream tables of 0620): an audit entry would put one
-- person's list names and pins in front of everyone who holds audit.view. test 13 lists it with the others left out on purpose.
--
-- Registers the portal's six Server Actions for these screens in the activity allowlist (app.activity_register): without a row an
-- action is dropped by app.record_activity. Nothing is recorded until a community's administrator has agreed (0621).
set client_min_messages = warning;

create table if not exists app.people_saved (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('view', 'pin')),
  -- A view: its name, the list it opens, its filters (URL values) and its sort.
  name         text,
  list_view    text,
  params       jsonb not null default '{}'::jsonb,
  sort         text,
  -- A pin: the family.
  household_id uuid references app.households(id) on delete cascade,
  position     integer not null default 0 check (position between 0 and 100000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint people_saved_params_shape check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 2000),
  constraint people_saved_sort_shape check (sort is null or (char_length(sort) <= 20 and sort ~ '^[a-z_]+$')),
  constraint people_saved_view_shape check (
    kind <> 'view' or (name is not null and name = btrim(name) and char_length(name) between 1 and 60 and name !~ '[[:cntrl:]]'
                       and list_view in ('households', 'people') and household_id is null)),
  constraint people_saved_pin_shape check (
    kind <> 'pin' or (household_id is not null and name is null and list_view is null and sort is null and params = '{}'::jsonb))
);
comment on table app.people_saved is
  'A person''s own saved People views (kind view: name, list, filters as URL values, sort) and pinned families (kind pin: household_id), one set per signed-in person and community (0722). Readable and writable by that person only: no staff, platform or service-key access; not row-audited on purpose.';
comment on column app.people_saved.params is
  'The list''s filters as the URL values the People page reads (for example {"noemail":"1","band":"adults"}); never a typed search.';

create unique index if not exists people_saved_one_pin on app.people_saved (center_id, user_id, household_id) where kind = 'pin';
create unique index if not exists people_saved_one_view_name on app.people_saved (center_id, user_id, lower(name)) where kind = 'view';
create index if not exists people_saved_own_idx on app.people_saved (user_id, center_id, kind, position, created_at);
create index if not exists people_saved_household_idx on app.people_saved (household_id) where household_id is not null;

insert into app.module_tables (table_name, module_key) values ('people_saved', 'people')
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── The limits, and what can never change ───────────────────────────────────────
-- A person's rows are counted under a lock for that person and community, so two quick saves cannot both slip in over the cap.
-- The message is a plain sentence (check_violation): the portal shows it as it is.
create or replace function app.people_saved_limits() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n integer; v_cap integer;
begin
  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind or new.user_id is distinct from old.user_id
       or new.center_id is distinct from old.center_id or new.household_id is distinct from old.household_id then
      raise exception 'A saved view or a pin cannot be moved to another person, community, family or kind.' using errcode = '23514';
    end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('people_saved:' || new.center_id::text || ':' || new.user_id::text, 0));
  v_cap := case new.kind when 'view' then 30 else 40 end;
  select count(*) into v_n from app.people_saved s where s.center_id = new.center_id and s.user_id = new.user_id and s.kind = new.kind;
  if v_n >= v_cap then
    raise exception '%', case new.kind
      when 'view' then 'You can keep up to 30 saved views. Delete one you no longer use, then save this one.'
      else 'You can pin up to 40 families. Unpin one you no longer need, then pin this one.' end using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function app.people_saved_limits() from public, anon, authenticated, service_role;

drop trigger if exists people_saved_limits on app.people_saved;
create trigger people_saved_limits before insert or update on app.people_saved for each row execute function app.people_saved_limits();
drop trigger if exists touch_people_saved on app.people_saved;
create trigger touch_people_saved before update on app.people_saved for each row execute function app.touch_updated_at();

-- ── Row level security: the person's own rows, nobody else's ────────────────────
alter table app.people_saved enable row level security;

drop policy if exists people_saved_own_read on app.people_saved;
create policy people_saved_own_read on app.people_saved for select to authenticated
  using (user_id = auth.uid());

-- Writing: in the community, with access to the People area, and a pin only to a family the writer can see there.
drop policy if exists people_saved_own_insert on app.people_saved;
create policy people_saved_own_insert on app.people_saved for insert to authenticated
  with check (
    user_id = auth.uid() and app.is_member_of(center_id)
    and (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage'))
    and (household_id is null or exists (select 1 from app.households h where h.id = people_saved.household_id and h.center_id = people_saved.center_id)));

drop policy if exists people_saved_own_update on app.people_saved;
create policy people_saved_own_update on app.people_saved for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid() and app.is_member_of(center_id)
    and (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage'))
    and (household_id is null or exists (select 1 from app.households h where h.id = people_saved.household_id and h.center_id = people_saved.center_id)));

-- Deleting needs no permission: a person whose role ended can still clear their own rows.
drop policy if exists people_saved_own_delete on app.people_saved;
create policy people_saved_own_delete on app.people_saved for delete to authenticated
  using (user_id = auth.uid());

-- Only signed-in people have any privilege on it. Not the service key, not the worker, not anon.
revoke all on app.people_saved from public, anon, authenticated, service_role, connect_worker;
grant select, insert, update, delete on app.people_saved to authenticated;

-- ── The portal's actions, in the activity allowlist ─────────────────────────────
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('people.save_view',   'Save a People list as a view',       null::text),
    ('people.rename_view', 'Rename a saved People view',         null::text),
    ('people.delete_view', 'Delete a saved People view',         null::text),
    ('people.pin_family',  'Pin a family',                       'household'),
    ('people.unpin_family', 'Unpin a family',                    'household'),
    ('people.export_list', 'Export a People list',               null::text)
  ) as v(k, l, e);
