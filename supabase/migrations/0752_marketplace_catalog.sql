-- 0752 · Marketplace packs, part 3 of 4: the light catalog the Marketplace cards show (docs/MARKETPLACE_PLAN.md "Design",
-- docs/MARKETPLACE_PACKS.md; owner decision 2026-10-11 to 13: one product = one module key, plus a light catalog).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.marketplace_products   one row per product: its name, a line, what you get, what it needs, what members see, who can
--                              see its data, the price text, whether it is included, whether it is built, a target quarter,
--                              and the notes the Weaver team reads before turning it on or off. Platform data: written only by
--                              migrations, read by every signed-in person (nothing in it is private).
--
--   WHY NOT products + center_products (MARKETPLACE_PLAN's first design): whether a product is on for a community already lives
--   in exactly one place, the 0740 grant (Weaver's decision) and the community's own pause (app.center_modules). A second
--   per-community table would be a copy of that decision that can drift from it. So a product is keyed by its module key
--   (module_key, unique), and the module functions stay the only enforcement: RLS and every RPC guard ask
--   app.module_enabled, never this table. A product that has no module yet (Gala and Auctions) has no module_key and is
--   always "not built yet". Prices (Marketplace phase 2) join by product key later; nothing is charged in this build.
--
--   Copy (owner, 2026-10-13): the accepted prototype's words, claiming only what works today. WeCare and CatchTheMatch are
--   "not built yet" until their first slice ships (a later migration flips `status`); WeaverSite (a private draft works,
--   publishing does not yet) and CommunityConnect (WhatsApp sending works, Facebook and Instagram do not yet) are available.
--   No price is set except CatchTheMatch's (10% of each match received, never more than $500 a match; nothing is charged yet):
--   every other paid product says "Price not set yet". target_quarter is empty until the owner sets one; the card then says
--   "Not built yet" with no date.
set client_min_messages = warning;

create or replace function app.marketplace_needs_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select case when p is not null and jsonb_typeof(p) = 'array' then not exists (
           select 1 from jsonb_array_elements(p) e
            where jsonb_typeof(e) <> 'object'
               or jsonb_typeof(e->'module') is distinct from 'string'
               or (e ? 'note' and (jsonb_typeof(e->'note') <> 'string' or char_length(btrim(e->>'note')) not between 1 and 80))
               or exists (select 1 from jsonb_object_keys(e) k where k <> all (array['module', 'note'])))
         else false end
$$;

create table if not exists app.marketplace_products (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- The module the product switches (0740 grants it). Null only for a product with no module yet, which is never built.
  module_key     text unique references app.modules(key),
  name           text not null check (char_length(btrim(name)) between 1 and 60),
  -- Two or three letters for the card's badge.
  mark           text not null check (mark ~ '^[A-Za-z]{1,3}$'),
  line           text not null check (char_length(btrim(line)) between 1 and 300),
  gets           text[] not null default '{}' check (cardinality(gets) <= 8),
  -- What it needs: [{module, note?}] (People, Giving ...). Each one is shown as on or off for the community; a module the
  -- product's module depends on (app.modules.depends_on) must be on before Weaver turns the product on.
  needs          jsonb not null default '[]'::jsonb check (app.marketplace_needs_ok(needs)),
  members_line   text check (members_line is null or char_length(btrim(members_line)) between 1 and 300),
  data_line      text check (data_line is null or char_length(btrim(data_line)) between 1 and 300),
  price_text     text not null default 'Price not set yet' check (char_length(btrim(price_text)) between 1 and 200),
  price_short    text check (price_short is null or char_length(btrim(price_short)) between 1 and 40),
  -- Included with every community that has the module (no price, never requested; it is on unless paused).
  included       boolean not null default false,
  status         text not null check (status in ('available', 'not_built')),
  target_quarter text check (target_quarter is null or target_quarter ~ '^20[0-9]{2} Q[1-4]$'),
  -- What the Weaver team reads before turning it on or off (Platform › Communities › Products).
  on_note        text check (on_note is null or char_length(btrim(on_note)) between 1 and 400),
  off_note       text check (off_note is null or char_length(btrim(off_note)) between 1 and 400),
  sort           int not null default 0,
  check (module_key is not null or status = 'not_built'),
  check (not included or status = 'available')
);
comment on table app.marketplace_products is
  'The Marketplace catalog (0752): what each product''s card shows. Keyed by product key; module_key is the module the 0740 grant switches (null: not built, no module yet). Platform data, written only by migrations. Enforcement is the module, never this table.';

alter table app.marketplace_products enable row level security;
drop policy if exists marketplace_products_read on app.marketplace_products;
create policy marketplace_products_read on app.marketplace_products for select to authenticated using (true);
revoke all on app.marketplace_products from public, anon, authenticated;
grant select on app.marketplace_products to authenticated;
grant all on app.marketplace_products to service_role;
drop trigger if exists audit_marketplace_products on app.marketplace_products;
create trigger audit_marketplace_products after insert or update or delete on app.marketplace_products
  for each row execute function app.audit_row('key');
insert into app.module_tables (table_name, module_key) values ('marketplace_products', null)
on conflict (table_name) do update set module_key = excluded.module_key;

insert into app.marketplace_products
  (key, module_key, name, mark, line, gets, needs, members_line, data_line, price_text, price_short, included, status,
   target_quarter, on_note, off_note, sort)
values
  ('giving', 'giving', 'Giving', 'Gi',
   'Pledges, payments, receipts and statements, each matched to the right household.',
   array['Record and find payments in place', 'Pledges, campaigns and receipts',
         'Add-ons Weaver can turn on: bank reconciliation, offering counts, opportunities, recurring gifts, statements and insights'],
   '[{"module":"people"}]', null, null, 'Included', 'Included', true, 'available', null, null, null, 10),
  ('events', 'events', 'Event Weaver', 'Ev',
   'Events, RSVP, tickets, check-in, volunteer shifts and flyers.',
   array['RSVP, tickets and check-in', 'Volunteer shifts', 'Flyer templates (AI flyer art is part of iWeaver)'],
   '[{"module":"people"}]', null, null, 'Included', 'Included', true, 'available', null, null, null, 20),
  ('comms', 'comms', 'Communications', 'Co',
   'Email, text and app messages, sent only to people who agreed to each channel.',
   array['Email, text and app messages', 'Audiences that respect each consent', 'WhatsApp group links'],
   '[{"module":"people"}]', null, null, 'Included', 'Included', true, 'available', null, null, null, 30),
  ('accounting', 'accounting', 'Accounting and QuickBooks', 'QB',
   'Payments post to QuickBooks after the treasurer gives the final click.',
   array['Deposits and payments posted to QuickBooks', 'Donors matched to QuickBooks customers'],
   '[{"module":"giving"}]', null, null, 'Price not set yet', null, false, 'available', null, null, null, 40),
  ('ai', 'ai', 'iWeaver', 'iW',
   'Niva for members and staff, and AI flyer art. AI does the busywork. People make the final decisions.',
   array['Ask Niva in the member app', 'Niva for staff: answers, and actions you confirm', 'AI flyer art for events'],
   '[]', 'Members see Ask Niva in the app. AI used during setup works without iWeaver.', null,
   'Price not set yet', null, false, 'available', null, null,
   'Niva for members and staff and AI flyer art stop at once, including AI jobs already queued. AI used during setup keeps working.',
   50),
  ('store', 'store', 'Digital Store', 'DS',
   'Sell items and passes, with orders and pickup lists.',
   array['Items, passes and orders', 'Pickup lists for volunteers'],
   '[{"module":"people"}]', null, null, 'Included', 'Included', true, 'available', null, null, null, 60),
  ('care', 'care', 'WeCare', 'WC',
   'Donor care and member care: a care plan from your mission, every gift thanked, and a short weekly list for each relationship owner.',
   array['A yearly care plan drawn from your mission', 'A thank-you tracker for every gift', 'A relationship owner for each household',
         'Your 5 this week, each with a reason and a ready draft'],
   '[{"module":"people"},{"module":"giving","note":"for gift signs"}]', null,
   'Only the roles you choose can see care records, and amounts show only to roles that can see giving. Weaver staff cannot see them.',
   'Price not set yet', null, false, 'not_built', null,
   'Not built yet: turning it on changes nothing the community can see until its first part ships. Weaver staff, platform admins included, will not be able to read WeCare records.',
   null, 70),
  ('matching', 'matching', 'CatchTheMatch', 'CT',
   'Finds gifts that employers will match. Weaver’s team files the claims for you.',
   array['Gifts that may be matched, found for you', 'A ready request sent to the donor', 'Claims verified and filed by Weaver’s team',
         'Matches reconciled in the Bank tab'],
   '[{"module":"giving"}]', null, 'Weaver’s filing team sees matching claims only, through a role you grant.',
   '10% of each match you receive, never more than $500 a match. Nothing if no match arrives.', '10%, max $500 a match',
   false, 'not_built', null,
   'Not built yet: turning it on changes nothing the community can see until its first part ships. Fee once it is live: 10% of each match received, never more than $500 a match.',
   null, 80),
  ('website', 'website', 'WeaverSite', 'WS',
   'Your website, built from what Weaver already knows: your events, giving and leaders.',
   array['A first draft built from your current site', 'Events and giving pages fed from Weaver',
         'A private preview you approve page by page', 'Publishing and your own domain: not built yet'],
   '[{"module":"people"}]', null, null, 'Price not set yet', null, false, 'available', null,
   'The site stays a private draft until publishing is built.', null, 90),
  ('channels', 'channels', 'CommunityConnect', 'CC',
   'WhatsApp messages from your WhatsApp Business account. Facebook and Instagram posts for events are not built yet.',
   array['WhatsApp messages through your WhatsApp Business account', 'Facebook and Instagram posts for events: not built yet'],
   '[{"module":"comms"},{"module":"events","note":"for Facebook and Instagram"}]', null,
   'Meta may charge for each WhatsApp conversation.', 'Price not set yet', null, false, 'available', null,
   'WhatsApp messages send only after Meta approves the community’s Business account. Facebook and Instagram are not built yet.',
   'WhatsApp messages stop at once, including messages already queued. WhatsApp group links stay in Communications.', 100),
  ('gala', null, 'Gala and Auctions', 'GA',
   'Ticketed evenings with live and silent auctions.',
   array['Ticket tiers, tables and seating', 'Live and silent auctions with paddle numbers'],
   '[{"module":"events"},{"module":"giving"}]', null, null, 'Price not set yet', null, false, 'not_built', null, null, null, 110)
on conflict (key) do update set
  module_key = excluded.module_key, name = excluded.name, mark = excluded.mark, line = excluded.line, gets = excluded.gets,
  needs = excluded.needs, members_line = excluded.members_line, data_line = excluded.data_line, price_text = excluded.price_text,
  price_short = excluded.price_short, included = excluded.included, status = excluded.status,
  target_quarter = excluded.target_quarter, on_note = excluded.on_note, off_note = excluded.off_note, sort = excluded.sort;

-- Every module a product needs is a real module (a typo would show as an unknown line on every card).
do $$
declare v_bad text;
begin
  select string_agg(p.key || ' needs "' || (e->>'module') || '"', ', ') into v_bad
    from app.marketplace_products p cross join lateral jsonb_array_elements(p.needs) e
   where not exists (select 1 from app.modules m where m.key = e->>'module');
  if v_bad is not null then raise exception 'The Marketplace catalog names modules that do not exist: %.', v_bad; end if;
end $$;

