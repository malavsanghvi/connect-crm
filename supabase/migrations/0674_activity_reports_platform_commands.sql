-- 0674: the Reports and Platform commands are in the activity allowlist (B91, after 0625; B90 phase 4).
--
-- Every run of a command from a screen, the search box (palette) or Niva is recorded under its own key, assistant.<area>_<verb>,
-- with commandable_key set to the command, so a pattern made only of command steps can be proposed as "something Niva could do"
-- (0625 did this for the first eight commands, 0651 for People, 0655 for Events, 0661 for Messages, 0663 for Settings). These are
-- the eight Reports commands (seven that add up numbers in the database, and the one thing only the person does: publish a figure on
-- the public dashboard) and the fifteen Platform console commands (the team's inbox and community summary, a preview of a change of
-- kind, and twelve things only the Weaver team does on the Platform screens). Without a row a run of the command is dropped by
-- app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). Idempotent: the registration is an upsert.
--
-- The label is what an administrator reads in Settings > Automation ideas: it finishes "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.reports_overview',                  'Look at how the community is doing this year',          'reports.overview'),
    ('assistant.reports_giving_totals',             'Add up the money received',                             'reports.giving_totals'),
    ('assistant.reports_campaign_progress',         'Look at how each campaign is doing',                    'reports.campaign_progress'),
    ('assistant.reports_membership_counts',         'Count memberships and what changed',                    'reports.membership_counts'),
    ('assistant.reports_event_attendance',          'Count event check-ins',                                 'reports.event_attendance'),
    ('assistant.reports_store_sales',               'Add up store sales',                                    'reports.store_sales'),
    ('assistant.reports_compare_months',            'Compare this month with last month',                    'reports.compare_months'),
    ('assistant.reports_publish_kpi',               'Ask where to publish a figure on the public dashboard', 'reports.publish_kpi'),
    ('assistant.platform_waiting',                  'Look at who is waiting for the team and what is missing', 'platform.waiting'),
    ('assistant.platform_community_summary',        'Look at the summary of one community',                  'platform.community_summary'),
    ('assistant.platform_preview_kind_change',      'Preview a change of kind of organization',              'platform.preview_kind_change'),
    ('assistant.platform_change_kind',              'Ask where to change a kind of organization',            'platform.change_kind'),
    ('assistant.platform_decide_access_request',    'Ask where to decide a request for access',              'platform.decide_access_request'),
    ('assistant.platform_decide_go_live',           'Ask where to approve or send back a go-live request',   'platform.decide_go_live'),
    ('assistant.platform_decide_verification',      'Ask where to review nonprofit papers',                  'platform.decide_verification'),
    ('assistant.platform_set_limits_and_addresses', 'Ask where to change limits or portal addresses',        'platform.set_limits_and_addresses'),
    ('assistant.platform_set_community_switches',   'Ask where to switch recording or Niva actions',         'platform.set_community_switches'),
    ('assistant.platform_pause_ways_to_pay',        'Ask where to pause or restart a way to pay',            'platform.pause_ways_to_pay'),
    ('assistant.platform_create_sandbox',           'Ask where to create a sandbox',                         'platform.create_sandbox'),
    ('assistant.platform_manage_sandbox_codes',     'Ask where to issue or cancel a sandbox code',           'platform.manage_sandbox_codes'),
    ('assistant.platform_end_support_access',       'Ask where to end a support access window',              'platform.end_support_access'),
    ('assistant.platform_publish_agreement',        'Ask where to edit or publish an agreement',             'platform.publish_agreement'),
    ('assistant.platform_run_platform_setup',       'Ask where to set up the platform services',             'platform.run_platform_setup')
  ) as v(k, l, c);
