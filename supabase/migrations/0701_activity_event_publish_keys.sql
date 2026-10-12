-- 0701: the event creator's flyer and publish panel in the activity allowlist (after 0620; the panel is 0700's).
--
-- The panel's Server Actions record what a person did under these keys (withActivity, src/app/(app)/events/
-- flyer-publish-actions.ts and the flyer maker's save): approving a flyer, withdrawing that approval, scheduling an event to be
-- published and cancelling the schedule. "Publish now" runs the existing events.set_status, already listed by 0620. Without a
-- row an action is dropped by app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). Idempotent: the registration is an upsert.
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('events.flyer_approve',      'Approve an event''s flyer',              'event'),
    ('events.flyer_unapprove',    'Withdraw the approval of a flyer',       'event'),
    ('events.publish_schedule',   'Schedule an event to be published',      'event'),
    ('events.publish_unschedule', 'Cancel an event''s scheduled publish',   'event')
  ) as v(k, l, e);
