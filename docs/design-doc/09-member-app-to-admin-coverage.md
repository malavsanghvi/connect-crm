> Exported from the JSH Platform · Recommendations and Roadmap doc (claude.ai artifact 338356dc…) on 2026-09-23. Source of truth for decisions made before the build; later decisions live in ../DECISIONS.md.

# Member app to admin coverage

Every member-app feature now has an admin screen that manages it; 50 of 54 are covered in the admin prototype and 4 are partial. Checked Sep 2026 against the member app, onboarding, New to JSH guide, Gyan Path and community dashboard prototypes.

## Coverage matrix

| Member-app area | Feature, fields or navigation | Managed in admin (module › tab) | Status |
| --- | --- | --- | --- |
| Sign-in | Email or mobile code, Face ID, shared contact with a child needs a code for money | Settings › Security | Covered |
| Onboarding | Family match, "not my family", per-person fields, privacy opt-ins | Settings › Onboarding fields; People › Membership applications | Covered |
| Home | Today at JSH: tithi, sunrise, navkarsi, chauvihar, aarti | Content › Today & darshan; Calendar | Covered |
| Home | Live darshan | Content › Today & darshan | Covered |
| Home | RSVP confirmation card and pop-ups | Events › Event builder; Settings › Notifications | Covered |
| Home | Lunch times card and 5-minute reminder | Events › Event builder, Live check-in; Settings › Notifications | Covered |
| Home | My Jain Way card, streak, points | Content › Practices & points | Covered |
| Home | Satvik Store card | Satvik Store › Menu & pickup | Covered |
| Home | Giving opportunity alert | Giving › Opportunities (alert targeting) | Covered |
| Home | Special-day labh prompt | Giving › Labh fulfillment (labh menu); Settings › Notifications | Covered |
| Home | New to JSH card | Content › Guide & directory | Covered |
| Floating Niva | Answers with sources, suggested questions | Content › Niva | Covered |
| Pull-out menu | Calendar, Pathshala Connect, My Donations, Store, RSVP, guide, dashboard, Settings | Each module below | Covered |
| Events | Upcoming list, eligibility, waitlist | Events › All events, Event builder | Covered |
| Events | RSVP: family members, add guest, child under 12, senior, assistance | Events › Event builder (attendee questions) | Covered |
| Events | Donation commitment per person or lump sum | Events › Event builder | Covered |
| Events | CRM save flow, pledge creation | Giving › Pledges; audit log | Covered |
| Events | Tickets, QR, Wallet pass | Events › Live check-in | Partial |
| Events | 24-hour confirmation, change or cancel | Events › Event builder; Settings › Notifications | Covered |
| Events | Calendar layers (tithi, Pathshala, events, ISDs) | Calendar | Covered |
| Events | Photo albums | Content › Photo albums, Approval queue | Covered |
| Give | Giving this year, statements | Giving › Receipts & statements | Covered |
| Give | Digital bolis: floor, pledges, outbid, cutoff, explainer video | Bolis › Digital bolis; Content (videos) | Covered |
| Give | In-person bolis list and results | Bolis › New boli (in-person type), In-person upload | Covered |
| Give | Sponsorship tiers, pujan list with taken status, construction amounts | Giving › Opportunities | Covered |
| Give | Pay now or pledge; allocation to earliest pledge | Giving › Payments & deposits (allocation preview) | Covered |
| Give | Family pledges by year, collapse, tax statements | Giving › Pledges, Receipts & statements | Covered |
| Give | Recurring giving | Giving › Recurring | Covered |
| Give | Payment methods, processing-fee question | Settings › Rules; Integrations | Covered |
| Store | Menu, prices, gift packing $2.99, pickup slots, cutoff | Satvik Store › Menu & pickup | Covered |
| Store | Orders and kitchen prep | Satvik Store › Orders by pickup | Covered |
| Store | Inventory | Satvik Store › Inventory | Covered |
| Jain Way › Today | Practices, categories, points, standings | Content › Practices & points | Covered |
| Jain Way › Learn | Gyan Path goals, levels, treasure, sign-off | Content › Gyan Path; Pathshala › Gyan Path sign-offs | Covered |
| Jain Way › Learn | Pathshala classes and enrollment | Pathshala › Classes | Partial |
| Jain Way › Saathi | Celebrations, anumodana points, support alerts | Content › Practices & points; Settings › Notifications | Covered |
| Jain Way › Library | Pachchakhan, audio lessons, darshan | Content › Library, Today & darshan | Covered |
| Family | Members, household balance | People › Households | Covered |
| Family | Per-person profile, preferences | Settings › Onboarding fields | Covered |
| Family | Open to new members, expertise listings | People › Directory & expertise | Covered |
| Family | Voting eligibility | People › Voting eligibility | Covered |
| Family | Special days | Private to the family; labh side in Giving › Labh fulfillment | Covered |
| Family | Child access limits | Settings › Rules (login age), Roles | Covered |
| Member card | Rotating QR, family cards | Events › Live check-in | Partial |
| Settings | Notifications, quiet hours, language, text size | Settings › Notifications | Covered |
| Settings | Deactivate, delete, download data | Settings › Privacy | Covered |
| Settings | Privacy policy, terms | Content › Legal & waivers | Covered |
| New to JSH | WhatsApp groups and join requests | Communications › WhatsApp queue; Content › Guide & directory | Covered |
| New to JSH | Zones, ZIPs, zone leads, message lead | Content › Guide & directory; Communications › Inbox | Covered |
| New to JSH | Administration roster | Content › Guide & directory | Covered |
| New to JSH | Volunteer interest, legal waiver | Content › Legal & waivers; volunteer platform | Partial |
| New to JSH | Ask a question | Communications › Inbox | Covered |
| New to JSH | Membership info and application | People › Membership applications; Settings › Rules | Covered |
| Community dashboard | Public KPIs | Reports › Community dashboard | Covered |

## Partial items still to prototype

| Item | What the admin side still needs |
| --- | --- |
| Tickets, QR and Wallet passes | Reissue or revoke a ticket or member card; see which QR token was scanned and where |
| Pathshala enrollment | Registration windows, fees per child, placement by level, class waitlists, term progress reports |
| Volunteer interest and waivers | Lives in the separate volunteer prototype; this portal shows waiver signature status only |
| Secondary admin actions | Edit household, merge wizard, opportunity preview, quiz editor for Gyan Path levels show a message only |
