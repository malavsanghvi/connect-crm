-- 0644 · Activity: the website draft preview and its two actions are recorded under their own keys (B92 W3, B91).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0642 added the first draft of an organization's website, with a private preview page and two actions (build the first
--   draft; approve a page or reopen it). This lists them in the activity allowlist (0620), so that, once a community's own
--   administrator has agreed to the activity stream (0621), opening the preview, building the draft and approving a page are
--   recorded like every other portal action. The database drops an event whose key is not listed, silently, so without this
--   the preview and its actions would be invisible to the stream.
--   It changes no behaviour, no table, no column, no policy and no permission. Idempotent: the registrations are upserts.

select app.activity_register(v.k, v.kind, 'portal', v.l, null)
  from (values
    ('screen:/setup/website/preview', 'screen', 'Website draft preview'),
    ('website.build_draft',           'action', 'Build the first draft of the website'),
    ('website.approve_page',          'action', 'Approve a page of the website draft, or reopen it')
  ) as v(k, kind, l);
