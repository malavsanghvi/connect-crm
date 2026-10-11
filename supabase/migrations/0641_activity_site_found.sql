-- 0641 · Activity: the "Your website" screen and its two actions are recorded under their own keys (B92 W2, B91).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0640 added Setup › Your website. This lists its screen and its two actions in the activity allowlist (0620), so that,
--   once a community's own administrator has agreed to the activity stream (0621), opening the screen, saving the
--   addresses and pressing "Look at my website" are recorded like every other portal action. The database drops an
--   event whose key is not listed, silently, so without this the screen would be invisible to the stream.
--   It changes no behaviour, no table, no column, no policy and no permission. Idempotent: the registrations are upserts.

select app.activity_register(v.k, v.kind, 'portal', v.l, null)
  from (values
    ('screen:/setup/website',   'screen', 'Your website'),
    ('website.save_addresses',  'action', 'Save the website addresses'),
    ('website.look_at_site',    'action', 'Look at the organization''s website')
  ) as v(k, kind, l);
