-- 0661: the Messages commands in the activity allowlist (B91, after 0625; B90 phase 4, Messages).
--
-- Every run of a command from a screen, the search box (palette) or Niva is recorded under its own key, assistant.<area>_<verb>,
-- with commandable_key set to the command, so a pattern made only of command steps can be proposed as "something Niva could do"
-- (0625 did this for the first eight commands, 0651 for People, 0655 for Events). These are the eleven Messages commands added
-- with this change (src/lib/commands/catalog/messages). messages.draft_reminder was registered by 0625. Without a row a run of
-- the command is dropped by app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). Idempotent: the registration is an upsert.
--
-- The label is what an administrator reads in Settings > Automation ideas: it finishes "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.messages_inbox_triage',          'Look at what is waiting in the inbox',          'messages.inbox_triage'),
    ('assistant.messages_campaigns',             'Look at the messages waiting for approval',     'messages.campaigns'),
    ('assistant.messages_audience_preview',      'Preview who a message would reach',             'messages.audience_preview'),
    ('assistant.messages_why_not_delivered',     'Find out why a message did not go out',         'messages.why_not_delivered'),
    ('assistant.messages_draft_reply',           'Draft a reply from approved answers',           'messages.draft_reply'),
    ('assistant.messages_schedule_campaign',     'Schedule a message to families',                'messages.schedule_campaign'),
    ('assistant.messages_approve_campaign',      'Approve a message waiting for approval',        'messages.approve_campaign'),
    ('assistant.messages_set_campaign_status',   'Cancel a message or send it back for approval', 'messages.set_campaign_status'),
    ('assistant.messages_reply_to_thread',       'Reply to a conversation in the inbox',          'messages.reply_to_thread'),
    ('assistant.messages_set_thread',            'Take, hand back, close or reopen a conversation', 'messages.set_thread'),
    ('assistant.messages_handle_whatsapp_request', 'Decide a WhatsApp group request',             'messages.handle_whatsapp_request')
  ) as v(k, l, c);
