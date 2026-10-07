# Center rules (`app.centers.rules`)

`centers.rules` is each center's rule bag (JSON). The portal edits it in **Settings**:
Rules, Onboarding fields, Notifications, Security and Member app (Home shortcuts) each save
only the keys they show, merged into the bag. **Settings › Rules › Advanced** edits the whole
bag as JSON.

- Reading and defaults: `src/lib/settings-rules.ts` (`readRuleSettings`, `RULE_DEFAULTS`, …).
- Type and range checks for every known key: `RULE_CHECKS` in `src/lib/center-rules.ts`.
  Unknown keys are allowed (centers extend the bag).
- Writing: `src/lib/data/center-rules-write.ts`. Every save bumps `version` and only goes
  through when the rules are still on the version the form was opened on, so two admins never
  overwrite each other silently. The `centers` audit trigger records before/after; since
  migration 0080 those entries belong to the center, so its own audit viewers see them.
- `centers` is readable by anyone (center picker, guest pages). **Never put personal data or
  secrets in the rule bag.**

## Keys shown in Settings

"Existing key" means it was in the bag before this work; whether each app reads it is up to
that app. Keys marked **new** are not read by any app yet — they record the center's choice
so the member app, sender and sign-in service can adopt them.

| Key | Default | Settings screen | Notes |
|---|---|---|---|
| `version` | none (1 after the first save) | every save | "Rules saved · version N" |
| `child_login_age` | 13 | Rules › Membership | existing key |
| `membership.reference_expiry_days` | 14 | Rules (read-only) | existing key |
| `membership.life_references_required` | 1 | Rules › Membership | **new**: recorded for reviewers; not enforced yet |
| `membership.life_prior_yearly_months` | 0 | Rules › Membership | **new**: recorded for reviewers; not enforced yet |
| `fees.ask_donor_to_cover` | true | Rules › Giving | existing key |
| `boli.soft_close_minutes` | 0 (toggle: 0 or 5) | Rules › Giving | existing key |
| `boli.step_cents` | 2100 | Rules › Bolis and store | existing key |
| `store.gift_pack_cents` | 299 | Rules › Bolis and store | existing key |
| `store.cancel_hours_before_pickup` | 24 | Rules › Bolis and store | existing key |
| `lunch.slot_minutes` | 15 | Rules › Lunch and RSVP | existing key |
| `lunch.family_with_child_under_12_at_start` | true | Rules › Lunch and RSVP | existing key |
| `lunch.senior_at_start` | true | Rules › Lunch and RSVP | existing key |
| `lunch.reminder_minutes_before` | 5 | Rules › Lunch and RSVP | existing key, **read by the database** (0596, `app._lunch_reminder`): the lunch reminder push goes this many minutes before the member's slot; 0 = no reminder. A whole number from 0 to 120 (more counts as 120; a negative number, a fraction or text reads as 5) |
| `rsvp.confirmation_hours_before` | 24 | Rules › Lunch and RSVP | existing key |
| `points.day_complete_bonus` / `anumodana_points` / `anumodana_daily_cap` / `support_points` | 20 / 5 / 5 / 3 | Rules › Points | existing key |
| `points.streak_rest_days_per_month` | 1 | Rules › Points | **new**: member app streaks (not read yet) |
| `points.behind_after_days` | 3 | Rules › Points | **new**: Saathi "behind" (not read yet) |
| `points.gyan_practice_daily_cap` | 10 | Rules › Points | **new** (0570), **read by the database**: `app.record_gyan_attempt` pays a Gyan Path step's `repeat_points` for each successful practice try while the member's successful tries of that step today (the community's local day, `centers.time_zone`) are below this number; 0 switches try points off. Whole number 0–1000 (a value stored some other way is read the same way: not a number = 10, below 0 = 0, a fraction = its whole part, above 1000 = 1000; Content › Gyan Path describes the cap the same way). The database keeps at most 200 tries per member, step and day, or twice this number when it is above 100, so every try it pays for is kept |
| `onboarding.fields.<field>` | see below | Onboarding fields | **new**: member app onboarding (not read yet) |
| `notifications.quiet_start_hour` / `quiet_end_hour` | 21 / 7 | Notifications | **read by the database** (`app.messaging_quiet_until`, 0221): a notification, campaign or receipt by text, push or WhatsApp that is due in quiet hours waits until they end (0596: judged at the time it is due, not when it is queued) |
| `notifications.event_day_during_quiet_hours` | true | Notifications | **read by the database** (0221): true = an event-day message (the lunch reminder and, owner decision 2026-10-07, the boli "another family pledged more" notice) is not held by quiet hours. False: they wait like the rest, and one that could only go after its slot starts or its boli closes is not queued (0596; the audit log says why) |
| `notifications.triggers.<trigger>` | true | Notifications | **Read by the database:** `homework_reminder` (0588): `false` means `app.worker_homework_reminders_sweep` sends this community no homework reminder and its next run cancels those still waiting to go out; `lunch_reminder`, `boli_outbid` and `event_feedback` (0596, `app._member_push`): `false` = that push is not queued. Anything else, or no key, is on. The other keys record a choice for a sender that is not built yet (BACKLOG B48) |
| `security.printed_signin_codes` | true | Security | **new**: policy only, not enforced yet |
| `security.admin_session_hours` / `admin_idle_minutes` | 8 / 30 | Security | **new**: policy only; the sign-in service keeps its own session length |
| `onboarding.wizard_step` | — | Platform › New center | **new**: next wizard step while a center is onboarding |
| `onboarding.import_source` | — | Platform › New center | **new**: neon / salesforce / bloomerang / spreadsheet |
| `home.shortcuts` | absent = all six: `["learn","playlist","photos","recipe","podcast","guide"]` | Member app › Home shortcuts | **new**: the member app's Home strip, in order (below) |

`home.shortcuts` is the ordered list of round shortcuts the member app shows on Home, under the
"Today at {center}" card: `learn` (the member's next Gyan Path lesson), `playlist` (plays My
playlist, or the most-liked stavans when it is empty), `photos` (Events › Photos), `recipe` (a
random fully Jain recipe), `podcast` (a random podcast) and `guide` (the welcome guide, "New to {community}? Start here"; always available, no module). Key absent → all six in that order;
`[]` → no strip; unknown keys are ignored when read. The card stores only the shortcuts switched
on; a save refuses unknown or repeated names (`RULE_CHECKS`, `list` check). A shortcut whose
module is switched off is hidden in the app whatever is stored (`learn` → gyan_path; `playlist`, `photos`, `recipe`, `podcast` →
content; `guide` has none), and the card says so. A community that saved its own list before `guide` existed sees it as a switched-off row to turn on. Helpers: `src/lib/home-shortcuts.ts`.

`onboarding.fields` keys: `name_relationship`, `date_of_birth`, `mobile_emails` (default
required); `gender`, `profession`, `employer`, `contact_channels`, `language`, `interests`
(default optional). Values: `required`, `optional`, `hidden`. Directory listing, photo consent
and physical mail are always asked and are not stored.

`notifications.triggers` keys: `rsvp_confirmation`, `lunch_reminder`, `special_day_labh`,
`family_celebration`, `saathi_support`, `boli_outbid`, `giving_opportunity`,
`pledge_reminder`, `store_order_ready`, `event_feedback`, `pachchakhan_reminder`,
`homework_reminder` ("Homework due-soon reminders", 0588: the first switch here that is actually read by the
database. Each homework sets its own hours before the due date, or none; with this switch off the community
gets no homework reminder at all).

Keys without a form (voting, identifiers, bank, accounting, `rsvp.nudge_hour_local`,
`membership.reference_required`, …) are edited in Settings › Rules › Advanced.
