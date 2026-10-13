-- 0765 · CatchTheMatch slice 2, part 1: the SHARED employer-program directory (docs/CATCH_THE_MATCH.md sections 6, 7 and 9;
-- owner answers of 2026-10-13). Builder MATCH2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   One directory of employers' matching-gift and volunteer-grant programs, shared by every community that has CatchTheMatch
--   (module `matching`) on. Public facts only: the company and the other names it goes by, the ratio, the minimum and maximum
--   per gift and per year, the kinds of gift and of organization that qualify (and whether religious organizations do, or
--   only their programs that are not worship), the portal and its link, the deadline, the volunteer-grant rules, where the
--   facts come from, when they were last checked and by whom (Weaver's team or a community). NEVER who works there or who
--   gave: nothing in these tables names a person, and nothing here counts them.
--     app.match_programs           one row per program (a company may have one per country), with a version number
--     app.match_program_names      the company's name and the other names it goes by, each with a key for matching. A name
--                                  is never deleted: one no longer given is kept as a retired alias (not matched, but no
--                                  community can reuse it without Weaver's team).
--     app.match_program_versions   every version of an entry's facts and names, who wrote it (Weaver's team or which
--                                  community) and why; Weaver's team only. Weaver's team reverts an entry to an earlier one.
--     app.employer_name_key(t)     the key, the same whatever the database's locale: compatibility decomposition (full-width
--                                  letters, ligatures), Unicode case folding written out as data (ß and ẞ to ss, final sigma
--                                  to sigma, every cased script), accents of the Latin, Greek and Cyrillic scripts dropped,
--                                  and every space, punctuation mark, symbol, currency sign, emoji, invisible character and
--                                  variation selector dropped (™ and ℠ too). Letters, digits and marks of every other script
--                                  are kept as they are, and no word of any language is treated specially: "ＡＣＭＥ Corp.",
--                                  "acme corp" and "ACME-CORP" share a key, and "株式会社日立製作所" contains "日立製作所".
--                                  A name is found inside a longer one (or the other way round) only when the shorter key has
--                                  at least 3 characters.
--   The directory starts EMPTY (owner, 2026-10-13): Weaver's team adds entries from the employers' own pages, with the source
--   and the date. A licensed database later would be the source 'partner', which only Weaver's team may name.
--
--   WHO READS: Weaver's team (platform admins), and the organization's own CatchTheMatch readers (matching.view or
--   matching.manage, 0757: not Weaver's filing grant) of at least one community where it is on. Everyone else reads nothing.
--   WHO WRITES: nobody directly. Weaver's team through app.save_match_program, app.set_match_program_retired,
--   app.merge_match_programs and app.revert_match_program (a reason each). A community's CatchTheMatch manager by
--   approving a submission (0766), within the limits 0766 sets.
--   AUDIT: app.audit_shared_row: when, before and after, and who, the address, browser, request and screen only when it is
--   Weaver's team. A community's manager is never named in this history: the reason names the community instead (owner:
--   Weaver sees the submitting community's name, never the person). module = null and no community: the history belongs to
--   Weaver's directory, so platform admins read it (0758's audit_read), and nothing in it is about a person.
--   The organization's own CatchTheMatch data (submissions 0766, links of employers on file to entries 0767) keeps 0757's
--   contract: the organization's own readers only, no platform-admin read, a private audit.
set client_min_messages = warning;

-- ── The lists ────────────────────────────────────────────────────────────────
-- Where the employee asks for the match.
create or replace function app.match_portals() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['benevity', 'yourcause', 'cybergrants', 'bright_funds', 'employer_form', 'other']::text[]
$$;
-- Gifts the employer matches.
create or replace function app.match_gift_types() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['one_time', 'recurring', 'payroll', 'stock', 'donor_advised_fund', 'event']::text[]
$$;
-- Kinds of organization the employer matches gifts to (religious organizations have their own rule below).
create or replace function app.match_org_kinds() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['any_charity', 'education', 'arts_culture', 'health', 'human_services', 'environment_animals',
               'civic_community', 'international']::text[]
$$;
-- Religious organizations: eligible; only their programs that are not worship (a food bank, classes); not eligible.
-- Null on a program: not known yet.
create or replace function app.match_religious_rules() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['eligible', 'non_worship_only', 'excluded']::text[]
$$;
-- When the match must be asked for: by December 31 of the gift's year; within N months of the gift; by a date in the year
-- after the gift; no deadline. Null: not known yet.
create or replace function app.match_deadline_kinds() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['end_of_gift_year', 'months_after_gift', 'date_next_year', 'none']::text[]
$$;
-- Where the facts come from. 'partner': a licensed matching-gift database, later (Weaver's team only).
create or replace function app.match_sources() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['employer_site', 'employer_document', 'portal_listing', 'submission', 'partner', 'other']::text[]
$$;

-- ── The key a name is matched on ─────────────────────────────────────────────
-- Generated from the Unicode character database (15.1): the case-fold pairs of every character that has no decomposition
-- (a decomposable one is decomposed first), and every character of the space, punctuation, symbol, control and format
-- categories, the Latin/Greek/Cyrillic combining accents, the combining marks for symbols and the variation selectors.
-- No lower() and no collation: the same key on any database.
create or replace function app.employer_name_key(p text) returns text
language sql immutable parallel safe set search_path = app, public, extensions as $$
  select nullif(
           regexp_replace(
             translate(
               normalize(replace(replace(replace(replace(coalesce(p, ''), U&'\2122', ''), U&'\2120', ''), U&'\00DF', 'ss'),
                                 U&'\1E9E', 'ss'), nfkd),
               U&'\0041\0042\0043\0044\0045\0046\0047\0048\0049\004A\004B\004C\004D\004E\004F\0050\0051\0052\0053\0054\0055\0056\0057\0058\0059\005A\00C6\00D0\00D8\00DE\0110\0126\0141\014A\0152\0166\0181\0182\0184\0186'
               || U&'\0187\0189\018A\018B\018E\018F\0190\0191\0193\0194\0196\0197\0198\019C\019D\019F\01A2\01A4\01A6\01A7\01A9\01AC\01AE\01B1\01B2\01B3\01B5\01B7\01B8\01BC\01E4\01F6\01F7\021C\0220\0222\0224\023A\023B\023D'
               || U&'\023E\0241\0243\0244\0245\0246\0248\024A\024C\024E\0345\0370\0372\0376\037F\0391\0392\0393\0394\0395\0396\0397\0398\0399\039A\039B\039C\039D\039E\039F\03A0\03A1\03A3\03A4\03A5\03A6\03A7\03A8\03A9\03C2'
               || U&'\03CF\03D8\03DA\03DC\03DE\03E0\03E2\03E4\03E6\03E8\03EA\03EC\03EE\03F7\03FA\03FD\03FE\03FF\0402\0404\0405\0406\0408\0409\040A\040B\040F\0410\0411\0412\0413\0414\0415\0416\0417\0418\041A\041B\041C\041D'
               || U&'\041E\041F\0420\0421\0422\0423\0424\0425\0426\0427\0428\0429\042A\042B\042C\042D\042E\042F\0460\0462\0464\0466\0468\046A\046C\046E\0470\0472\0474\0478\047A\047C\047E\0480\048A\048C\048E\0490\0492\0494'
               || U&'\0496\0498\049A\049C\049E\04A0\04A2\04A4\04A6\04A8\04AA\04AC\04AE\04B0\04B2\04B4\04B6\04B8\04BA\04BC\04BE\04C0\04C3\04C5\04C7\04C9\04CB\04CD\04D4\04D8\04E0\04E8\04F6\04FA\04FC\04FE\0500\0502\0504\0506'
               || U&'\0508\050A\050C\050E\0510\0512\0514\0516\0518\051A\051C\051E\0520\0522\0524\0526\0528\052A\052C\052E\0531\0532\0533\0534\0535\0536\0537\0538\0539\053A\053B\053C\053D\053E\053F\0540\0541\0542\0543\0544'
               || U&'\0545\0546\0547\0548\0549\054A\054B\054C\054D\054E\054F\0550\0551\0552\0553\0554\0555\0556\10A0\10A1\10A2\10A3\10A4\10A5\10A6\10A7\10A8\10A9\10AA\10AB\10AC\10AD\10AE\10AF\10B0\10B1\10B2\10B3\10B4\10B5'
               || U&'\10B6\10B7\10B8\10B9\10BA\10BB\10BC\10BD\10BE\10BF\10C0\10C1\10C2\10C3\10C4\10C5\10C7\10CD\13F8\13F9\13FA\13FB\13FC\13FD\1C80\1C81\1C82\1C83\1C84\1C85\1C86\1C87\1C88\1C90\1C91\1C92\1C93\1C94\1C95\1C96'
               || U&'\1C97\1C98\1C99\1C9A\1C9B\1C9C\1C9D\1C9E\1C9F\1CA0\1CA1\1CA2\1CA3\1CA4\1CA5\1CA6\1CA7\1CA8\1CA9\1CAA\1CAB\1CAC\1CAD\1CAE\1CAF\1CB0\1CB1\1CB2\1CB3\1CB4\1CB5\1CB6\1CB7\1CB8\1CB9\1CBA\1CBD\1CBE\1CBF\1EFA'
               || U&'\1EFC\1EFE\2132\2183\2C00\2C01\2C02\2C03\2C04\2C05\2C06\2C07\2C08\2C09\2C0A\2C0B\2C0C\2C0D\2C0E\2C0F\2C10\2C11\2C12\2C13\2C14\2C15\2C16\2C17\2C18\2C19\2C1A\2C1B\2C1C\2C1D\2C1E\2C1F\2C20\2C21\2C22\2C23'
               || U&'\2C24\2C25\2C26\2C27\2C28\2C29\2C2A\2C2B\2C2C\2C2D\2C2E\2C2F\2C60\2C62\2C63\2C64\2C67\2C69\2C6B\2C6D\2C6E\2C6F\2C70\2C72\2C75\2C7E\2C7F\2C80\2C82\2C84\2C86\2C88\2C8A\2C8C\2C8E\2C90\2C92\2C94\2C96\2C98'
               || U&'\2C9A\2C9C\2C9E\2CA0\2CA2\2CA4\2CA6\2CA8\2CAA\2CAC\2CAE\2CB0\2CB2\2CB4\2CB6\2CB8\2CBA\2CBC\2CBE\2CC0\2CC2\2CC4\2CC6\2CC8\2CCA\2CCC\2CCE\2CD0\2CD2\2CD4\2CD6\2CD8\2CDA\2CDC\2CDE\2CE0\2CE2\2CEB\2CED\2CF2'
               || U&'\A640\A642\A644\A646\A648\A64A\A64C\A64E\A650\A652\A654\A656\A658\A65A\A65C\A65E\A660\A662\A664\A666\A668\A66A\A66C\A680\A682\A684\A686\A688\A68A\A68C\A68E\A690\A692\A694\A696\A698\A69A\A722\A724\A726'
               || U&'\A728\A72A\A72C\A72E\A732\A734\A736\A738\A73A\A73C\A73E\A740\A742\A744\A746\A748\A74A\A74C\A74E\A750\A752\A754\A756\A758\A75A\A75C\A75E\A760\A762\A764\A766\A768\A76A\A76C\A76E\A779\A77B\A77D\A77E\A780'
               || U&'\A782\A784\A786\A78B\A78D\A790\A792\A796\A798\A79A\A79C\A79E\A7A0\A7A2\A7A4\A7A6\A7A8\A7AA\A7AB\A7AC\A7AD\A7AE\A7B0\A7B1\A7B2\A7B3\A7B4\A7B6\A7B8\A7BA\A7BC\A7BE\A7C0\A7C2\A7C4\A7C5\A7C6\A7C7\A7C9\A7D0'
               || U&'\A7D6\A7D8\A7F5\AB70\AB71\AB72\AB73\AB74\AB75\AB76\AB77\AB78\AB79\AB7A\AB7B\AB7C\AB7D\AB7E\AB7F\AB80\AB81\AB82\AB83\AB84\AB85\AB86\AB87\AB88\AB89\AB8A\AB8B\AB8C\AB8D\AB8E\AB8F\AB90\AB91\AB92\AB93\AB94'
               || U&'\AB95\AB96\AB97\AB98\AB99\AB9A\AB9B\AB9C\AB9D\AB9E\AB9F\ABA0\ABA1\ABA2\ABA3\ABA4\ABA5\ABA6\ABA7\ABA8\ABA9\ABAA\ABAB\ABAC\ABAD\ABAE\ABAF\ABB0\ABB1\ABB2\ABB3\ABB4\ABB5\ABB6\ABB7\ABB8\ABB9\ABBA\ABBB\ABBC'
               || U&'\ABBD\ABBE\ABBF\+010400\+010401\+010402\+010403\+010404\+010405\+010406\+010407\+010408\+010409\+01040A\+01040B\+01040C\+01040D\+01040E\+01040F\+010410\+010411\+010412\+010413\+010414\+010415\+010416\+010417\+010418\+010419\+01041A\+01041B\+01041C\+01041D\+01041E\+01041F\+010420\+010421\+010422\+010423\+010424'
               || U&'\+010425\+010426\+010427\+0104B0\+0104B1\+0104B2\+0104B3\+0104B4\+0104B5\+0104B6\+0104B7\+0104B8\+0104B9\+0104BA\+0104BB\+0104BC\+0104BD\+0104BE\+0104BF\+0104C0\+0104C1\+0104C2\+0104C3\+0104C4\+0104C5\+0104C6\+0104C7\+0104C8\+0104C9\+0104CA\+0104CB\+0104CC\+0104CD\+0104CE\+0104CF\+0104D0\+0104D1\+0104D2\+0104D3\+010570'
               || U&'\+010571\+010572\+010573\+010574\+010575\+010576\+010577\+010578\+010579\+01057A\+01057C\+01057D\+01057E\+01057F\+010580\+010581\+010582\+010583\+010584\+010585\+010586\+010587\+010588\+010589\+01058A\+01058C\+01058D\+01058E\+01058F\+010590\+010591\+010592\+010594\+010595\+010C80\+010C81\+010C82\+010C83\+010C84\+010C85'
               || U&'\+010C86\+010C87\+010C88\+010C89\+010C8A\+010C8B\+010C8C\+010C8D\+010C8E\+010C8F\+010C90\+010C91\+010C92\+010C93\+010C94\+010C95\+010C96\+010C97\+010C98\+010C99\+010C9A\+010C9B\+010C9C\+010C9D\+010C9E\+010C9F\+010CA0\+010CA1\+010CA2\+010CA3\+010CA4\+010CA5\+010CA6\+010CA7\+010CA8\+010CA9\+010CAA\+010CAB\+010CAC\+010CAD'
               || U&'\+010CAE\+010CAF\+010CB0\+010CB1\+010CB2\+0118A0\+0118A1\+0118A2\+0118A3\+0118A4\+0118A5\+0118A6\+0118A7\+0118A8\+0118A9\+0118AA\+0118AB\+0118AC\+0118AD\+0118AE\+0118AF\+0118B0\+0118B1\+0118B2\+0118B3\+0118B4\+0118B5\+0118B6\+0118B7\+0118B8\+0118B9\+0118BA\+0118BB\+0118BC\+0118BD\+0118BE\+0118BF\+016E40\+016E41\+016E42'
               || U&'\+016E43\+016E44\+016E45\+016E46\+016E47\+016E48\+016E49\+016E4A\+016E4B\+016E4C\+016E4D\+016E4E\+016E4F\+016E50\+016E51\+016E52\+016E53\+016E54\+016E55\+016E56\+016E57\+016E58\+016E59\+016E5A\+016E5B\+016E5C\+016E5D\+016E5E\+016E5F\+01E900\+01E901\+01E902\+01E903\+01E904\+01E905\+01E906\+01E907\+01E908\+01E909\+01E90A'
               || U&'\+01E90B\+01E90C\+01E90D\+01E90E\+01E90F\+01E910\+01E911\+01E912\+01E913\+01E914\+01E915\+01E916\+01E917\+01E918\+01E919\+01E91A\+01E91B\+01E91C\+01E91D\+01E91E\+01E91F\+01E920\+01E921',
               U&'\0061\0062\0063\0064\0065\0066\0067\0068\0069\006A\006B\006C\006D\006E\006F\0070\0071\0072\0073\0074\0075\0076\0077\0078\0079\007A\00E6\00F0\00F8\00FE\0111\0127\0142\014B\0153\0167\0253\0183\0185\0254'
               || U&'\0188\0256\0257\018C\01DD\0259\025B\0192\0260\0263\0269\0268\0199\026F\0272\0275\01A3\01A5\0280\01A8\0283\01AD\0288\028A\028B\01B4\01B6\0292\01B9\01BD\01E5\0195\01BF\021D\019E\0223\0225\2C65\023C\019A'
               || U&'\2C66\0242\0180\0289\028C\0247\0249\024B\024D\024F\03B9\0371\0373\0377\03F3\03B1\03B2\03B3\03B4\03B5\03B6\03B7\03B8\03B9\03BA\03BB\03BC\03BD\03BE\03BF\03C0\03C1\03C3\03C4\03C5\03C6\03C7\03C8\03C9\03C3'
               || U&'\03D7\03D9\03DB\03DD\03DF\03E1\03E3\03E5\03E7\03E9\03EB\03ED\03EF\03F8\03FB\037B\037C\037D\0452\0454\0455\0456\0458\0459\045A\045B\045F\0430\0431\0432\0433\0434\0435\0436\0437\0438\043A\043B\043C\043D'
               || U&'\043E\043F\0440\0441\0442\0443\0444\0445\0446\0447\0448\0449\044A\044B\044C\044D\044E\044F\0461\0463\0465\0467\0469\046B\046D\046F\0471\0473\0475\0479\047B\047D\047F\0481\048B\048D\048F\0491\0493\0495'
               || U&'\0497\0499\049B\049D\049F\04A1\04A3\04A5\04A7\04A9\04AB\04AD\04AF\04B1\04B3\04B5\04B7\04B9\04BB\04BD\04BF\04CF\04C4\04C6\04C8\04CA\04CC\04CE\04D5\04D9\04E1\04E9\04F7\04FB\04FD\04FF\0501\0503\0505\0507'
               || U&'\0509\050B\050D\050F\0511\0513\0515\0517\0519\051B\051D\051F\0521\0523\0525\0527\0529\052B\052D\052F\0561\0562\0563\0564\0565\0566\0567\0568\0569\056A\056B\056C\056D\056E\056F\0570\0571\0572\0573\0574'
               || U&'\0575\0576\0577\0578\0579\057A\057B\057C\057D\057E\057F\0580\0581\0582\0583\0584\0585\0586\2D00\2D01\2D02\2D03\2D04\2D05\2D06\2D07\2D08\2D09\2D0A\2D0B\2D0C\2D0D\2D0E\2D0F\2D10\2D11\2D12\2D13\2D14\2D15'
               || U&'\2D16\2D17\2D18\2D19\2D1A\2D1B\2D1C\2D1D\2D1E\2D1F\2D20\2D21\2D22\2D23\2D24\2D25\2D27\2D2D\13F0\13F1\13F2\13F3\13F4\13F5\0432\0434\043E\0441\0442\0442\044A\0463\A64B\10D0\10D1\10D2\10D3\10D4\10D5\10D6'
               || U&'\10D7\10D8\10D9\10DA\10DB\10DC\10DD\10DE\10DF\10E0\10E1\10E2\10E3\10E4\10E5\10E6\10E7\10E8\10E9\10EA\10EB\10EC\10ED\10EE\10EF\10F0\10F1\10F2\10F3\10F4\10F5\10F6\10F7\10F8\10F9\10FA\10FD\10FE\10FF\1EFB'
               || U&'\1EFD\1EFF\214E\2184\2C30\2C31\2C32\2C33\2C34\2C35\2C36\2C37\2C38\2C39\2C3A\2C3B\2C3C\2C3D\2C3E\2C3F\2C40\2C41\2C42\2C43\2C44\2C45\2C46\2C47\2C48\2C49\2C4A\2C4B\2C4C\2C4D\2C4E\2C4F\2C50\2C51\2C52\2C53'
               || U&'\2C54\2C55\2C56\2C57\2C58\2C59\2C5A\2C5B\2C5C\2C5D\2C5E\2C5F\2C61\026B\1D7D\027D\2C68\2C6A\2C6C\0251\0271\0250\0252\2C73\2C76\023F\0240\2C81\2C83\2C85\2C87\2C89\2C8B\2C8D\2C8F\2C91\2C93\2C95\2C97\2C99'
               || U&'\2C9B\2C9D\2C9F\2CA1\2CA3\2CA5\2CA7\2CA9\2CAB\2CAD\2CAF\2CB1\2CB3\2CB5\2CB7\2CB9\2CBB\2CBD\2CBF\2CC1\2CC3\2CC5\2CC7\2CC9\2CCB\2CCD\2CCF\2CD1\2CD3\2CD5\2CD7\2CD9\2CDB\2CDD\2CDF\2CE1\2CE3\2CEC\2CEE\2CF3'
               || U&'\A641\A643\A645\A647\A649\A64B\A64D\A64F\A651\A653\A655\A657\A659\A65B\A65D\A65F\A661\A663\A665\A667\A669\A66B\A66D\A681\A683\A685\A687\A689\A68B\A68D\A68F\A691\A693\A695\A697\A699\A69B\A723\A725\A727'
               || U&'\A729\A72B\A72D\A72F\A733\A735\A737\A739\A73B\A73D\A73F\A741\A743\A745\A747\A749\A74B\A74D\A74F\A751\A753\A755\A757\A759\A75B\A75D\A75F\A761\A763\A765\A767\A769\A76B\A76D\A76F\A77A\A77C\1D79\A77F\A781'
               || U&'\A783\A785\A787\A78C\0265\A791\A793\A797\A799\A79B\A79D\A79F\A7A1\A7A3\A7A5\A7A7\A7A9\0266\025C\0261\026C\026A\029E\0287\029D\AB53\A7B5\A7B7\A7B9\A7BB\A7BD\A7BF\A7C1\A7C3\A794\0282\1D8E\A7C8\A7CA\A7D1'
               || U&'\A7D7\A7D9\A7F6\13A0\13A1\13A2\13A3\13A4\13A5\13A6\13A7\13A8\13A9\13AA\13AB\13AC\13AD\13AE\13AF\13B0\13B1\13B2\13B3\13B4\13B5\13B6\13B7\13B8\13B9\13BA\13BB\13BC\13BD\13BE\13BF\13C0\13C1\13C2\13C3\13C4'
               || U&'\13C5\13C6\13C7\13C8\13C9\13CA\13CB\13CC\13CD\13CE\13CF\13D0\13D1\13D2\13D3\13D4\13D5\13D6\13D7\13D8\13D9\13DA\13DB\13DC\13DD\13DE\13DF\13E0\13E1\13E2\13E3\13E4\13E5\13E6\13E7\13E8\13E9\13EA\13EB\13EC'
               || U&'\13ED\13EE\13EF\+010428\+010429\+01042A\+01042B\+01042C\+01042D\+01042E\+01042F\+010430\+010431\+010432\+010433\+010434\+010435\+010436\+010437\+010438\+010439\+01043A\+01043B\+01043C\+01043D\+01043E\+01043F\+010440\+010441\+010442\+010443\+010444\+010445\+010446\+010447\+010448\+010449\+01044A\+01044B\+01044C'
               || U&'\+01044D\+01044E\+01044F\+0104D8\+0104D9\+0104DA\+0104DB\+0104DC\+0104DD\+0104DE\+0104DF\+0104E0\+0104E1\+0104E2\+0104E3\+0104E4\+0104E5\+0104E6\+0104E7\+0104E8\+0104E9\+0104EA\+0104EB\+0104EC\+0104ED\+0104EE\+0104EF\+0104F0\+0104F1\+0104F2\+0104F3\+0104F4\+0104F5\+0104F6\+0104F7\+0104F8\+0104F9\+0104FA\+0104FB\+010597'
               || U&'\+010598\+010599\+01059A\+01059B\+01059C\+01059D\+01059E\+01059F\+0105A0\+0105A1\+0105A3\+0105A4\+0105A5\+0105A6\+0105A7\+0105A8\+0105A9\+0105AA\+0105AB\+0105AC\+0105AD\+0105AE\+0105AF\+0105B0\+0105B1\+0105B3\+0105B4\+0105B5\+0105B6\+0105B7\+0105B8\+0105B9\+0105BB\+0105BC\+010CC0\+010CC1\+010CC2\+010CC3\+010CC4\+010CC5'
               || U&'\+010CC6\+010CC7\+010CC8\+010CC9\+010CCA\+010CCB\+010CCC\+010CCD\+010CCE\+010CCF\+010CD0\+010CD1\+010CD2\+010CD3\+010CD4\+010CD5\+010CD6\+010CD7\+010CD8\+010CD9\+010CDA\+010CDB\+010CDC\+010CDD\+010CDE\+010CDF\+010CE0\+010CE1\+010CE2\+010CE3\+010CE4\+010CE5\+010CE6\+010CE7\+010CE8\+010CE9\+010CEA\+010CEB\+010CEC\+010CED'
               || U&'\+010CEE\+010CEF\+010CF0\+010CF1\+010CF2\+0118C0\+0118C1\+0118C2\+0118C3\+0118C4\+0118C5\+0118C6\+0118C7\+0118C8\+0118C9\+0118CA\+0118CB\+0118CC\+0118CD\+0118CE\+0118CF\+0118D0\+0118D1\+0118D2\+0118D3\+0118D4\+0118D5\+0118D6\+0118D7\+0118D8\+0118D9\+0118DA\+0118DB\+0118DC\+0118DD\+0118DE\+0118DF\+016E60\+016E61\+016E62'
               || U&'\+016E63\+016E64\+016E65\+016E66\+016E67\+016E68\+016E69\+016E6A\+016E6B\+016E6C\+016E6D\+016E6E\+016E6F\+016E70\+016E71\+016E72\+016E73\+016E74\+016E75\+016E76\+016E77\+016E78\+016E79\+016E7A\+016E7B\+016E7C\+016E7D\+016E7E\+016E7F\+01E922\+01E923\+01E924\+01E925\+01E926\+01E927\+01E928\+01E929\+01E92A\+01E92B\+01E92C'
               || U&'\+01E92D\+01E92E\+01E92F\+01E930\+01E931\+01E932\+01E933\+01E934\+01E935\+01E936\+01E937\+01E938\+01E939\+01E93A\+01E93B\+01E93C\+01E93D\+01E93E\+01E93F\+01E940\+01E941\+01E942\+01E943'),
             '[' || '\u0001-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00a9\u00ab-\u00b1\u00b4\u00b6-\u00b8\u00bb\u00bf\u00d7\u00f7\u02c2-\u02c5\u02d2-\u02df\u02e5-\u02eb\u02ed\u02ef-'
             || '\u036f\u0375\u037e\u0384-\u0385\u0387\u03f6\u0482\u055a-\u055f\u0589-\u058a\u058d-\u058f\u05be\u05c0\u05c3\u05c6\u05f3-\u05f4\u0600-\u060f\u061b-\u061f\u066a-'
             || '\u066d\u06d4\u06dd-\u06de\u06e9\u06fd-\u06fe\u0700-\u070d\u070f\u07f6-\u07f9\u07fe-\u07ff\u0830-\u083e\u085e\u0888\u0890-\u0891\u08e2\u0964-\u0965\u0970\u09f2-'
             || '\u09f3\u09fa-\u09fb\u09fd\u0a76\u0af0-\u0af1\u0b70\u0bf3-\u0bfa\u0c77\u0c7f\u0c84\u0d4f\u0d79\u0df4\u0e3f\u0e4f\u0e5a-\u0e5b\u0f01-\u0f17\u0f1a-\u0f1f\u0f34'
             || '\u0f36\u0f38\u0f3a-\u0f3d\u0f85\u0fbe-\u0fc5\u0fc7-\u0fcc\u0fce-\u0fda\u104a-\u104f\u109e-\u109f\u10fb\u1360-\u1368\u1390-\u1399\u1400\u166d-\u166e\u1680\u169b-'
             || '\u169c\u16eb-\u16ed\u1735-\u1736\u17d4-\u17d6\u17d8-\u17db\u1800-\u180a\u180e\u1940\u1944-\u1945\u19de-\u19ff\u1a1e-\u1a1f\u1aa0-\u1aa6\u1aa8-\u1aad\u1b5a-'
             || '\u1b6a\u1b74-\u1b7e\u1bfc-\u1bff\u1c3b-\u1c3f\u1c7e-\u1c7f\u1cc0-\u1cc7\u1cd3\u1fbd\u1fbf-\u1fc1\u1fcd-\u1fcf\u1fdd-\u1fdf\u1fed-\u1fef\u1ffd-\u1ffe\u2000-'
             || '\u2064\u2066-\u206f\u207a-\u207e\u208a-\u208e\u20a0-\u20c0\u20d0-\u2101\u2103-\u2106\u2108-\u2109\u2114\u2116-\u2118\u211e-\u2123\u2125\u2127\u2129\u212e\u213a-'
             || '\u213b\u2140-\u2144\u214a-\u214d\u214f\u218a-\u218b\u2190-\u2426\u2440-\u244a\u249c-\u24e9\u2500-\u2775\u2794-\u2b73\u2b76-\u2b95\u2b97-\u2bff\u2ce5-\u2cea'
             || '\u2cf9-\u2cfc\u2cfe-\u2cff\u2d70\u2e00-\u2e2e\u2e30-\u2e5d\u2e80-\u2e99\u2e9b-\u2ef3\u2f00-\u2fd5\u2ff0-\u3004\u3008-\u3020\u3030\u3036-\u3037\u303d-\u303f'
             || '\u309b-\u309c\u30a0\u30fb\u3190-\u3191\u3196-\u319f\u31c0-\u31e3\u31ef\u3200-\u321e\u322a-\u3247\u3250\u3260-\u327f\u328a-\u32b0\u32c0-\u33ff\u4dc0-\u4dff'
             || '\ua490-\ua4c6\ua4fe-\ua4ff\ua60d-\ua60f\ua673\ua67e\ua6f2-\ua6f7\ua700-\ua716\ua720-\ua721\ua789-\ua78a\ua828-\ua82b\ua836-\ua839\ua874-\ua877\ua8ce-\ua8cf'
             || '\ua8f8-\ua8fa\ua8fc\ua92e-\ua92f\ua95f\ua9c1-\ua9cd\ua9de-\ua9df\uaa5c-\uaa5f\uaa77-\uaa79\uaade-\uaadf\uaaf0-\uaaf1\uab5b\uab6a-\uab6b\uabeb\ufb29\ufbb2-\ufbc2'
             || '\ufd3e-\ufd4f\ufdcf\ufdfc-\ufe19\ufe30-\ufe52\ufe54-\ufe66\ufe68-\ufe6b\ufeff\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\uffe0-\uffe6\uffe8-\uffee'
             || '\ufff9-\ufffd\U00010100-\U00010102\U00010137-\U0001013f\U00010179-\U00010189\U0001018c-\U0001018e\U00010190-\U0001019c\U000101a0\U000101d0-\U000101fc\U0001039f'
             || '\U000103d0\U0001056f\U00010857\U00010877-\U00010878\U0001091f\U0001093f\U00010a50-\U00010a58\U00010a7f\U00010ac8\U00010af0-\U00010af6\U00010b39-\U00010b3f'
             || '\U00010b99-\U00010b9c\U00010ead\U00010f55-\U00010f59\U00010f86-\U00010f89\U00011047-\U0001104d\U000110bb-\U000110c1\U000110cd\U00011140-\U00011143\U00011174-'
             || '\U00011175\U000111c5-\U000111c8\U000111cd\U000111db\U000111dd-\U000111df\U00011238-\U0001123d\U000112a9\U0001144b-\U0001144f\U0001145a-\U0001145b\U0001145d'
             || '\U000114c6\U000115c1-\U000115d7\U00011641-\U00011643\U00011660-\U0001166c\U000116b9\U0001173c-\U0001173f\U0001183b\U00011944-\U00011946\U000119e2\U00011a3f-'
             || '\U00011a46\U00011a9a-\U00011a9c\U00011a9e-\U00011aa2\U00011b00-\U00011b09\U00011c41-\U00011c45\U00011c70-\U00011c71\U00011ef7-\U00011ef8\U00011f43-\U00011f4f'
             || '\U00011fd5-\U00011ff1\U00011fff\U00012470-\U00012474\U00012ff1-\U00012ff2\U00013430-\U0001343f\U00016a6e-\U00016a6f\U00016af5\U00016b37-\U00016b3f\U00016b44-'
             || '\U00016b45\U00016e97-\U00016e9a\U00016fe2\U0001bc9c\U0001bc9f-\U0001bca3\U0001cf50-\U0001cfc3\U0001d000-\U0001d0f5\U0001d100-\U0001d126\U0001d129-\U0001d164'
             || '\U0001d16a-\U0001d16c\U0001d173-\U0001d17a\U0001d183-\U0001d184\U0001d18c-\U0001d1a9\U0001d1ae-\U0001d1ea\U0001d200-\U0001d241\U0001d245\U0001d300-\U0001d356'
             || '\U0001d6c1\U0001d6db\U0001d6fb\U0001d715\U0001d735\U0001d74f\U0001d76f\U0001d789\U0001d7a9\U0001d7c3\U0001d800-\U0001d9ff\U0001da37-\U0001da3a\U0001da6d-'
             || '\U0001da74\U0001da76-\U0001da83\U0001da85-\U0001da8b\U0001e14f\U0001e2ff\U0001e95e-\U0001e95f\U0001ecac\U0001ecb0\U0001ed2e\U0001eef0-\U0001eef1\U0001f000-'
             || '\U0001f02b\U0001f030-\U0001f093\U0001f0a0-\U0001f0ae\U0001f0b1-\U0001f0bf\U0001f0c1-\U0001f0cf\U0001f0d1-\U0001f0f5\U0001f10d-\U0001f1ad\U0001f1e6-\U0001f202'
             || '\U0001f210-\U0001f23b\U0001f240-\U0001f248\U0001f250-\U0001f251\U0001f260-\U0001f265\U0001f300-\U0001f6d7\U0001f6dc-\U0001f6ec\U0001f6f0-\U0001f6fc\U0001f700-'
             || '\U0001f776\U0001f77b-\U0001f7d9\U0001f7e0-\U0001f7eb\U0001f7f0\U0001f800-\U0001f80b\U0001f810-\U0001f847\U0001f850-\U0001f859\U0001f860-\U0001f887\U0001f890-'
             || '\U0001f8ad\U0001f8b0-\U0001f8b1\U0001f900-\U0001fa53\U0001fa60-\U0001fa6d\U0001fa70-\U0001fa7c\U0001fa80-\U0001fa88\U0001fa90-\U0001fabd\U0001fabf-\U0001fac5'
             || '\U0001face-\U0001fadb\U0001fae0-\U0001fae8\U0001faf0-\U0001faf8\U0001fb00-\U0001fb92\U0001fb94-\U0001fbca\U000e0001\U000e0020-\U000e007f\U000e0100-\U000e01ef' || ']+',
             '', 'g'),
           '')
$$;
comment on function app.employer_name_key(text) is
  'The key an employer''s name is matched on (0765), the same on any database locale: compatibility decomposition, Unicode case folding as data (ß to ss, final sigma), Latin/Greek/Cyrillic accents, spaces, punctuation, symbols, currency signs, emoji and invisible characters dropped; letters and digits of every script kept; no word of any language treated specially.';

-- ── The tables ───────────────────────────────────────────────────────────────
create table if not exists app.match_programs (
  id                       uuid primary key default gen_random_uuid(),
  company_name             text not null check (char_length(company_name) between 1 and 160),
  country                  text check (country is null or country ~ '^[A-Z]{2}$'),
  gift_match               boolean not null default true,
  volunteer_grant          boolean not null default false,
  -- What the employer gives for each 1 given, in basis points: 10000 = 1:1, 20000 = 2:1, 5000 = 0.5:1.
  match_ratio_bp           integer check (match_ratio_bp is null or match_ratio_bp between 1 and 100000),
  currency                 text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  min_gift_cents           bigint check (min_gift_cents is null or min_gift_cents >= 0),
  max_gift_cents           bigint check (max_gift_cents is null or max_gift_cents > 0),
  max_year_cents           bigint check (max_year_cents is null or max_year_cents > 0),
  gift_types               text[] not null default '{}' check (gift_types <@ app.match_gift_types()),
  org_kinds                text[] not null default '{}' check (org_kinds <@ app.match_org_kinds()),
  religious_orgs           text check (religious_orgs is null or religious_orgs = any (app.match_religious_rules())),
  eligibility_note         text check (eligibility_note is null or char_length(eligibility_note) <= 500),
  portal                   text check (portal is null or portal = any (app.match_portals())),
  portal_url               text check (portal_url is null or (portal_url ~* '^https://[^[:space:]]+$' and char_length(portal_url) <= 500)),
  deadline_kind            text check (deadline_kind is null or deadline_kind = any (app.match_deadline_kinds())),
  deadline_months          integer check (deadline_months is null or deadline_months between 1 and 36),
  deadline_month           integer check (deadline_month is null or deadline_month between 1 and 12),
  deadline_day             integer check (deadline_day is null or deadline_day between 1 and 31),
  deadline_note            text check (deadline_note is null or char_length(deadline_note) <= 300),
  volunteer_cents_per_hour bigint check (volunteer_cents_per_hour is null or volunteer_cents_per_hour > 0),
  volunteer_min_hours      integer check (volunteer_min_hours is null or volunteer_min_hours between 1 and 1000),
  volunteer_max_year_cents bigint check (volunteer_max_year_cents is null or volunteer_max_year_cents > 0),
  volunteer_note           text check (volunteer_note is null or char_length(volunteer_note) <= 300),
  notes                    text check (notes is null or char_length(notes) <= 1000),
  source                   text not null check (source = any (app.match_sources())),
  source_url               text check (source_url is null or (source_url ~* '^https://[^[:space:]]+$' and char_length(source_url) <= 500)),
  last_verified_on         date,
  verified_by_kind         text check (verified_by_kind is null or verified_by_kind in ('weaver', 'community')),
  -- A community's check: the submission it approved (0766 adds the reference). Only that community can open it.
  verified_submission_id   uuid,
  -- Moves on with every change of the facts or names (app.match_program_versions keeps each one).
  version                  integer not null default 1 check (version >= 1),
  status                   text not null default 'active' check (status in ('active', 'retired', 'merged')),
  merged_into              uuid references app.match_programs(id),
  status_reason            text check (status_reason is null or char_length(status_reason) <= 500),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint match_programs_does_something check (gift_match or volunteer_grant),
  constraint match_programs_gift_range check (min_gift_cents is null or max_gift_cents is null or min_gift_cents <= max_gift_cents),
  constraint match_programs_gift_rules check (gift_match or (match_ratio_bp is null and min_gift_cents is null and max_gift_cents is null
                                                             and max_year_cents is null and cardinality(gift_types) = 0)),
  constraint match_programs_volunteer_rules check (volunteer_grant or (volunteer_cents_per_hour is null and volunteer_min_hours is null
                                                                       and volunteer_max_year_cents is null and volunteer_note is null)),
  constraint match_programs_deadline check (
    case deadline_kind
      when 'months_after_gift' then deadline_months is not null and deadline_month is null and deadline_day is null
      when 'date_next_year' then deadline_months is null and deadline_month is not null and deadline_day is not null
      else deadline_months is null and deadline_month is null and deadline_day is null
    end),
  constraint match_programs_merged check ((status = 'merged') = (merged_into is not null) and merged_into is distinct from id),
  constraint match_programs_verified check ((last_verified_on is null) = (verified_by_kind is null)
                                            and (verified_submission_id is null or verified_by_kind = 'community'))
);
create index if not exists match_programs_status_idx on app.match_programs (status, lower(company_name));
comment on table app.match_programs is
  'The shared employer-program directory (0765, CatchTheMatch): public facts about an employer''s matching-gift and volunteer-grant program, never who works there or who gave. Read by Weaver''s team and by the organization''s own CatchTheMatch readers of any community where it is on; written only by save_match_program / set_match_program_retired / merge_match_programs / revert_match_program (Weaver) and decide_match_submission (0766).';
comment on column app.match_programs.religious_orgs is
  'Religious organizations: eligible, non_worship_only (only their programs that are not worship), excluded; null = not known yet.';

create table if not exists app.match_program_names (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references app.match_programs(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 160),
  name_key    text not null check (name_key <> ''),
  is_primary  boolean not null default false,
  -- A name no longer given: kept, not matched (owner rule: never delete old names).
  retired_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint match_program_names_once unique (program_id, name_key),
  constraint match_program_names_primary_active check (not (is_primary and retired_at is not null))
);
create unique index if not exists match_program_names_one_primary on app.match_program_names (program_id) where is_primary;
create index if not exists match_program_names_key_idx on app.match_program_names (name_key);
comment on table app.match_program_names is
  'The names a program''s company goes by (0765): its name (is_primary) and others (an abbreviation, the name in another script, the parent company), each with app.employer_name_key. Never deleted: retired_at marks a name no longer given (not matched).';

create table if not exists app.match_program_versions (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references app.match_programs(id) on delete cascade,
  version           integer not null check (version >= 1),
  -- The facts and names as written (app._match_program_facts' shape).
  facts             jsonb not null check (jsonb_typeof(facts) = 'object'),
  written_kind      text not null check (written_kind in ('weaver', 'community')),
  -- The community whose CatchTheMatch manager approved it (Weaver's team only reads this table).
  written_center_id uuid references app.centers(id) on delete set null,
  note              text check (note is null or char_length(note) <= 600),
  written_at        timestamptz not null default now(),
  constraint match_program_versions_once unique (program_id, version),
  constraint match_program_versions_who check (written_kind = 'community' or written_center_id is null)
);
create index if not exists match_program_versions_recent_idx on app.match_program_versions (written_kind, written_at desc);
comment on table app.match_program_versions is
  'Every version of a directory entry''s facts and names (0765): who wrote it (Weaver''s team, or which community''s approval) and why. Weaver''s team only; app.revert_match_program brings an earlier one back.';

-- A program's name is trimmed; updated_at moves with every change.
create or replace function app.match_programs_tidy() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.company_name := btrim(regexp_replace(coalesce(new.company_name, ''), '\s+', ' ', 'g'));
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.match_programs_tidy() from public, anon, authenticated;
drop trigger if exists match_programs_tidy on app.match_programs;
create trigger match_programs_tidy before insert or update on app.match_programs
  for each row execute function app.match_programs_tidy();

-- A name is trimmed and keyed; a name with no letter or digit is refused.
create or replace function app.match_program_names_key() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  new.name_key := app.employer_name_key(new.name);
  if new.name_key is null then
    raise exception 'A company''s name needs at least one letter or digit.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function app.match_program_names_key() from public, anon, authenticated;
drop trigger if exists match_program_names_key on app.match_program_names;
create trigger match_program_names_key before insert or update on app.match_program_names
  for each row execute function app.match_program_names_key();

-- ── The audit of the shared directory ────────────────────────────────────────
-- Like app.audit_row (0102), for tables that belong to no community: the entry has no community and no module. It names the
-- person who made the change, with their address, browser, request id and screen, only when that person is on Weaver's
-- team. Anyone else (a community's CatchTheMatch manager approving a submission) is left out entirely: the reason the
-- function that wrote it set says which community it was.
create or replace function app.audit_shared_row() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_before jsonb; v_after jsonb; c record; v_weaver boolean;
begin
  v_before := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after  := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  select * into c from app.audit_context();
  v_weaver := auth.uid() is not null and app.is_platform_admin();
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (null, case when v_weaver then auth.uid() end, auth.jwt()->>'role', tg_table_name || '.' || lower(tg_op),
          tg_table_name, coalesce(v_after, v_before)->>'id', v_before, v_after, c.reason,
          case when v_weaver then c.correlation_id end, case when v_weaver then c.ip end,
          case when v_weaver then c.user_agent end, null, c.client_app, case when v_weaver then c.client_screen end);
  return coalesce(new, old);
end $$;
revoke execute on function app.audit_shared_row() from public, anon, authenticated;

drop trigger if exists audit_match_programs on app.match_programs;
create trigger audit_match_programs after insert or update or delete on app.match_programs
  for each row execute function app.audit_shared_row();
drop trigger if exists audit_match_program_names on app.match_program_names;
create trigger audit_match_program_names after insert or update or delete on app.match_program_names
  for each row execute function app.audit_shared_row();
drop trigger if exists audit_match_program_versions on app.match_program_versions;
create trigger audit_match_program_versions after insert or update or delete on app.match_program_versions
  for each row execute function app.audit_shared_row();
-- Core platform: the directory is Weaver's, shared by every community (its readers need CatchTheMatch on somewhere).
insert into app.module_tables (table_name, module_key) values
  ('match_programs', null), ('match_program_names', null), ('match_program_versions', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

-- ── The organization's own CatchTheMatch readers (not Weaver's filing grant) ──
-- The filing grant (0758) is for claims (slice 3): it opens neither the directory's community side, nor submissions (0766),
-- nor the links of employers on file (0767).
create or replace function app._matching_org_can(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.org_private_can(p_center, 'matching.view') or app.org_private_can(p_center, 'matching.manage')
$$;

-- The communities whose CatchTheMatch data the caller reads as the organization's own reader, for RLS (once per statement).
create or replace function app.matching_org_readable_centers() returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(s.c), '{}'::uuid[])
    from (select o.center_id as c from app.center_owners o where o.user_id = auth.uid()
          union
          select g.center_id from app.role_grants g where g.user_id = auth.uid() and g.status = 'active') s
   where auth.uid() is not null and app._matching_org_can(s.c)
$$;

-- ── Who reads the directory ──────────────────────────────────────────────────
create or replace function app.match_directory_can_read() returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (app.is_platform_admin() or cardinality(app.matching_org_readable_centers()) > 0)
$$;
comment on function app.match_directory_can_read() is
  'The shared directory''s readers (0765): Weaver''s team, and the organization''s own CatchTheMatch readers of at least one community where it is on.';

alter table app.match_programs enable row level security;
alter table app.match_program_names enable row level security;
alter table app.match_program_versions enable row level security;
drop policy if exists match_programs_read on app.match_programs;
create policy match_programs_read on app.match_programs for select to authenticated
  using ((select app.match_directory_can_read()));
drop policy if exists match_program_names_read on app.match_program_names;
create policy match_program_names_read on app.match_program_names for select to authenticated
  using ((select app.match_directory_can_read()));
-- The versions say which community wrote what: Weaver's team only.
drop policy if exists match_program_versions_read on app.match_program_versions;
create policy match_program_versions_read on app.match_program_versions for select to authenticated
  using ((select app.is_platform_admin()));
-- No write policies: only the functions below (and 0766's decide_match_submission) write.
revoke all on app.match_programs, app.match_program_names, app.match_program_versions from public, anon, authenticated;
grant select on app.match_programs, app.match_program_names, app.match_program_versions to authenticated;
grant all on app.match_programs, app.match_program_names, app.match_program_versions to service_role;

-- ── Reading what a caller sends (plain-English errors) ───────────────────────
-- A text value: trimmed (one line: runs of white space become one space), null when empty, at most p_max characters.
create or replace function app._mj_text(p jsonb, p_key text, p_max int, p_label text, p_one_line boolean default true) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return null; end if;
  if jsonb_typeof(p->p_key) not in ('string', 'number') then
    raise exception '% must be text.', p_label using errcode = '22023';
  end if;
  v := case when p_one_line then btrim(regexp_replace(p->>p_key, '\s+', ' ', 'g')) else btrim(p->>p_key) end;
  v := nullif(v, '');
  if v is not null and char_length(v) > p_max then
    raise exception '% can be at most % characters.', p_label, p_max using errcode = '22023';
  end if;
  return v;
end $$;

-- A whole number from p_min to p_max, or null.
create or replace function app._mj_int(p jsonb, p_key text, p_min bigint, p_max bigint, p_label text) returns bigint
language plpgsql immutable set search_path = app, public, extensions as $$
declare t text; v numeric;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return null; end if;
  if jsonb_typeof(p->p_key) not in ('string', 'number') then
    raise exception '% must be a whole number.', p_label using errcode = '22023';
  end if;
  t := btrim(p->>p_key);
  if t = '' then return null; end if;
  if t !~ '^-?[0-9]{1,15}(\.0+)?$' then
    raise exception '% must be a whole number.', p_label using errcode = '22023';
  end if;
  v := t::numeric;
  if v < p_min or v > p_max then
    raise exception '% must be from % to %.', p_label, p_min, p_max using errcode = '22023';
  end if;
  return v::bigint;
end $$;

create or replace function app._mj_bool(p jsonb, p_key text, p_default boolean, p_label text) returns boolean
language plpgsql immutable set search_path = app, public, extensions as $$
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return p_default; end if;
  if jsonb_typeof(p->p_key) = 'boolean' then return (p->>p_key)::boolean; end if;
  if lower(btrim(p->>p_key)) in ('true', 'false') then return lower(btrim(p->>p_key))::boolean; end if;
  raise exception '% must be yes or no.', p_label using errcode = '22023';
end $$;

-- One value of a list, or null.
create or replace function app._mj_choice(p jsonb, p_key text, p_allowed text[], p_label text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := app._mj_text(p, p_key, 60, p_label);
begin
  if v is not null and not (v = any (p_allowed)) then
    raise exception 'Unknown % "%".', p_label, v using errcode = '22023';
  end if;
  return v;
end $$;

-- Several values of a list (each once, sorted), or an empty list.
create or replace function app._mj_list(p jsonb, p_key text, p_allowed text[], p_label text) returns text[]
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text[]; bad text;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return '{}'::text[]; end if;
  if jsonb_typeof(p->p_key) <> 'array' then
    raise exception 'Send the %s as a list.', p_label using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct btrim(x) order by btrim(x)), '{}'::text[]) into v
    from jsonb_array_elements_text(p->p_key) x where btrim(x) <> '';
  select x into bad from unnest(v) x where not (x = any (p_allowed)) limit 1;
  if bad is not null then
    raise exception 'Unknown % "%".', p_label, bad using errcode = '22023';
  end if;
  return v;
end $$;

-- A web address that starts with https://, or null.
create or replace function app._mj_https(p jsonb, p_key text, p_label text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := app._mj_text(p, p_key, 500, p_label);
begin
  if v is not null and v !~* '^https://[^[:space:]/]+\.[^[:space:]]+$' then
    raise exception '% must be a full web address that starts with https://.', p_label using errcode = '22023';
  end if;
  return v;
end $$;

-- The facts of a program as one clean object, from what Weaver's team or a community sent; every rule in plain English.
-- Facts that do not apply are dropped: the gift rules when it matches no gifts, the volunteer rules when it pays no volunteer
-- grants, the deadline's numbers its kind does not use. p_default_source: the source when none is given (null: required).
create or replace function app._match_program_clean(p jsonb, p_default_source text) returns jsonb
language plpgsql stable set search_path = app, public, extensions as $$
declare
  v_name text; v_names text[] := '{}'; v_keys text[]; x text; k text;
  v_country text; v_gift boolean; v_vol boolean; v_currency text;
  v_ratio bigint; v_min bigint; v_max bigint; v_year bigint; v_types text[];
  v_kinds text[]; v_rel text; v_elig text; v_portal text; v_portal_url text;
  v_dkind text; v_dmonths bigint; v_dmonth bigint; v_dday bigint; v_dnote text;
  v_vrate bigint; v_vhours bigint; v_vyear bigint; v_vnote text; v_notes text;
  v_source text; v_source_url text; v_on_text text; v_on date;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'The program''s facts are missing.' using errcode = '22023';
  end if;

  v_name := app._mj_text(p, 'company_name', 160, 'The company''s name');
  if v_name is null then raise exception 'Enter the company''s name.' using errcode = '22023'; end if;
  if app.employer_name_key(v_name) is null then
    raise exception 'The company''s name needs at least one letter or digit.' using errcode = '22023';
  end if;
  v_keys := array[app.employer_name_key(v_name)];
  if p ? 'names' and jsonb_typeof(p->'names') not in ('array', 'null') then
    raise exception 'The other names must be a list.' using errcode = '22023';
  end if;
  for x in select btrim(regexp_replace(e, '\s+', ' ', 'g'))
             from jsonb_array_elements_text(case when jsonb_typeof(p->'names') = 'array' then p->'names' else '[]'::jsonb end) e
  loop
    continue when x = '';
    if char_length(x) > 160 then
      raise exception 'Each other name can be at most 160 characters.' using errcode = '22023';
    end if;
    k := app.employer_name_key(x);
    if k is null then
      raise exception 'The other name "%" needs at least one letter or digit.', x using errcode = '22023';
    end if;
    continue when k = any (v_keys);
    v_keys := v_keys || k;
    v_names := v_names || x;
  end loop;
  if cardinality(v_names) > 30 then
    raise exception 'A company can have at most 30 other names.' using errcode = '22023';
  end if;

  v_country := app._mj_text(p, 'country', 60, 'The country');
  if v_country is not null then
    if v_country !~ '^[A-Za-z]{2}$' then
      raise exception 'The country is a two-letter code, like US, IN or GB.' using errcode = '22023';
    end if;
    v_country := upper(v_country);
  end if;

  v_gift := app._mj_bool(p, 'gift_match', true, 'Matches gifts');
  v_vol := app._mj_bool(p, 'volunteer_grant', false, 'Pays volunteer grants');
  if not v_gift and not v_vol then
    raise exception 'Say what the program does: it matches gifts, pays volunteer grants, or both.' using errcode = '22023';
  end if;
  v_currency := upper(coalesce(app._mj_text(p, 'currency', 60, 'The currency'), 'USD'));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'The currency is a three-letter code, like USD, INR or GBP.' using errcode = '22023';
  end if;

  if v_gift then
    v_ratio := app._mj_int(p, 'match_ratio_bp', 1, 100000, 'The match ratio (in hundredths of a percent)');
    v_min := app._mj_int(p, 'min_gift_cents', 0, 100000000000, 'The minimum gift (in cents)');
    v_max := app._mj_int(p, 'max_gift_cents', 1, 100000000000, 'The maximum matched per gift (in cents)');
    v_year := app._mj_int(p, 'max_year_cents', 1, 100000000000, 'The maximum matched per year (in cents)');
    if v_min is not null and v_max is not null and v_min > v_max then
      raise exception 'The minimum gift is more than the maximum matched per gift.' using errcode = '22023';
    end if;
    v_types := app._mj_list(p, 'gift_types', app.match_gift_types(), 'kind of gift');
  else
    v_types := '{}';
  end if;

  v_kinds := app._mj_list(p, 'org_kinds', app.match_org_kinds(), 'kind of organization');
  v_rel := app._mj_choice(p, 'religious_orgs', app.match_religious_rules(), 'rule for religious organizations');
  v_elig := app._mj_text(p, 'eligibility_note', 500, 'The note on which organizations qualify', false);

  v_portal := app._mj_choice(p, 'portal', app.match_portals(), 'portal');
  v_portal_url := app._mj_https(p, 'portal_url', 'The portal''s link');

  v_dkind := app._mj_choice(p, 'deadline_kind', app.match_deadline_kinds(), 'kind of deadline');
  if v_dkind = 'months_after_gift' then
    v_dmonths := app._mj_int(p, 'deadline_months', 1, 36, 'The months after the gift');
    if v_dmonths is null then
      raise exception 'Say how many months after the gift the match must be asked for.' using errcode = '22023';
    end if;
  elsif v_dkind = 'date_next_year' then
    v_dmonth := app._mj_int(p, 'deadline_month', 1, 12, 'The deadline''s month');
    v_dday := app._mj_int(p, 'deadline_day', 1, 31, 'The deadline''s day');
    if v_dmonth is null or v_dday is null then
      raise exception 'Give the deadline''s month and day in the year after the gift.' using errcode = '22023';
    end if;
    begin
      perform make_date(2000, v_dmonth::int, v_dday::int);
    exception when others then
      raise exception 'The deadline is not a real date (month %, day %).', v_dmonth, v_dday using errcode = '22023';
    end;
  end if;
  v_dnote := app._mj_text(p, 'deadline_note', 300, 'The note on the deadline', false);

  if v_vol then
    v_vrate := app._mj_int(p, 'volunteer_cents_per_hour', 1, 100000000, 'The volunteer grant per hour (in cents)');
    v_vhours := app._mj_int(p, 'volunteer_min_hours', 1, 1000, 'The minimum volunteer hours');
    v_vyear := app._mj_int(p, 'volunteer_max_year_cents', 1, 100000000000, 'The maximum volunteer grant per year (in cents)');
    v_vnote := app._mj_text(p, 'volunteer_note', 300, 'The note on volunteer grants', false);
  end if;

  v_notes := app._mj_text(p, 'notes', 1000, 'The notes', false);
  v_source := coalesce(app._mj_choice(p, 'source', app.match_sources(), 'source'), p_default_source);
  if v_source is null then
    raise exception 'Say where the facts come from.' using errcode = '22023';
  end if;
  v_source_url := app._mj_https(p, 'source_url', 'The source''s link');

  v_on_text := app._mj_text(p, 'verified_on', 10, 'The date the facts were checked');
  if v_on_text is not null then
    if v_on_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'The date the facts were checked must be a date, like 2026-10-13.' using errcode = '22023';
    end if;
    begin
      v_on := v_on_text::date;
    exception when others then
      raise exception 'The date the facts were checked is not a real date.' using errcode = '22023';
    end;
    if v_on > current_date or v_on < date '2000-01-01' then
      raise exception 'The date the facts were checked must be today or earlier.' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'company_name', v_name, 'names', to_jsonb(v_names), 'country', v_country,
    'gift_match', v_gift, 'volunteer_grant', v_vol, 'match_ratio_bp', v_ratio, 'currency', v_currency,
    'min_gift_cents', v_min, 'max_gift_cents', v_max, 'max_year_cents', v_year, 'gift_types', to_jsonb(v_types),
    'org_kinds', to_jsonb(v_kinds), 'religious_orgs', v_rel, 'eligibility_note', v_elig,
    'portal', v_portal, 'portal_url', v_portal_url,
    'deadline_kind', v_dkind, 'deadline_months', v_dmonths, 'deadline_month', v_dmonth, 'deadline_day', v_dday,
    'deadline_note', v_dnote,
    'volunteer_cents_per_hour', v_vrate, 'volunteer_min_hours', v_vhours, 'volunteer_max_year_cents', v_vyear,
    'volunteer_note', v_vnote,
    'notes', v_notes, 'source', v_source, 'source_url', v_source_url, 'verified_on', v_on);
end $$;

-- A list in a clean object as text[].
create or replace function app._mj_array(p jsonb) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)), '{}'::text[])
$$;

-- The keys of a clean object's names (the company's and the others).
create or replace function app._match_keys(c jsonb) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(array_agg(distinct app.employer_name_key(s.n)), '{}'::text[])
    from (select c->>'company_name' as n union all select unnest(app._mj_array(c->'names'))) s
   where app.employer_name_key(s.n) is not null
$$;

-- Two countries that may be the same program's: equal, or either not given.
create or replace function app._match_same_country(a text, b text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select a is not distinct from b or a is null or b is null
$$;

-- The hard rule, for everyone: another entry that is active or retired (not merged) already goes by one of these names (a
-- name it gives now, not a retired alias), for the same country. {"company_name", "status"} or null.
create or replace function app._match_name_clash(p_keys text[], p_country text, p_except uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('company_name', g.company_name, 'status', g.status)
    from app.match_program_names n join app.match_programs g on g.id = n.program_id
   where g.status in ('active', 'retired') and g.id is distinct from p_except and n.retired_at is null
     and n.name_key = any (p_keys) and app._match_same_country(g.country, p_country)
   order by (g.status = 'active') desc, g.created_at
   limit 1
$$;

-- Any other entry, whatever its state, that goes or went by one of these names (its retired aliases and merged entries
-- included), for the same country: a community does not publish such a name; Weaver's team decides (0766).
create or replace function app._match_name_used(p_keys text[], p_country text, p_except uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.match_program_names n join app.match_programs g on g.id = n.program_id
                  where g.id is distinct from p_except and n.name_key = any (p_keys)
                    and app._match_same_country(g.country, p_country))
$$;

-- A near-duplicate of an entry Weaver's team checked: one of these keys contains, or is contained in, a name it gives now
-- (the shorter at least 3 characters), for the same country.
create or replace function app._match_near_weaver(p_keys text[], p_country text, p_except uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.match_program_names n join app.match_programs g on g.id = n.program_id
                   cross join unnest(p_keys) k
                  where g.status = 'active' and g.verified_by_kind = 'weaver' and g.id is distinct from p_except
                    and n.retired_at is null and app._match_same_country(g.country, p_country)
                    and ((char_length(k) >= 3 and strpos(n.name_key, k) > 0)
                         or (char_length(n.name_key) >= 3 and strpos(k, n.name_key) > 0)))
$$;

-- An entry's facts and names now, in the clean object's shape (what a version keeps, and what a revert brings back).
create or replace function app._match_program_facts(p_id uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'company_name', g.company_name,
    'names', coalesce((select jsonb_agg(n.name order by n.created_at, n.name) from app.match_program_names n
                        where n.program_id = g.id and not n.is_primary and n.retired_at is null), '[]'::jsonb),
    'country', g.country, 'gift_match', g.gift_match, 'volunteer_grant', g.volunteer_grant,
    'match_ratio_bp', g.match_ratio_bp, 'currency', g.currency, 'min_gift_cents', g.min_gift_cents,
    'max_gift_cents', g.max_gift_cents, 'max_year_cents', g.max_year_cents, 'gift_types', to_jsonb(g.gift_types),
    'org_kinds', to_jsonb(g.org_kinds), 'religious_orgs', g.religious_orgs, 'eligibility_note', g.eligibility_note,
    'portal', g.portal, 'portal_url', g.portal_url, 'deadline_kind', g.deadline_kind,
    'deadline_months', g.deadline_months, 'deadline_month', g.deadline_month, 'deadline_day', g.deadline_day,
    'deadline_note', g.deadline_note, 'volunteer_cents_per_hour', g.volunteer_cents_per_hour,
    'volunteer_min_hours', g.volunteer_min_hours, 'volunteer_max_year_cents', g.volunteer_max_year_cents,
    'volunteer_note', g.volunteer_note, 'notes', g.notes, 'source', g.source, 'source_url', g.source_url)
    from app.match_programs g where g.id = p_id
$$;

-- Keeps the entry's facts and names now as its next version (or its first), with who wrote it and why.
create or replace function app._match_snapshot(p_id uuid, p_kind text, p_center uuid, p_note text, p_first boolean)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare v int;
begin
  if p_first then
    v := 1;
  else
    update app.match_programs set version = version + 1 where id = p_id returning version into v;
  end if;
  insert into app.match_program_versions (program_id, version, facts, written_kind, written_center_id, note)
  values (p_id, v, app._match_program_facts(p_id), p_kind, case when p_kind = 'community' then p_center end,
          left(app.audit_clean_reason(p_note), 600));
  return v;
end $$;

-- Writes a clean object (app._match_program_clean) to a new program (p_id null) or to an active one, with its names, marks
-- it checked by p_kind ('weaver' or 'community', with the community p_center) on p_verified_on, and keeps the result as a
-- version. The hard name rule holds for everyone; the caller has checked who may and set the reason. Names no longer
-- given are kept as retired aliases.
create or replace function app._match_program_write(p_id uuid, c jsonb, p_kind text, p_verified_on date, p_submission uuid,
                                                   p_center uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid := p_id; g app.match_programs; v_keys text[]; v_clash jsonb; v_country text := c->>'country'; x text;
begin
  if p_kind not in ('weaver', 'community') then raise exception 'Unknown checker "%".', p_kind; end if;
  v_keys := app._match_keys(c);
  if p_id is not null then
    select * into g from app.match_programs where id = p_id for update;
    if g.id is null then raise exception 'That directory entry was not found.'; end if;
    if g.status = 'merged' then raise exception 'This entry was merged into another one. Change that one instead.'; end if;
    if g.status = 'retired' then raise exception 'This entry is retired. Bring it back first.'; end if;
  end if;
  v_clash := app._match_name_clash(v_keys, v_country, p_id);
  if v_clash is not null and v_clash->>'status' = 'retired' then
    raise exception '"%" is in the directory as an ended program. Bring it back instead of adding it again.',
      v_clash->>'company_name' using errcode = '23505';
  elsif v_clash is not null then
    raise exception '"%" is already in the directory%. Open it to change it, or mark this one a duplicate of it.',
      v_clash->>'company_name', case when v_country is not null then ' for ' || v_country else '' end using errcode = '23505';
  end if;
  if p_id is null then
    insert into app.match_programs (company_name, country, gift_match, volunteer_grant, match_ratio_bp, currency,
                                    min_gift_cents, max_gift_cents, max_year_cents, gift_types, org_kinds, religious_orgs,
                                    eligibility_note, portal, portal_url, deadline_kind, deadline_months, deadline_month,
                                    deadline_day, deadline_note, volunteer_cents_per_hour, volunteer_min_hours,
                                    volunteer_max_year_cents, volunteer_note, notes, source, source_url, last_verified_on,
                                    verified_by_kind, verified_submission_id)
    values (c->>'company_name', v_country, (c->>'gift_match')::boolean, (c->>'volunteer_grant')::boolean,
            (c->>'match_ratio_bp')::int, c->>'currency', (c->>'min_gift_cents')::bigint, (c->>'max_gift_cents')::bigint,
            (c->>'max_year_cents')::bigint, app._mj_array(c->'gift_types'), app._mj_array(c->'org_kinds'), c->>'religious_orgs',
            c->>'eligibility_note', c->>'portal', c->>'portal_url', c->>'deadline_kind', (c->>'deadline_months')::int,
            (c->>'deadline_month')::int, (c->>'deadline_day')::int, c->>'deadline_note',
            (c->>'volunteer_cents_per_hour')::bigint, (c->>'volunteer_min_hours')::int, (c->>'volunteer_max_year_cents')::bigint,
            c->>'volunteer_note', c->>'notes', c->>'source', c->>'source_url', p_verified_on,
            case when p_verified_on is not null then p_kind end,
            case when p_verified_on is not null and p_kind = 'community' then p_submission end)
    returning id into v_id;
  else
    update app.match_programs
       set company_name = c->>'company_name', country = v_country, gift_match = (c->>'gift_match')::boolean,
           volunteer_grant = (c->>'volunteer_grant')::boolean, match_ratio_bp = (c->>'match_ratio_bp')::int,
           currency = c->>'currency', min_gift_cents = (c->>'min_gift_cents')::bigint,
           max_gift_cents = (c->>'max_gift_cents')::bigint, max_year_cents = (c->>'max_year_cents')::bigint,
           gift_types = app._mj_array(c->'gift_types'), org_kinds = app._mj_array(c->'org_kinds'),
           religious_orgs = c->>'religious_orgs', eligibility_note = c->>'eligibility_note', portal = c->>'portal',
           portal_url = c->>'portal_url', deadline_kind = c->>'deadline_kind', deadline_months = (c->>'deadline_months')::int,
           deadline_month = (c->>'deadline_month')::int, deadline_day = (c->>'deadline_day')::int,
           deadline_note = c->>'deadline_note', volunteer_cents_per_hour = (c->>'volunteer_cents_per_hour')::bigint,
           volunteer_min_hours = (c->>'volunteer_min_hours')::int,
           volunteer_max_year_cents = (c->>'volunteer_max_year_cents')::bigint, volunteer_note = c->>'volunteer_note',
           notes = c->>'notes', source = c->>'source', source_url = c->>'source_url',
           last_verified_on = coalesce(p_verified_on, last_verified_on),
           verified_by_kind = case when p_verified_on is not null then p_kind else verified_by_kind end,
           verified_submission_id = case when p_verified_on is not null
                                         then case when p_kind = 'community' then p_submission end
                                         else verified_submission_id end
     where id = p_id;
  end if;
  -- The names: the company's name first (it may have been one of the other names), then the others. A name no longer given
  -- is kept, retired; one given again comes back.
  update app.match_program_names set is_primary = false where program_id = v_id and is_primary;
  update app.match_program_names set retired_at = now()
   where program_id = v_id and retired_at is null and name_key <> all (v_keys);
  insert into app.match_program_names (program_id, name, is_primary) values (v_id, c->>'company_name', true)
    on conflict (program_id, name_key) do update set name = excluded.name, is_primary = true, retired_at = null;
  foreach x in array app._mj_array(c->'names') loop
    insert into app.match_program_names (program_id, name, is_primary) values (v_id, x, false)
      on conflict (program_id, name_key) do update set retired_at = null
        where app.match_program_names.retired_at is not null;
  end loop;
  perform app._match_snapshot(v_id, p_kind, p_center, p_note, p_id is null);
  return v_id;
end $$;

-- ── Weaver's team writes ─────────────────────────────────────────────────────
create or replace function app._assert_weaver(p_doing text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only Weaver''s team can %.', p_doing using errcode = 'insufficient_privilege';
  end if;
end $$;

-- Adds an entry (p_id null) or changes one. The facts' verified_on is the day Weaver's team checked them on the source
-- (today when not given). Returns the entry's id.
create or replace function app.save_match_program(p_id uuid, p_program jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare c jsonb;
begin
  perform app._assert_weaver('change the gift matching directory');
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say what changed and why. It goes in the directory''s history.' using errcode = '22023';
  end if;
  c := app._match_program_clean(p_program, null);
  perform app.set_audit_context('Weaver''s team: ' || app.audit_clean_reason(p_reason));
  return app._match_program_write(p_id, c, 'weaver', coalesce((c->>'verified_on')::date, current_date), null, null,
                                  app.audit_clean_reason(p_reason));
end $$;

-- Retires an entry (the program ended: it stays readable, no longer offered for new links) or brings it back.
create or replace function app.set_match_program_retired(p_id uuid, p_retired boolean, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.match_programs; v_clash jsonb;
begin
  perform app._assert_weaver('retire or bring back a directory entry');
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why. It goes in the directory''s history.' using errcode = '22023';
  end if;
  select * into g from app.match_programs where id = p_id for update;
  if g.id is null then raise exception 'That directory entry was not found.'; end if;
  if g.status = 'merged' then raise exception 'This entry was merged into another one.'; end if;
  if coalesce(p_retired, true) then
    if g.status = 'retired' then return; end if;
  else
    if g.status = 'active' then return; end if;
    v_clash := app._match_name_clash(array(select n.name_key from app.match_program_names n
                                            where n.program_id = p_id and n.retired_at is null), g.country, p_id);
    if v_clash is not null then
      raise exception '"%" is in the directory with one of this entry''s names. Merge the two instead.', v_clash->>'company_name'
        using errcode = '23505';
    end if;
  end if;
  perform app.set_audit_context('Weaver''s team: ' || app.audit_clean_reason(p_reason));
  update app.match_programs
     set status = case when coalesce(p_retired, true) then 'retired' else 'active' end,
         status_reason = case when coalesce(p_retired, true) then app.audit_clean_reason(p_reason) end
   where id = p_id;
end $$;

-- Two entries for one program: p_drop's names move to p_keep (one p_keep has already stays with p_drop, retired) and p_drop
-- points at it from then on. Links and submissions that name p_drop follow it when read (they are the organizations' own
-- and are not rewritten). Returns p_keep.
create or replace function app.merge_match_programs(p_keep uuid, p_drop uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare k app.match_programs; d app.match_programs; v_clash text;
begin
  perform app._assert_weaver('merge directory entries');
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why. It goes in the directory''s history.' using errcode = '22023';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different entries: the one to keep and its duplicate.' using errcode = '22023';
  end if;
  perform 1 from app.match_programs where id in (p_keep, p_drop) order by id for update;
  select * into k from app.match_programs where id = p_keep;
  select * into d from app.match_programs where id = p_drop;
  if k.id is null or d.id is null then raise exception 'That directory entry was not found.'; end if;
  if k.status <> 'active' then raise exception 'The entry to keep must be active.'; end if;
  if d.status = 'merged' then raise exception 'The duplicate was already merged into another entry.'; end if;
  select g.company_name into v_clash
    from app.match_program_names n join app.match_programs g on g.id = n.program_id
   where g.status in ('active', 'retired') and g.id not in (p_keep, p_drop) and n.retired_at is null
     and app._match_same_country(g.country, k.country)
     and n.name_key in (select x.name_key from app.match_program_names x where x.program_id = p_drop and x.retired_at is null)
   limit 1;
  if v_clash is not null then
    raise exception '"%" uses one of the duplicate''s names too. Change one of them first.', v_clash using errcode = '23505';
  end if;
  perform app.set_audit_context('Weaver''s team: ' || app.audit_clean_reason(p_reason));
  update app.match_program_names x set is_primary = false, retired_at = coalesce(x.retired_at, now())
   where x.program_id = p_drop
     and exists (select 1 from app.match_program_names y where y.program_id = p_keep and y.name_key = x.name_key);
  update app.match_program_names set is_primary = false, program_id = p_keep where program_id = p_drop and retired_at is null;
  update app.match_programs set merged_into = p_keep where merged_into = p_drop;
  update app.match_programs set status = 'merged', merged_into = p_keep, status_reason = app.audit_clean_reason(p_reason)
   where id = p_drop;
  perform app._match_snapshot(p_keep, 'weaver', null, 'Merged "' || d.company_name || '" into it: ' || app.audit_clean_reason(p_reason), false);
  return p_keep;
end $$;

-- Brings an entry's facts and names back to an earlier version, in one step, as Weaver's team's check of today. Returns the
-- new version.
create or replace function app.revert_match_program(p_id uuid, p_version int, p_reason text) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.match_programs; v app.match_program_versions; c jsonb;
begin
  perform app._assert_weaver('revert a directory entry');
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why. It goes in the directory''s history.' using errcode = '22023';
  end if;
  select * into g from app.match_programs where id = p_id for update;
  if g.id is null then raise exception 'That directory entry was not found.'; end if;
  if g.status <> 'active' then raise exception 'Only an active entry is reverted. Bring it back first.'; end if;
  select * into v from app.match_program_versions where program_id = p_id and version = p_version;
  if v.id is null then raise exception 'That version of the entry was not found.'; end if;
  if p_version = g.version then raise exception 'That is the entry as it is now.'; end if;
  c := app._match_program_clean(v.facts - 'verified_on', 'other');
  perform app.set_audit_context('Weaver''s team: reverted to version ' || p_version || ': ' || app.audit_clean_reason(p_reason));
  perform app._match_program_write(p_id, c, 'weaver', current_date, null, null,
                                   'Reverted to version ' || p_version || ': ' || app.audit_clean_reason(p_reason));
  return (select version from app.match_programs where id = p_id);
end $$;

-- ── Finding entries by name ──────────────────────────────────────────────────
-- The entries one of whose names (given now, not a retired alias) has this key (same_name), contains it, or is contained
-- in it (part_of_name: the shorter key at least 3 characters), each once with its closest name; checked_by_weaver ranks
-- an entry Weaver's team checked above one a community verified at the same level.
create or replace function app._match_find(p_key text)
returns table (program_id uuid, matched_name text, how text, gap int, checked_by_weaver boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select distinct on (n.program_id) n.program_id, n.name,
         case when n.name_key = p_key then 'same_name' else 'part_of_name' end,
         abs(char_length(n.name_key) - char_length(p_key)),
         coalesce(g.verified_by_kind = 'weaver', false)
    from app.match_program_names n join app.match_programs g on g.id = n.program_id
   where p_key is not null and n.retired_at is null
     and (n.name_key = p_key
          or (char_length(p_key) >= 3 and strpos(n.name_key, p_key) > 0)
          or (char_length(n.name_key) >= 3 and strpos(p_key, n.name_key) > 0))
   order by n.program_id, (n.name_key = p_key) desc, abs(char_length(n.name_key) - char_length(p_key)), n.is_primary desc
$$;

-- The directory, or the entries a name finds (same name first, then the closest; Weaver's team's checks first at each
-- level), for its readers.
--   {"total": 3, "rows": [{"id", "company_name", "country", "gift_match", "volunteer_grant", "match_ratio_bp", "currency",
--     "max_gift_cents", "max_year_cents", "portal", "religious_orgs", "last_verified_on", "verified_by_kind", "status",
--     "matched_name", "how"}]}
-- p_status: active (default), retired, or all (merged entries are never listed; they point at the one they joined).
create or replace function app.match_program_search(p_query text default null, p_status text default 'active',
                                                    p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_key text := app.employer_name_key(p_query); v_status text; v_limit int; v_offset int; v_total int; v_rows jsonb;
begin
  if not app.match_directory_can_read() then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  v_status := case when p_status in ('active', 'retired', 'all') then p_status else 'active' end;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  with f as (select * from app._match_find(v_key)),
       hits as (
         select g.id, g.company_name, g.country, g.gift_match, g.volunteer_grant, g.match_ratio_bp, g.currency,
                g.max_gift_cents, g.max_year_cents, g.portal, g.religious_orgs, g.last_verified_on, g.verified_by_kind,
                g.status, f.matched_name, f.how, coalesce(f.gap, 0) as gap
           from app.match_programs g
           left join f on f.program_id = g.id
          where g.status <> 'merged' and (v_status = 'all' or g.status = v_status)
            and (v_key is null or f.program_id is not null)),
       page as (
         select h.*, row_number() over (order by coalesce(h.how = 'same_name', false) desc,
                                                 coalesce(h.verified_by_kind = 'weaver', false) desc,
                                                 h.gap, lower(h.company_name), h.id) as ord
           from hits h
          order by ord
          limit v_limit offset v_offset)
  select (select count(*) from hits),
         coalesce((select jsonb_agg(to_jsonb(p) - 'gap' - 'ord' order by p.ord) from page p), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- An entry's versions, newest first, for Weaver's team: the version, when, by Weaver's team or which community, the note.
create or replace function app.platform_match_program_versions(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app._assert_weaver('see a directory entry''s versions');
  return coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'written_at', v.written_at,
                                                       'written_kind', v.written_kind, 'community', c.name,
                                                       'note', v.note, 'company_name', v.facts->>'company_name')
                                    order by v.version desc)
                     from app.match_program_versions v left join app.centers c on c.id = v.written_center_id
                    where v.program_id = p_id), '[]'::jsonb);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._mj_text(jsonb, text, int, text, boolean), app._mj_int(jsonb, text, bigint, bigint, text),
  app._mj_bool(jsonb, text, boolean, text), app._mj_choice(jsonb, text, text[], text), app._mj_list(jsonb, text, text[], text),
  app._mj_https(jsonb, text, text), app._mj_array(jsonb), app._match_program_clean(jsonb, text), app._match_keys(jsonb),
  app._match_same_country(text, text), app._match_name_clash(text[], text, uuid), app._match_name_used(text[], text, uuid),
  app._match_near_weaver(text[], text, uuid), app._match_program_facts(uuid), app._match_snapshot(uuid, text, uuid, text, boolean),
  app._match_program_write(uuid, jsonb, text, date, uuid, uuid, text), app._assert_weaver(text), app._match_find(text),
  app._matching_org_can(uuid)
  from public, anon, authenticated;
revoke execute on function app.match_portals(), app.match_gift_types(), app.match_org_kinds(), app.match_religious_rules(),
  app.match_deadline_kinds(), app.match_sources(), app.employer_name_key(text), app.match_directory_can_read(),
  app.matching_org_readable_centers(), app.save_match_program(uuid, jsonb, text),
  app.set_match_program_retired(uuid, boolean, text), app.merge_match_programs(uuid, uuid, text),
  app.revert_match_program(uuid, int, text), app.match_program_search(text, text, int, int),
  app.platform_match_program_versions(uuid)
  from public, anon;
grant execute on function app.match_portals(), app.match_gift_types(), app.match_org_kinds(), app.match_religious_rules(),
  app.match_deadline_kinds(), app.match_sources(), app.employer_name_key(text), app.match_directory_can_read(),
  app.matching_org_readable_centers(), app.save_match_program(uuid, jsonb, text),
  app.set_match_program_retired(uuid, boolean, text), app.merge_match_programs(uuid, uuid, text),
  app.revert_match_program(uuid, int, text), app.match_program_search(text, text, int, int),
  app.platform_match_program_versions(uuid)
  to authenticated;
