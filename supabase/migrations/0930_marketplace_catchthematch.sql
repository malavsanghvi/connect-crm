-- 0930 · CatchTheMatch Phase 1, piece 5: the Marketplace card says what is built (docs/CATCH_THE_MATCH.md section 13; owner request of 2026-10-17).
-- NEEDS OWNER OK BEFORE IT IS MERGED: marking the product built (not_built to available) EMAILS every community that pressed "Tell me when it is ready"
-- for CatchTheMatch (app.marketplace_products_ready_notice, 0753), once, to the person who asked if they still manage the community's settings.
-- Count who would be told before merging:
--   select count(*) from app.marketplace_interest where product_key = 'matching' and told_at is null;
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   The card said "Not built yet", "filed by Weaver's team" and "10% of each match you receive, never more than $500 a match". None of that is what
--   Phase 1 does (owner direction of 2026-10-17, decision C10): CatchTheMatch guides the member and records the match; Weaver's team does not file for the
--   organization (that is Phase 2, paused until a lawyer's view, a secular pilot and Marketplace billing), and no fee is charged or promised (pricing is the
--   owner's, once Marketplace billing exists, B120; 2026-10-13: "Pricing not committed"). So the card now:
--     * is AVAILABLE (a community can request it; Weaver turns it on),
--     * says only what is built: the members to catch, the steps for each employer written by Weaver's team and sent to the member (by message, and in the
--       member app), asking families for their employer with their consent, the match recorded in Giving as the employer's gift with the donor's thank-you,
--     * says "Price not set yet" and drops the old fee text and its short form,
--     * says who can see it (the roles the community chooses; Weaver's team cannot), and that the steps are shared facts about employers, never about a person.
--   The module's description in app.modules says the same. Nothing here switches anything on for any community: Weaver still turns the product on, per community.
set client_min_messages = warning;

update app.modules
   set description = 'Employer matching for the gifts the organization receives: finds the members whose employer matches, tells each one how to claim from their own employer, tracks every claim and records the match in Giving. Weaver''s team does not file for the organization yet.'
 where key = 'matching';

update app.marketplace_products
   set line = 'Finds the members whose employer matches gifts and tells each one exactly how to claim. You follow every claim to its end.',
       gets = array['Members to catch: gifts that may be matched, where another member of the same employer already got a match',
                    'The steps for each employer, written by Weaver’s team, sent to the member by message and in the member app',
                    'Ask your families for their employer, with their consent, and see when a member says they asked',
                    'Each match recorded in Giving as the employer’s gift, with the donor credited and thanked'],
       needs = '[{"module":"giving"}]'::jsonb,
       members_line = 'A member adds their employer only with their consent, can remove it at any time, and sees only their own requests.',
       data_line = 'Only the roles you choose can see CatchTheMatch records, and amounts show only to roles that can see giving. Weaver’s team cannot see them. The steps for an employer are shared facts about the employer, never about a person or a community.',
       price_text = 'Price not set yet',
       price_short = null,
       included = false,
       status = 'available',
       target_quarter = null,
       on_note = 'No fee is charged. Weaver’s team does not file claims for the community yet: CatchTheMatch guides the members and records the matches the community receives.',
       off_note = 'CatchTheMatch’s screens, its claims and the member app’s card close at once. Nothing already recorded in Giving is changed.'
 where key = 'matching';
