-- 0664: the three Settings changes are in the activity allowlist (B91, after 0625 and 0663; B90 phase 4).
--
-- Giving a role, taking a role away and switching a module are commands the Roles and Modules screens, the search box (palette) and
-- Niva run. Every run is recorded under its own key, assistant.<area>_<verb>, with commandable_key set to the command, so a pattern
-- made only of command steps can be proposed as "something Niva could do" (src/lib/commands/activity.ts builds the key). Without a
-- row a run of the command is dropped by app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, function, policy or permission changes. The commands themselves use the functions and
-- policies that already exist (role_grants and its trigger app.enforce_role_grant, app.set_module_enabled). Nothing is recorded
-- anywhere until a community's own administrator has agreed (0621). Idempotent: the registration is an upsert.
--
-- The label is what an administrator reads in Settings > Automation ideas: it finishes "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.settings_grant_role',  'Give a role to someone',        'settings.grant_role'),
    ('assistant.settings_revoke_role', 'Take a role away from someone', 'settings.revoke_role'),
    ('assistant.settings_set_module',  'Switch a module on or off',     'settings.set_module')
  ) as v(k, l, c);
