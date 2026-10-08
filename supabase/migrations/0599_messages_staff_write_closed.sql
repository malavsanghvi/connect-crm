-- 0599: staff can no longer write app.messages directly (BACKLOG B49 item 3).
--
-- The gap: the standard staff policies of 0010 (app._staff_policies('messages', 'comms.view', 'comms.send')) gave anyone
-- with comms.send the policy messages_staff_write, "for all": a signed-in staff member could insert, change or delete
-- rows of the message queue through the API. A row written that way has no job, so it is never sent; it may name any
-- address and any body, and it skips what app.enqueue_message does for every real message: the template, the sandbox
-- allow-list, suppressions and opt-outs, quiet hours, the deceased rule and the audit context.
--
-- The fix: messages are written only by the database's own functions (app.enqueue_message, app.enqueue_notice and the
-- worker's result functions, all security definer) and by the service role. Staff keep reading
-- (messages_staff_read: comms.view or comms.send), members keep reading their own in-app messages (messages_own) and the
-- platform team keeps reading platform messages (messages_platform_read). Every screen that sends a message does it
-- through a function (send_test_message, send_recipient_verification, the sign-in hooks), which is unchanged.
--
-- Access change: ASKED OF THE OWNER in the pull request before merge.
set client_min_messages = warning;

drop policy if exists messages_staff_write on app.messages;
-- No policy would already refuse these rows; taking the privilege away too means a policy added by mistake later does
-- not open the queue again.
revoke insert, update, delete on app.messages from authenticated;

comment on table app.messages is
  'The message queue (0008, 0221, 0596, 0598). Written only by the database''s sending functions (app.enqueue_message, app.enqueue_notice, the worker_* result functions: security definer) and the service role: since 0599 no signed-in role can insert, update or delete a row. Staff with comms.view or comms.send read it (messages_staff_read).';
