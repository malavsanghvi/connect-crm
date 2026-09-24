# Prototype vs app parity audit: Family tab, app shell, Onboarding, Welcome guide, Volunteer

I did not change, commit or push anything. I read the prototype code for Main (Family scope and shell), Onboarding, Welcome and Volunteer, and clicked through the Family screens in Chromium. Screenshots are in `/tmp/claude-0/audit/` (`10-family-*`, `11-person-priya-*`, `12-person-dev-*`, `13-card`, `14-days-*`, `15-labh-*`, `16-menu`, `17-settings-*`, `18-legal`). App paths below are relative to `/home/user/connect-mobile/`. Copy strings are in `src/i18n/en.ts` (written as en.ts:NNN).

**How to read the tables:** each row is prototype value, then app value, then status. Status is **D** (differs), **M** (missing in the app) or **X** (extra in the app). Rows that match are left out.

**The five biggest gaps:**
1. **Birthday labh screen is missing.** There is no route, and the Special days screen has no "Plan labh" button.
2. **Volunteer mode skips the "confirm who is here" step.** It checks in the whole family the moment a code is scanned. There is also no walk-in lookup by phone and no counter, and the screen is not dark-themed. The backend already supports all of this (`check_in` with station `'lookup'` and `p_attendee_ids`, and `checkin_lookup_phone`).
3. **The Welcome guide keeps only 3 of its 9 sections.** Timings, Links, Volunteer, Administration, Membership and Registrations are missing, as are the 5-step progress checklist and the Explore tiles.
4. **The Profile screen is missing several fields the database already has.** Phone call, best time to call, the extra-emails list, per-person notification switches, the newcomer "reach me by" choices and the expertise "Visible to" choice all have columns or tables in migration 0018 or 0001. The app also uses two save buttons where the prototype has one.
5. **Branding.** The app is still called "Connect" (app.json name, slug, scheme, permission prompts, web title) and uses the default Expo icon and a blank splash image.

---

## 0. App shell

### 0.1 Header (prototype Main 21–40; app `src/components/screen.tsx:211-241`)
| Element | Prototype | App | Status |
|---|---|---|---|
| Menu and back buttons | 44px white circle with a #E3D9C8 border | `IconButton` with no border or fill (`ui.tsx:157-168`) | D |
| Member-card button | Filled navy circle with a white QR glyph, shown on every screen | Plain navy `qr-code-outline` icon; hidden when there is no member (screen.tsx:234-238) | D |
| Title position | Left-aligned right after the button (flex-grow), Fraunces 22 | Centred (screen.tsx:223) | D |
| Home header | Centred logo image `jsh-mark.png` (46px) plus "JAIN SOCIETY / OF HOUSTON" (Fraunces 17 over DM Sans 11, letterspaced) | `Wordmark`: initials circle (or `branding.logo_url`) plus the name in uppercase caption, left-aligned (screen.tsx:199-209) | D |
| Header padding | 16/20/12 | `space.md` horizontal and `space.sm` vertical | D (P3) |
| "PROTOTYPE · SAMPLE DATA" badge | Prototype only | none | OK (correctly omitted) |

### 0.2 Bottom tab bar (prototype 1321–1327; app `src/app/(app)/(tabs)/_layout.tsx`)
| Element | Prototype | App | Status |
|---|---|---|---|
| Labels | Home · Events · Give · Jain Way · Family, 12px/600 | Same labels at 11px (`_layout.tsx:34`) | D (P3) |
| Icons | Custom 1.8-stroke outline icons: house, calendar, heart, **open book** (Jain Way), people | Ionicons, filled when active; Jain Way uses **flower** (`_layout.tsx:19`) | D |
| Inactive colour | `#8A8478` | `colors.faint` (#8A8478) | Match |
| **Card, Profile, Settings and Legal keep the tab bar** | Yes: these are views inside a tab, and the Family tab stays highlighted | Member card is a modal with no tab bar (`(app)/_layout.tsx:18`). Person, settings, legal and the others are stack screens above the tabs, so the tab bar is hidden | D |

### 0.3 Drawer menu (prototype 1344–1395; app `src/components/drawer.tsx`)
| Element | Prototype | App | Status |
|---|---|---|---|
| Top | Logo image (52px) with a round close button on the right; "Jain Society of Houston" (Fraunces 19); "Priya Shah · Shah family · Life members" | No logo. Centre name as headline plus identity line (drawer.tsx:73-80) | D (logo M) |
| Item 1 | **Calendar**, "Tithi, Pathshala, events and school dates" | Same (en.ts:46-47) | Match |
| Item 2 | **Pathshala Connect**, "Classes, attendance and teachers" | "Pathshala and learning", "Gyan Path, classes and progress" (en.ts:48-49) | D |
| Item 3 | **My Donations** | "My donations" (en.ts:50) | D (case) |
| Item 4 | Satvik Store, "Mithai and namkeen, made to order" | "Order Jain mithai and namkeen" (en.ts:53) | D |
| Item 5 | **RSVP**, "Upcoming events and your tickets" | "Events and tickets" (en.ts:54) | D |
| Icon tiles | 44px, tint varies by item (brownTint for calendar and donations, greenTint for store, navyTint for the rest), plus a › chevron | 40px, all navyTint, no chevron (drawer.tsx:30-33) | D |
| Divider, then "Community dashboard" | Link to the public dashboard | — | M |
| "New to JSH guide and help" | In the secondary group, grey tile | "New here? Start with the guide" in the main list (en.ts:56) | D |
| Ask Niva, Volunteer mode | Not in the drawer (Niva is a floating button; volunteer is a separate board) | Drawer items (drawer.tsx:89-92) | X |
| Settings | Pinned to the bottom above a top border | Inline after a divider | D |
| Footer | "JSH app · version 1.0.0" | "Connect · version 1.0.0" (en.ts:66) | D (brand) |

### 0.4 Other global elements
| Element | Prototype | App | Status |
|---|---|---|---|
| **Niva floating button** ("✦ Niva", brown pill above the tab bar at bottom 92, opens a menu with 3 suggested questions and "Open chat") | Everywhere except Settings, Legal, Sync, Card, Store, Cart and Niva | Only a drawer item and a placeholder screen | M |
| Toast | Green, top 76px, e.g. "✓ Special day saved · reminder 2 weeks before" | `FeedbackProvider` toast | Match (copy differs per screen) |
| Confirm dialog | Fraunces 22 title, body, coloured confirm (red for delete, brown for deactivate, navy for sign-out), outlined "Cancel" | `confirm()` with tones | Match |
| "Saving" progress screen (`view:'sync'`) | Mark, title, "Please keep the app open", per-step ✓/… rows, then "Saved to your JSH account", result text and a CTA | Not built; actions save directly and show a toast | M (P3: the prototype note says these steps stand for Neon calls) |
| Kid mode | Locked screen "Ask a parent" | Strings en.ts:69-71 | Match (outside Family scope) |

---

## 1. Family tab
**Click path:** tab bar › Family. **App route:** `src/app/(app)/(tabs)/family.tsx`.

| # | Prototype (454–482) | App | Status |
|---|---|---|---|
| — | No household hero card | Navy card with household name, "Shah family · JSH household ID … · Connect 123", tier pill and "Member since …" (family.tsx:63-83) | X |
| 1 | Special days card (brownTint): "Special days" with "See all ›" on the right, then 2 rows of "title … in 14 days" with the timing right-aligned in bold | Amber card: title plus chevron icon (no "See all" text); rows are "Anya's birthday — Tue, Oct 6" as a single line with a date, not "in N days" (family.tsx:85-105) | D |
| — | No section heading | "FAMILY MEMBERS" `SectionTitle` (family.tsx:107) | X |
| 2 | Member row: 40px initial, name, "Primary · Life member · JSH-10421" | Name, then "Primary · Age 41", then a separate identifiers line "JSH member ID … · Connect JSH-…" (family.tsx:116-124). Children's avatars are purple | D |
| 3 | **Profile** button: filled navy pill | Secondary (white with navy border) (family.tsx:126) | D |
| 4 | **QR** button: outlined pill labelled "QR", opens the member card for that person | Icon-only button with no outline (family.tsx:127) | D |
| 5 | "Update family profile (onboarding)" goes to the **full Onboarding flow** | "Update family profile" goes to `/family-review` (step 4 only); shown to adults only (family.tsx:131) | D |
| 6 | Voting card (green): "Voting eligibility · In good standing" plus ✓ lines | Data-driven; adds "As of {date}" (and override note), and an ✗ variant (family.tsx:134-156) | Match / X |
| 7 | Note: "Contact, language and notification preferences are set per person. Tap Profile next to any family member." in a panel (#F6EFE3) | Same copy (en.ts:707) but as plain muted text with no panel | D (P3) |
| — | — | "Contact and mail preferences" link to `/preferences` (family.tsx:162) | X |
| 8 | "JSH guide, help and requests" (centred link) | "Guide, help and requests" (en.ts:709) inside a card, underlined | D |
| 9 | "Sign out" as centred grey text | Red underlined link with a confirm dialog (family.tsx:164) | D (style) |

---

## 2. Person profile
**Click path:** Family › Profile. **App route:** `src/app/(app)/person/[id].tsx`, using `features/onboarding/profile-fields.tsx` and `contact-prefs-form.tsx`.

| # | Prototype (793–899) | App | Status |
|---|---|---|---|
| 1 | Navy hero: 52px **brownTint** initial in Fraunces, name (Fraunces 21), "Primary · 41 · JSH-10421", outlined "QR" pill | Avatar in navyTint; "Primary · Age 41" plus identifiers line; icon-only QR (person.tsx:84-100) | D |
| 2 | "Details" card title | "DETAILS" as an eyebrow `SectionTitle` outside any card (person.tsx:104) | D |
| — | No first or last name fields (name is not editable here) | First name and Last name fields (profile-fields.tsx:32-39) | X |
| 3 | DOB and **Relationship** side by side (2 columns) | DOB field with hint and placeholder MM/DD/YYYY; **no Relationship field** | D / M |
| 4 | Gender chips: Female / Male / Prefer not to say | Same labels (en.ts:149-151) | Match (chip style differs, see §9) |
| 5 | Profession | Same | Match |
| — | — | "Employer (optional)" with hint (profile-fields.tsx:63) | X (the prototype only asks for this in onboarding) |
| 6 | Mobile | Same | Match |
| 7 | **Emails list** with Primary/Work tags and "+ Add another email" | One "Email" field with hint "Receipts and statements go to this address." `app.person_emails` (0018) is unused | M |
| 8 | Card "How to reach {first}": 2×2 grid **Phone call / Text / SMS / WhatsApp / Email** | "Contact me by (choose any)": `Text · SMS`, `WhatsApp`, `Email` only (`family.ts:81-82`, en.ts:192-195). **No Phone call** (`people.contact_channels` in 0018 is unused) | D / M |
| 9 | "Best time to call": Morning / Afternoon / Evening | — (`people.best_call_time` in 0018 is unused) | M |
| 10 | "App language": English / ગુજરાતી / हिन्दी (3-column grid) | Same, from `LANGUAGES` | Match |
| 11 | "Notifications for {first}": 4 switches (Events and reminders, Giving opportunities and bolis, Pathshala updates, Daily temple timings) | Heading exists (en.ts:170), but under it the app shows the whole contact-prefs form: channels, language, topics as chips, documents and mail, and a second "Save changes". **No per-topic switches** | D |
| 12 | "Community connections": toggle "Open to questions from new members", sub "Verified JSH members who joined in the last 12 months can reach {first} for help getting settled" | Sub "Verified members who joined in the last 12 months." (en.ts:161) | D |
| 13 | When on: "They can reach {first} by" chips (In-app message / WhatsApp / Phone call) | — | M |
| 14 | "Mobile number and email stay hidden until {first} replies." | Same (en.ts:162) | Match |
| 15 | Toggle "Share my expertise", sub "List {first} in the member expertise directory so others can ask for guidance" | Sub "Listed in the member directory for verified members." (en.ts:164) | D |
| 16 | 9 expertise tags | Same 9 (person.tsx:21) | Match |
| 17 | "One-line headline" | Same, plus placeholder | Match |
| 18 | "Visible to": All verified members / New members only | — | M |
| 19 | Disclaimer "…isn't endorsed by JSH…" | "…by the center…" (en.ts:167) | D (should use the centre short name) |
| 20 | Separate **"Interests" card** (6 brown-outlined chips: Events, Pathshala, Volunteering, Youth programs, Seniors, Giving opportunities) | Topics come from `notification_topics` as "Interested in" inside the prefs form; `people.interests` is unused | D |
| 21 | **One** "Save changes" button that turns into "✓ Saved to JSH record" (green) | Two buttons: profile save ("✓ Saved", en.ts:173) placed **above** the notifications section, and a second save in the prefs form | D |
| 22 | Child: note "Messages about {first} go to parents. Members under 18 can view events…" and no contact or community sections | Info banner with the same text (en.ts:168), plus the prefs form (topics only) with note en.ts:169 | Match / X |

---

## 3. Member card
**Click path:** header QR, or Family › QR. **App route:** `src/app/(app)/member-card.tsx` (a modal).

| # | Prototype (1297–1317) | App | Status |
|---|---|---|---|
| 1 | Header: back button with title "Member card", plus QR button; tab bar stays visible | Modal: centred title with an **X close button** on the right; no tab bar (member-card.tsx:34-40) | D |
| 2 | Navy card, **everything centred**: "JAIN SOCIETY OF HOUSTON" (12px, letterspaced), name (Fraunces 24), "Primary · Life member · JSH-10421" | Left-aligned: eyebrow, name (display), "Primary · Age 41 · Life members", identifiers line (member-card.tsx:44-57) | D |
| 3 | QR in **navy** on a white 16-radius panel, 189px | QR in ink (#1E1C18) on white, 200px (`qr.tsx:10`) | D (P3) |
| 4 | "Refreshes every 30 seconds · works offline" | "Use at event check-in and Pathshala attendance." (en.ts:759). The QR is a static member number, so the 30-second rotation is **not built** (comment member-card.tsx:15-19) | D / M |
| 5 | First-name pills, centred, navy fill when selected | Chips (with a checkmark), left-aligned wrap | D (P3) |
| 6 | Black "Add family cards to Apple Wallet" button | Disabled secondary "Add family cards to Wallet — coming soon" (en.ts:760) | D |

---

## 4. Special days and Birthday labh
**Click path:** Family › Special days. **App route:** `src/app/(app)/special-days.tsx`. The labh screen is **MISSING**.

| # | Prototype (1168–1194) | App | Status |
|---|---|---|---|
| 1 | Intro "Birthdays, anniversaries, birth tithis and punyatithis for your family. We remind you before each one, with ideas for a labh." | "Private to your family. We'll remind you before each one so you can plan a labh." (en.ts:714) | D |
| 2 | Row: date tile (48×52, tint by kind), title, sub (e.g. "Turns 10 · Tue, Oct 6", "Rahul's mother · Aso vad 6 · Fri, Oct 30"), reminder line "Reminder sent · 2 weeks before" or "Reminder 2 weeks before · in 38 days" | Sub is "Birthday · Tue, Oct 6"; "Turns N" and relation are missing; reminder reads "Reminder 14 days before" in days, not weeks, and has no "· in N days" (en.ts:723-724) | D |
| 3 | **"Plan labh"** brown button on rows within 14 days, opens Birthday labh | — | **M (P1)** |
| — | — | Delete (trash) icon per row (special-days.tsx:97) | X |
| 4 | Dashed button "+ Add a special day" that toggles to "Close" | Filled brown "Add a special day" with a + icon; Cancel inside the form | D |
| 5 | Form label "Whose special day?": Priya / Rahul / Dev / Anya / Someone else | "Whose" (en.ts:731); navy chips in the prototype vs brown in the app | D |
| 6 | Occasion: **Birthday, Anniversary, Birth tithi, Punyatithi, Other** | Birthday, Anniversary, Punyatithi, **Diksha**, Other (`features/special-days.ts:5`) | D (Birth tithi missing) |
| 7 | "Remember it by": 2-column chips "Calendar date" / "Jain tithi" | Segmented control | D (P3) |
| 8 | Date field "Date", or "Tithi (month, paksha and day)" as one field | Date as MM/DD/YYYY, or two fields "Jain month" + "Tithi" | D |
| 9 | "Remind me": **1 week / 2 weeks / 1 month** | "1 week before / 2 weeks before / 1 month before" (en.ts:747-749) | D |
| — | — | "Show on Home when it is near" toggle and punyatithi note | X |
| 10 | "Save special day"; toast "✓ Special day saved · reminder 2 weeks before" | Toast "…reminder 14 days before" (en.ts:753) | D |

**Birthday labh (`view:'labh'`, prototype 1196–1220): missing entirely.** It contains:
- Brown hero: "TUE, OCT 6 · {TITHI}", "Anya's 10th birthday", "Choose one or more ways to mark the day".
- 6 labh options with checkboxes and amounts (Snatra puja $51, Ashtaprakari puja $108, Gift for her Pathshala class $151, Jeevdaya donation $51, Sponsor Sunday bhojanshala $251, Sadharmik bhakti $108).
- A count and total line.
- "Dedication (shown at the derasar and to the Pathshala class)" field.
- Toggle "Repeat every year on her birthday".
- "Commit $X as a pledge" (goes to the Saving screen, then back to Special days) and "Pay $X now" (payment sheet).
- A push notification for the special day, 2 weeks before, also opens this screen. The app's `src/providers/push.tsx` has no routing when a notification is tapped.

---

## 5. Settings
**Click path:** drawer › Settings. **App route:** `src/app/(app)/settings.tsx`.

| # | Prototype (1088–1152) | App | Status |
|---|---|---|---|
| 1 | Identity card: 48px **filled navy** "P", name, "email · phone", Active/Deactivated badge | Tinted Avatar at 52px; otherwise the same (settings.tsx:114-125) | D (P3) |
| 2 | ACCOUNT: "Profile and family", sub "Names, contact details, family members" | Title only, no sub (settings.tsx:130) | D |
| 3 | "Sign-in and security", sub "Email one-time code, change email or mobile" | — | M |
| 4 | "Face ID sign-in", sub "Unlock the app without a code" | "{method} sign-in", sub "Unlock Connect with your face or fingerprint." (en.ts:768-769) | D (brand) |
| 5 | "Signed-in devices", sub "This iPhone · last used today" | — | M |
| 6 | NOTIFICATIONS: "Push notifications", sub "Master switch for all alerts" | Sub "…· on for this phone" / "Off for this phone" (en.ts:772-773) | Match (dynamic) |
| 7 | "Quiet hours" | Same copy (en.ts:774-775) | Match |
| 8 | "Notification topics", sub "Set per person in each profile", goes to the **Family tab** | Sub "Channels, topics, language and mail", goes to **/preferences** (settings.tsx:162) | D |
| 9 | APP PREFERENCES: Language (3 chips), Text size (Standard/Large/Largest) | Same, plus a language note (en.ts:780) | Match / X |
| 10 | **Appearance**: Light / Dark / System | — (app.json forces `userInterfaceStyle: light`) | M |
| 11 | PRIVACY: "Use location for daily timings", sub "Sunrise, navkarsi and chauvihar for where you are" | — | M |
| 12 | "Share anonymous usage data", sub "Helps JSH improve the app" | — | M |
| 13 | "Show my family in the member directory" | Same (adults only) | Match |
| 14 | "Download my data", sub "Get a copy of your profile, RSVPs and giving"; toast "✓ Your data export will be emailed within 24 hours" | Sub "We email an export within 30 days."; toast "✓ Request sent · your data export will be emailed" (en.ts:789-790) | D |
| 15 | "Privacy policy" sub "How JSH collects and uses your information"; "Terms of use" sub "Rules for using the JSH app" | Titles only, no subs | D |
| 16 | PAYMENTS: "Saved payment methods", sub "Visa ···· 4417 · Apple Pay" | — | M (online payment not yet built) |
| 17 | "Receipts and tax statements", goes to Family pledges | Same | Match |
| 18 | SUPPORT: "Help and FAQs" | — | M |
| 19 | "Contact JSH", sub "Send a question to the right team" | "Contact the center", sub "Ask a question · replies in 3–5 business days" (en.ts:797-798) | D |
| 20 | "Report a problem", sub "Tell us what went wrong in the app" | — | M |
| 21 | "About this app", sub "Version 1.0.0 (build 42) · open-source licenses" | "Connect version {v}", not tappable (en.ts:800) | D |
| 22 | ACCOUNT STATUS body: "Deactivating pauses your app account: notifications stop and you're signed out on all devices…" | A different, longer body (en.ts:802) | D |
| 23 | "Deactivate account": **brown** outline | Secondary (navy) (settings.tsx:241) | D |
| 24 | After deactivating, the prototype stays in the app, shows "Your account is deactivated. Notifications are paused." and a green **"Reactivate account"** button, and Home shows a banner | App signs out immediately (settings.tsx:97-99); reactivate lives only on the Home banner (`features/home.tsx:47-63`) | D |
| 25 | "Delete app account": **red text** | `ghost` tone, which is navy text (settings.tsx:242) | D |
| 26 | Confirm copy for deactivate and delete | Differs (en.ts:805, 810 vs prototype 2056) | D |
| 27 | "Sign out" as an outlined navy pill | Secondary | Match |

## 6. Legal
**Click path:** Settings › Privacy policy / Terms of use. **App route:** `src/app/(app)/legal.tsx`.
- The prototype shows "Last updated [date] · draft for JSH review", 5 section **cards** (for example "What we collect…"), and the footer "[Final text to be approved…]".
- The app renders the published `legal_documents` markdown with a version line (en.ts:816). If nothing is published it shows "…hasn't published its {title} yet."
- The data-driven approach is acceptable. Visually, the prototype's one-card-per-section layout is missing (P3).
- Note: the prototype's Back goes to the tab root, which looks like a prototype bug. The app goes back to Settings, which is correct.

## 7. App-only screens reachable from Family
- `/preferences` (preferences.tsx) and the Family link "Contact and mail preferences" are **X**. The prototype handles all of this inside Profile.
- `/family-review`: the prototype link goes to full onboarding. The app reuses step 4, which is reasonable, but the add-member request goes to a thread inbox (`lib/api/family.ts:202-220`) and **not** to `app.household_change_requests` (0018 §5), which exists and is unused (P2). The request body is signed "Sent from the Connect member app." (family.ts:217), which is a brand string.

---

## 8. Onboarding (`Onboarding.dc.html`)
App routes: `(auth)/welcome.tsx`, `(auth)/sign-in.tsx`, `(onboarding)/{family-match,about,family,contact,done}.tsx`, with chrome in `features/onboarding/frame.tsx`.

**Frame (steps 1–5)**
- **D:** "Step N of 5" is left-aligned next to back in the prototype; the app centres it (frame.tsx:35).
- **D:** Skip is a navy 14/600 button in the prototype; the app uses an underlined muted link.
- **D:** Step titles are Fraunces 26 in **ink** in the prototype; the app uses display **navy** (frame.tsx:48).
- **D:** The prototype CTA sits inline in the content; the app uses a sticky footer.

**Step 0, Welcome**
- **M/D:** Prototype has a centred 150px `jsh-logo.png`. The app shows a 72px initials circle, left-aligned (welcome.tsx:19).
- **D:** "Jai Jinendra" is 16px muted in the prototype; the app uses a brown uppercase eyebrow.
- **D:** Headline is Fraunces 34 ink in the prototype; the app uses hero 30 navy. The copy matches (en.ts:98).
- **D:** Buttons have no icons in the prototype; the app adds mail and phone icons.
- **D:** The guest link is not underlined in the prototype.

**Step 1, Sign in**
- **D:** The prototype is **one screen** titled "Sign in" with Email, "6-digit code we sent you", "Didn't get it? Resend in 0:42", Verify, and the checkbox "Use Face ID next time" **below** Verify.
- The app splits this into two stages. Titles are "Sign in with email" / "Enter your code"; the code label is "Code we sent you"; resend reads "You can resend in 42s" (en.ts:105-121). The subtitle ("We'll send you a sign-in code…") and the "Use a different email" link are app-only (**X**).
- The app accepts 6–10 digits, so the prototype label "6-digit code" should become dynamic, not literal.

**Step 2, Is this your family?**
- **D:** Subtitle is "We matched your email to the JSH membership records." in the prototype; the app interpolates the identity (en.ts:127).
- **D:** Prototype card: household in Fraunces 22 **ink**, "LIFE MEMBERS" in green caps text, and each member with **relationship** under the name. The app has a navy headline, an amber pill, and **names only** (family-match.tsx:100-111).
- **D:** "Yes, that's us" sits **below** the card in the prototype; the app puts it inside.
- **X:** Inline new-profile form and office-help note.

**Step 3, About you**
- **X:** The app adds a subtitle (en.ts:140).
- **D:** Employer label is "Employer (optional · checks for donation matching)" in the prototype, vs "Employer (optional)" plus hint (en.ts:153-154).
- **M:** Emails list with Primary/Work tags and "+ Add another email"; the app has a single Email field.

**Step 4, Your family**
- **D:** The prototype edit panel fields are Relationship, DOB, Gender, Profession, Mobile, Email. The app has First, Last, DOB, gender chips, Profession, Employer, Mobile, Email, and **no Relationship field**.
- **D:** The prototype "+ Add family member" (dashed) adds a new inline card to fill in. The app opens a request form to the membership team.
- **X:** Relationship note (en.ts:188).

**Step 5, How should we reach you?**
- **M:** "Phone call" channel and "Best time to call".
- **D:** "Interested in (helps us send the right updates)" is shortened to "Interested in" (en.ts:198).
- **D:** Documents box copy: prototype says "Receipts, tax statements, pledge confirmations and newsletters. Please choose one."; the app has en.ts:200. Digital sub: prototype says "Faster, and saves paper and postage for JSH."; the app has en.ts:202.
- **D:** The prototype radio cards have a 2px border and a saffron outline until chosen. The app draws the saffron border only in onboarding and uses plain `Radio`.
- Finish: "Choose documents and mail to finish" / "Finish" matches (en.ts:205-206).

**Step 6, Done**
- **D:** Everything is centred in the prototype (88px ✓ circle, Fraunces 28). The app is left-aligned with a 72px circle (done.tsx:43-47).
- **D:** "✓ 4 family members confirmed" in the prototype vs "Family members confirmed: {n}" (en.ts:216).
- The title and lines otherwise match.

## 9. Selection controls (all screens)
The prototype's unselected chips have a **navy border with navy text** and are laid out in 2- or 3-column grids for fixed sets (channels, times, languages, text size). The app's `Chip` (`ui.tsx:311-338`) has a beige border, ink2 text, a checkmark when selected, and always wraps. Interest chips in the prototype use a brown border and brownTint fill. P3, but it affects every form above.

---

## 10. Welcome, the "New to JSH" guide (`Welcome.dc.html`)
App routes: `(app)/guide/index.tsx`, `[slug].tsx`, `zones.tsx`, `whatsapp.tsx`, `ask.tsx`.

| Screen | Prototype | App | Status |
|---|---|---|---|
| Hub title | "New to JSH" | "Guide" (en.ts:820) | D |
| Hero | "Jai Jinendra and welcome" / "Everything you need to get connected with JSH" / "New families start here…" / **"Your first steps · N of 5 done" with a progress bar** | Title plus one body line (en.ts:821-822); no progress | D / M |
| First-steps checklist | 5 rows with ticks: Join WhatsApp groups, Find your zone and zone lead, Learn about membership, Share your seva interests, Ask us anything | — | M |
| Explore tiles | 2-column grid of 9 tiles with coloured marks | "Get connected" list of 3 (Zone, WhatsApp, Ask) plus "Explore" list of `guide_sections` markdown pages | D |
| Timings and visiting | 7 timing rows, address card, **Directions**, **Call the office** | Only if authored as markdown; no buttons | M |
| Website and links | 6 link rows | markdown only | M |
| Volunteer (seva) | 8 group checkboxes, "When can you help?" (3 chips), "Send interest in N groups", thank-you state with "Update my interests" | — (`volunteer_groups` and `volunteer_interests` in 0004 are unused) | M |
| Administration | Executive Committee / Trustees tabs, role rows, "Message" opens a compose sheet | — | M |
| Membership | 3 type cards with fees, "Good to know", "Become a member" | — (`membership_types` in 0002 is unused) | M |
| Registrations | 6 rows with Open / Opens Jan / Closed badges | — | M |
| WhatsApp | Intro starts "JSH shares news, timings and event updates on WhatsApp.…"; "Adding: (713) 555-0142 · Change number"; per group "Request to join" or "Requested ✓"; the zone group redirects to Zone if no zone is set | Intro is missing its first sentence (en.ts:848); groups come from the database; status text replaces the button | D |
| Your zone | Intro "Greater Houston…"; ZIP input and button **inline**; zone card with areas, "about N JSH families", **zone lead row** ("replies within a day"), **Message lead** (bottom-sheet compose) and **Join zone WhatsApp**; "All zones" rows show **areas** | Generic intro (en.ts:835); full-width button; green card with the message box inline; no lead row and no Join-zone button; the all-zones list shows **ZIP codes** (zones.tsx:92); "not found" shows a banner (the prototype silently falls back to Central, and the app's approach is better) | D |
| Ask a question | Intro ends "For quick answers, try Niva in the app."; fixed topics; checkbox "Reply by WhatsApp as well as email"; sent state "Question sent · Q-3021" with "…can follow it under Help and requests" | Topics come from inboxes; **no WhatsApp-reply checkbox**; no reference number; adds a "Your questions" list (X) | D / M |
| Back at hub | Returns to the app | Stack back | Match |

---

## 11. Volunteer check-in (`Volunteer.dc.html`)
**Click path:** drawer › Volunteer mode (app only). **App route:** `src/app/(app)/volunteer.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Theme | **Dark** full screen (#16140F, gold #D7A15F) | Light standard screen | D |
| Header | "Exit" pill, "VOLUNTEER MODE" eyebrow plus event name, **counter "212 of 340 RSVP'd"** | Generic header "Volunteer mode"; event name as a headline; no counter | D / M |
| Stations | Dark 3-segment control: Entry / Food / Gifts | "STATION" title plus chips | D |
| Scanner | 360px viewfinder with gold frame and red scan line, hint "Point at a ticket or member card · {Station} station" | `QrScanner` component | D (P3) |
| Walk-in by phone | Opens "Find a family" (Mobile number, "Find family", "Back to scanner", guest note) | — (`app.checkin_lookup_phone` in 0017 exists and is unused) | **M** |
| Kiosk mode | Button | — | M |
| Footer | "Uses phone camera or a paired scanner · keeps working offline and syncs later" | —; offline queueing (`p_offline`) is not built | M |
| **Result: confirm who is here** | "VALID TICKET · ENTRY", "Welcome, Shah family", "Life members · confirm who is here", **per-person checkboxes** with notes ("RSVP'd · senior seating requested", "Not on RSVP · add as walk-in"), then "Check in N people" / "Serve food to N people" / "Give gifts to N people", then Cancel; the count goes up and a toast "✓ 3 done · Shah family" appears | **Scanning checks the whole family in immediately** (`checkIn` passes no `p_attendee_ids` and does not use station `'lookup'`, `lib/api/volunteer.ts:39-47`). The result card lists names with pills; buttons are "Scan next" and "Check in" (manual entry) | **D (P1)** |
| Manual code entry | — | "Ticket or member code" field | X (useful on web) |

---

## 12. Brand strings ("Connect" should become "Community Connect"; JSH stays the community)

| Where | Current | Proposed |
|---|---|---|
| `app.json:3` `expo.name` | "Connect" | "Community Connect" |
| `app.json:4` slug / `package.json:2` | "connect-mobile" | Keep, or "community-connect" (the slug changes the EAS project) |
| `app.json:8` scheme | "connect" | "communityconnect" (update deep links) |
| `app.json:14,18` bundle and package id | `org.connectplatform.member` | Decide before the first store build |
| `app.json:51` camera permission | "Allow Connect to use the camera…" | "Allow Community Connect…" |
| `app.json:58` Face ID permission | "Allow Connect to use Face ID…" | same fix |
| Web title (`dist/index.html` `<title>Connect</title>`, from `expo.name`) | "Connect" | follows `expo.name` |
| Icon `assets/images/icon.png`, `assets/expo.icon`, android-icon-* | **Default Expo template icon** | Community Connect icon |
| Splash `assets/images/splash-icon.png` | Blank white glyph on cream (effectively invisible) | Brand mark |
| en.ts:66 `drawer.version` | "Connect · version {version}" | "Community Connect · version …" (prototype: "JSH app · version 1.0.0") |
| en.ts:82 `setup.title` | "Connect is not configured yet" | brand |
| en.ts:90 `lock.body` | "Connect is locked…" | brand |
| en.ts:543 `bolis.reminderUnavailable` | "…in the Connect app…" | brand |
| en.ts:769 `settings.biometricSub` | "Unlock Connect with…" | brand |
| en.ts:800 `settings.aboutSub` | "Connect version {version}" | brand |
| en.ts:929 `scan.cameraDenied` | "Camera access is off for Connect…" | brand |
| `src/lib/biometrics.ts:38` | `Unlock Connect with ${label}` | brand |
| `src/lib/push.ts:29,35,40` | "…the Connect app build…", Android channel name "Connect", "…turned off for Connect…" | brand |
| `src/lib/api/family.ts:217` | "Sent from the Connect member app." | "Sent from the Community Connect app." |
| `src/lib/rules.ts:201` (shown on Family rows, Profile, Card) | "Connect JSH-10421" | "Community Connect ID …", or drop the product name |
| `src/app/(app)/(tabs)/family.tsx:46` | "Connect {household_number}" | same fix |
| Prototype-only strings to **not** copy as product brand | "JSH member app" (Main `<title>`), "JSH app" (menu footer), "Rules for using the JSH app" | The app should say "Community Connect". Community-meaning uses such as "Contact JSH", "JSH guide" and "Saved to JSH record" should use `center.short_name` |

Comment-only mentions with no user impact: theme.ts:2, member-card.tsx:17, volunteer.tsx:101, home.tsx:81, env.ts:10, providers/app.tsx:32-34.

---

## 13. Prioritized fix list

### P1: broken or missing flows
1. **Birthday labh screen plus "Plan labh".** Add `src/app/(app)/labh/[dayId].tsx`, a button in `special-days.tsx` (rows within the reminder window), and the pledge + pay path via `lib/api/giving.ts`; add strings to en.ts.
2. **Volunteer confirm-who-is-here step.**
   - Scan should first call `check_in(..., p_station:'lookup')`.
   - Show per-person checkboxes, then confirm with `p_attendee_ids`, using the "Check in / Serve food to / Give gifts to N people" labels.
   - Add a Cancel button, the "N of M RSVP'd" counter, and "Walk-in by phone" via `checkin_lookup_phone`.
   - Files: `src/app/(app)/volunteer.tsx`, `src/lib/api/volunteer.ts`, en.ts.
3. **Welcome guide sections and progress.**
   - Hub hero with "N of 5 done" and the checklist, plus the 9-tile Explore grid.
   - Native Volunteer interests section (`volunteer_groups` / `volunteer_interests`), Membership (`membership_types`), Administration with compose, Registrations, Timings/visiting with Directions and Call, Links.
   - Files: `src/app/(app)/guide/*`, new `lib/api/guide.ts` functions.
4. **Profile contact model.**
   - Phone call channel (`people.contact_channels`), Best time to call (`best_call_time`), multiple emails (`person_emails`), per-person notification switches.
   - Replace the embedded ContactPrefsForm with the prototype's single-save layout.
   - Files: `src/app/(app)/person/[id].tsx`, `features/onboarding/contact-prefs-form.tsx`, `features/onboarding/profile-fields.tsx`, `lib/api/family.ts`.
5. **Brand rename and real assets.** `app.json` (name, scheme, permission strings), `assets/images/*`, en.ts keys listed in §12, `lib/biometrics.ts`, `lib/push.ts`, `lib/rules.ts:201`, `lib/api/family.ts:217`, `(tabs)/family.tsx:46`.

### P2: wrong fields, copy or behaviour
6. Family tab row format ("Primary · Life member · ID"), filled Profile and outlined "QR" pill buttons, Special-days "See all ›" with "in N days", "Update family profile" going to full onboarding. Decide on the extra household hero card and preferences link. File: `(tabs)/family.tsx`.
7. Person: Relationship field, newcomer "reach me by" chips, expertise "Visible to", Interests card (`people.interests`), a single "Save changes" that becomes "✓ Saved to {center} record", sub-copy (en.ts:161,164,167). Remove First/Last/Employer from Profile if matching the prototype exactly.
8. Special days: occasions (add Birth tithi; decide on Diksha), "Whose special day?", remind labels in weeks, "in N days" line, "Turns N" sub, intro copy. File: `special-days.tsx`, `features/special-days.ts`, en.ts:713-753.
9. Settings: add Sign-in and security, Signed-in devices, Appearance, Location, Usage data, Saved payment methods, Help and FAQs, Report a problem; row subs; Notification topics should go to the Family tab; brown Deactivate and red Delete; an in-app Deactivated state with Reactivate instead of signing out; confirm and toast copy. Files: `settings.tsx`, `lib/api/settings.ts`, en.ts:764-813.
10. Member card: centred layout, "Refreshes every 30 seconds · works offline" backed by a real rotating token, active Wallet CTA. File: `member-card.tsx`, `components/qr.tsx`.
11. Onboarding copy and fields: single-screen sign-in with "Sign in", code label and m:ss resend; family-match relationship lines and button placement; Employer label; emails list; Relationship in step 4; Phone call and best time in step 5; "Interested in (helps us…)"; documents copy; centred Done with "N family members confirmed". Files: `(auth)/*`, `(onboarding)/*`, `features/onboarding/*`, en.ts:96-222.
12. Household add-member should write `household_change_requests`, not a thread. File: `lib/api/family.ts:202`.
13. Notification tap routing (special day to labh, and others). File: `src/providers/push.tsx`.
14. Drawer: labels (Pathshala Connect, My Donations, RSVP), logo, "Community dashboard" and "New to {center} guide and help" group, pinned Settings, footer. File: `components/drawer.tsx`, en.ts:44-66.
15. Guide Zone and WhatsApp: zone lead row, Join zone WhatsApp, areas and family counts (needs zone columns or metadata), zone-group redirect, intro copy; Ask needs the "Reply by WhatsApp" checkbox and a reference number.

### P3: visual polish
16. Header: bordered white round menu and back buttons, filled navy QR button, left-aligned title, centred logo header on Home. File: `components/screen.tsx`, `components/ui.tsx` (IconButton).
17. Tab bar: book icon for Jain Way, stroke-style icons, 12px labels; keep the tab bar on Card, Profile and Settings (move them into the tab stack or render the tab bar). Files: `(tabs)/_layout.tsx`, `(app)/_layout.tsx`.
18. Niva floating button and its menu (global).
19. Chips: navy border and text, no checkmark, grid layouts for fixed sets. File: `components/ui.tsx` Chip.
20. Volunteer dark theme and viewfinder styling; onboarding frame left-aligned step label and ink titles; Welcome step 0 centred logo image; legal one-card-per-section; navy QR.
21. Optional "Saving" progress screen for multi-step saves (labh, recurring, pledges).
