-- Relationship options: the list a member picks from when adding a family
-- member or asking to change their relationship (the "Add a family member"
-- and "Relationship" fields were free text; now a per-center picklist).
--
-- Every center starts with a typical set (Spouse, Child, Parent, …), seeded
-- automatically when the center is created. An admin (settings.manage) may
-- add or remove options for their own center — add/remove only, no
-- reordering or renaming screen; renaming is drop + add. Nothing else
-- references this table by foreign key, so a real delete is safe: it is a
-- label list, not a record of who has which relationship.
set client_min_messages = warning;

create table if not exists app.relationship_options (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (center_id, name)
);

alter table app.relationship_options enable row level security;
drop policy if exists relationship_options_member_read on app.relationship_options;
create policy relationship_options_member_read on app.relationship_options for select to authenticated
  using (app.is_member_of(center_id));
drop policy if exists relationship_options_staff_write on app.relationship_options;
create policy relationship_options_staff_write on app.relationship_options for all to authenticated
  using (app.has_permission(center_id, 'settings.manage')) with check (app.has_permission(center_id, 'settings.manage'));

insert into app.module_tables (table_name, module_key) values ('relationship_options', 'people')
  on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_relationship_options on app.relationship_options;
create trigger audit_relationship_options after insert or update or delete on app.relationship_options
  for each row execute function app.audit_row();

-- ── Seed a typical set on every new center, and backfill existing ones ──────
create or replace function app.seed_default_relationship_options() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.relationship_options (center_id, name, sort) values
    (new.id, 'Spouse', 1), (new.id, 'Child', 2), (new.id, 'Parent', 3), (new.id, 'Sibling', 4),
    (new.id, 'Grandparent', 5), (new.id, 'Grandchild', 6), (new.id, 'Guardian', 7),
    (new.id, 'Other relative', 8), (new.id, 'Other', 9)
  on conflict (center_id, name) do nothing;
  return new;
end $$;

drop trigger if exists centers_seed_relationship_options on app.centers;
create trigger centers_seed_relationship_options after insert on app.centers
  for each row execute function app.seed_default_relationship_options();

insert into app.relationship_options (center_id, name, sort)
select c.id, v.name, v.sort from app.centers c
  cross join (values ('Spouse',1), ('Child',2), ('Parent',3), ('Sibling',4),
                      ('Grandparent',5), ('Grandchild',6), ('Guardian',7),
                      ('Other relative',8), ('Other',9)) as v(name, sort)
on conflict (center_id, name) do nothing;

-- ── Read for the apps ────────────────────────────────────────────────────────
create or replace function app.relationship_options(p_center uuid) returns table (id uuid, name text)
language sql stable security definer set search_path = app, public, extensions as $$
  select o.id, o.name from app.relationship_options o
   where o.center_id = p_center and app.is_member_of(p_center)
   order by o.sort, o.name
$$;
grant execute on function app.relationship_options(uuid) to authenticated;
