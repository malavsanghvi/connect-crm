-- 0788 · Reading the audit log as a member with no audit permission answers at once (empty), instead of timing out.
--
-- THE PROBLEM. A signed-in community member (role Community member, nothing to do with audit) asked PostgREST for
-- GET /rest/v1/audit_log?select=id and got HTTP 500 "canceling statement due to statement timeout" (57014). No row left
-- the database, but any member could make it burn the whole statement timeout, and the member app and the portal show a
-- failure where they should show "You don't have access to this area".
--
-- THE CAUSE. 0758's audit_read policy is, for every row of the log:
--     case when module in ('care', 'matching')
--          then app.is_center_owner(center_id) or app.org_private_can(center_id, module || '.manage')
--          else app.has_permission(center_id, 'audit.view') or app.is_platform_admin() end
-- Every function takes the ROW'S center_id (and the row's module), so the planner cannot evaluate any of it once: it
-- calls them, row by row, for the whole of app.audit_log, and each call is itself several lookups (the platform-admin
-- check, the owner check, role_grants joined to roles, the module switch). The log has one row for every change to every
-- audited table, in every community, and only ever grows. A member who holds nothing pays the full price for every row
-- (nothing short-circuits: the answer is false for each of them), so a big log runs past the statement timeout.
--
-- THE FIX. The caller's answer does not depend on the row, only on the row's community and module. So ask it ONCE per
-- statement, as the set of communities the caller may read, and let each row look its community up in that set.
--   app._audit_read_centers(scope)   the communities where the caller may read one kind of entry, found by asking the SAME
--                                   checks as before (has_permission, is_center_owner, org_private_can), but only for the
--                                   communities the caller owns or holds a role grant in (nobody else can pass any of
--                                   them, so this loses nothing). scope: 'entries' (every ordinary entry: audit.view),
--                                   'care' and 'matching' (that product's private entries: the owner, or its .manage key).
--   app._audit_can_read_any()        is there anything at all the caller may read: a platform admin, or any set not empty.
-- The policy asks _audit_can_read_any() first, as a sub-select with no reference to the row. PostgreSQL runs that once (an
-- InitPlan) and, because it names no column, puts it in front of the scan as a one-time filter: a member who may read
-- nothing never touches the table. A reader sees the same rows as before, found by one hashed lookup of the row's
-- community in the set from the first sub-select (an uncorrelated IN, built once), not by calls per row.
--
-- WHO MAY READ WHAT IS NOT CHANGED. Same three rules as 0758, word for word in effect:
--   · a care or matching entry: the community's owner, or an active center-wide holder of care.manage / matching.manage
--     (never a platform admin, never audit.view alone);
--   · any other entry (including one with no module): audit.view in that community, the community's owner, or a platform
--     admin (who also reads the entries that belong to no community);
--   · an entry that belongs to no community: a platform admin only.
-- The role a person holds is judged by has_permission / org_private_can themselves, not by a copy of their SQL here, so a
-- later change to those functions cannot make the log and the checks disagree.
-- app.record_history (0758) reads the history of ONE record through audit_log_record_idx, a handful of rows with the same
-- rule applied to each, so it never scanned the log and stays as it is.
--
-- The callers' lookup is by user: role_grants had only (center_id, user_id) and (center_id, role_key), so add (user_id).
-- The two helpers start with an underscore like the other policy helpers (_org_holds, _perms_open_private): signed-in users
-- need to run them, because a policy runs with the reader's rights, but they are not part of the API the apps call, so
-- gen-types leaves them out and src/lib/database.types.ts (and the copies in connect-admin and connect-mobile) is unchanged.

create index if not exists role_grants_user_idx on app.role_grants (user_id);

-- The communities where the caller may read one kind of audit entry. It takes no user: it answers for auth.uid() only.
create or replace function app._audit_read_centers(p_scope text) returns table (readable_center uuid)
language sql stable security definer set search_path = app, public, extensions rows 3 as $$
  select c.id
    from (select o.center_id as id from app.center_owners o where o.user_id = auth.uid()
          union
          select g.center_id from app.role_grants g where g.user_id = auth.uid()) c
   where auth.uid() is not null and c.id is not null
     and case p_scope
           when 'entries'  then app.has_permission(c.id, 'audit.view')
           when 'care'     then app.is_center_owner(c.id) or app.org_private_can(c.id, 'care.manage')
           when 'matching' then app.is_center_owner(c.id) or app.org_private_can(c.id, 'matching.manage')
           else false
         end
$$;

-- Is there anything in the log the caller may read? False for a member who holds no audit permission anywhere.
create or replace function app._audit_can_read_any() returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (
            app.is_platform_admin()
         or exists (select 1 from app._audit_read_centers('entries'))
         or exists (select 1 from app._audit_read_centers('care'))
         or exists (select 1 from app._audit_read_centers('matching')))
$$;

revoke execute on function app._audit_read_centers(text), app._audit_can_read_any() from public, anon;
grant execute on function app._audit_read_centers(text), app._audit_can_read_any() to authenticated, service_role;

comment on function app._audit_read_centers(text) is
  'The communities where the caller may read one kind of audit entry (0788): entries = audit.view or owner, care / matching = owner or that product''s .manage key. Asked once per statement by the audit_read policy; the checks themselves are has_permission, is_center_owner and org_private_can.';
comment on function app._audit_can_read_any() is
  'Whether the caller may read any audit entry at all (0788). The audit_read policy asks it first, so a member with no audit permission gets an empty answer without the table being read.';

-- 0758's policy, with the caller's answer asked once per statement. Same rows for everyone.
drop policy if exists audit_read on app.audit_log;
create policy audit_read on app.audit_log for select to authenticated
  using ((select app._audit_can_read_any())
         and case module
               when 'care'
                 then center_id in (select r.readable_center from app._audit_read_centers('care') r)
               when 'matching'
                 then center_id in (select r.readable_center from app._audit_read_centers('matching') r)
               else (select app.is_platform_admin())
                    or center_id in (select r.readable_center from app._audit_read_centers('entries') r)
             end);
