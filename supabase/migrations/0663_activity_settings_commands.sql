-- 0663: the Settings and Setup commands are in the activity allowlist (B91, after 0625; B90 phase 4).
--
-- Every run of a command from a screen, the search box (palette) or Niva is recorded under its own key, assistant.<area>_<verb>,
-- with commandable_key set to the command, so a pattern made only of command steps can be proposed as "something Niva could do"
-- (0625 did this for the first eight commands; src/lib/commands/activity.ts builds the key). These are the fifteen Settings and
-- Setup commands: six that look or prepare (what is left before going live, who holds a role, who can see or do something, whether
-- the connected services work, which modules are on, a prepared role) and nine "only you" ones whose whole answer is where the
-- person does it themselves. Without a row a run of the command is dropped by app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). Idempotent: the registration is an upsert.
--
-- The label is what an administrator reads in Settings > Automation ideas: it finishes "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.settings_setup_status',          'Look at what is left before going live',           'settings.setup_status'),
    ('assistant.settings_role_holders',          'Look at who holds a role',                         'settings.role_holders'),
    ('assistant.settings_who_can_access',        'Look at who can see or do something',              'settings.who_can_access'),
    ('assistant.settings_integrations_health',   'Check that the connected services work',           'settings.integrations_health'),
    ('assistant.settings_modules_state',         'Look at which modules are switched on',            'settings.modules_state'),
    ('assistant.settings_draft_role_grant',      'Prepare a role for someone',                       'settings.draft_role_grant'),
    ('assistant.settings_enter_secret',          'Ask where to enter a secret or a key',             'settings.enter_secret'),
    ('assistant.settings_accept_agreements',     'Ask where to accept the agreements',               'settings.accept_agreements'),
    ('assistant.settings_connect_quickbooks',    'Ask where to connect QuickBooks',                  'settings.connect_quickbooks'),
    ('assistant.settings_connect_payments',      'Ask where to connect a payment account',           'settings.connect_payments'),
    ('assistant.settings_change_domain_records', 'Ask where to change the email domain records',     'settings.change_domain_records'),
    ('assistant.settings_confirm_as_owner',      'Ask where to confirm as the owner',                'settings.confirm_as_owner'),
    ('assistant.settings_send_nonprofit_proof',  'Ask where to send the non-profit proof',           'settings.send_nonprofit_proof'),
    ('assistant.settings_go_live',               'Ask where to go live',                             'settings.go_live'),
    ('assistant.settings_second_approval',       'Ask where to approve a role as the second person', 'settings.second_approval')
  ) as v(k, l, c);
