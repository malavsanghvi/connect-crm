-- 0898 · The DonorDelight Marketplace card is no longer "Not built yet" (DonorDelight slices 1 to 9; docs/DONORDELIGHT.md section 12).
--
-- PREPARED, NOT MERGED. This is a catalog change with a side effect, so it waits for the owner (DonorDelight build brief, 2026-10-17):
-- flipping a product's status from `not_built` to `available` fires 0753's trigger, which EMAILS every community that pressed
-- "Tell me when it is ready" ("DonorDelight is ready"). Merge it only when the owner says so, after the DonorDelight pull requests
-- (332 to 336) are deployed, so the card never claims something that is not live. The email provider is still not configured (B116), so until it
-- is, those emails queue and are not delivered.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   * app.marketplace_products, key `care`: status `available` (communities can Request it; the Weaver team grants it), and the card's words say
--     only what works today. The price stays "Price not set yet": nothing is charged (slice 10, price and billing, is not built).
--   * app.modules, key `care`: its description no longer says "Not built yet".
--   Nothing else: no table, no function, no permission, no role, no policy. The module key, the grant-only availability and every record are
--   as they were. What the card claims is written against the built slices:
--     thank-you tracker and signs (2 to 4), playbooks and "Your 5 this week" (5), gesture library (6), who to approach (7),
--     Niva commands and the care plan from the mission (8), and the member's own "How would you like to be thanked?" in the app (9).
--   Left out of the card on purpose: anything about money paid for the product, outside wealth screening (there is none), and a date.
set client_min_messages = warning;

select app.set_audit_context('0898: the DonorDelight Marketplace card is available (copy written against the built slices)');

update app.modules
   set description = 'Donor care and member care: a thank-you for every gift, a relationship owner for each household, a short weekly list, and a yearly care plan from the mission.'
 where key = 'care';

update app.marketplace_products
   set line = 'Donor care and member care: every gift thanked, a relationship owner for each household, a short weekly list, and a yearly care plan from your mission.',
       gets = array[
         'A thank-you tracker for every gift',
         'A relationship owner for each household',
         'Signs that a household is cooling or at risk',
         'Playbooks and "Your 5 this week", each with a reason',
         'A gesture library: thanks that never come with an ask',
         'Who to approach, held back by rest periods and a touch balance you set',
         'A yearly care plan drawn from your mission',
         'Niva can brief you and draft a note; it needs iWeaver and your own tick'],
       members_line = 'If you ask them, an adult in the member app says how their household would like to be thanked, recognised and reached. Members never see notes, signs or who looks after them. This needs the member app update that has "How would you like to be thanked?".',
       data_line = 'Only the roles you choose can see care records, and amounts show only to roles that can see giving. No one under 18 is in any care record. Weaver staff cannot see them.',
       status = 'available',
       on_note = 'Turning it on shows the Care area to the people you give a care role, and nothing to members until you switch on "Ask members" in Care. The weekly reminder goes through your messaging settings once email is set up. Niva helps only with iWeaver on and the community''s own tick. No price is charged yet.',
       off_note = 'The Care area, its week list and its reminders are hidden at once for everyone; nothing is deleted. Niva stops helping with care.'
 where key = 'care';
