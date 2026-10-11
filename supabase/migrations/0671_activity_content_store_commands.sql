-- 0671: the Content and Store commands in the activity allowlist (B91, after 0625; B90 phase 4, Content and Store).
--
-- Every run of a command from a screen, the search box (palette) or Niva is recorded under its own key, assistant.<area>_<verb>,
-- with commandable_key set to the command, so a pattern made only of command steps can be proposed as "something Niva could do"
-- (0625 did this for the first eight commands, 0651 for People, 0655 for Events, 0661 for Messages, 0663 for Settings). These are
-- the fourteen commands added with this change: six for Content and eight for Store (src/lib/commands/catalog/content and
-- src/lib/commands/catalog/store). Without a row a run of the command is dropped by app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). Idempotent: the registration is an upsert.
--
-- The label is what an administrator reads in Settings > Automation ideas: it finishes "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.content_approval_queue',   'Look at what is waiting in the approval queue',  'content.approval_queue'),
    ('assistant.content_niva_sources',     'Look at the sources Niva answers from',          'content.niva_sources'),
    ('assistant.content_media_library',    'Look at the media library',                      'content.media_library'),
    ('assistant.content_draft_item',       'Draft a piece of content',                       'content.draft_item'),
    ('assistant.content_decide_item',      'Publish a waiting item or send it back',         'content.decide_item'),
    ('assistant.content_archive_item',     'Take a published item out of use',               'content.archive_item'),
    ('assistant.store_orders_waiting',     'Look at the store orders waiting for pickup',    'store.orders_waiting'),
    ('assistant.store_low_stock',          'Look at which store items are running low',      'store.low_stock'),
    ('assistant.store_sales_summary',      'Look at the store sales for a period',           'store.sales_summary'),
    ('assistant.store_products',           'Look at the store products and prices',          'store.products'),
    ('assistant.store_draft_product',      'Prepare a new store product or a price change',  'store.draft_product'),
    ('assistant.store_set_order_status',   'Move a store order along',                       'store.set_order_status'),
    ('assistant.store_adjust_stock',       'Adjust the stock of a store item',               'store.adjust_stock'),
    ('assistant.store_change_price',       'Change the price of a store item',               'store.change_price')
  ) as v(k, l, c);
