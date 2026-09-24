# Center rules (`app.centers.rules`)

`centers.rules` is each center's rule bag (JSON). The portal edits it in **Settings**:
Rules, Onboarding fields, Notifications and Security each save only the keys they show,
merged into the bag. **Settings › Rules › Advanced** edits the whole bag as JSON.

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
| `lunch.reminder_minutes_before` | 5 | Rules › Lunch and RSVP | existing key |
| `rsvp.confirmation_hours_before` | 24 | Rules › Lunch and RSVP | existing key |
| `points.day_complete_bonus` / `anumodana_points` / `anumodana_daily_cap` / `support_points` | 20 / 5 / 5 / 3 | Rules › Points | existing key |
| `points.streak_rest_days_per_month` | 1 | Rules › Points | **new**: member app streaks (not read yet) |
| `points.behind_after_days` | 3 | Rules › Points | **new**: Saathi "behind" (not read yet) |
| `onboarding.fields.<field>` | see below | Onboarding fields | **new**: member app onboarding (not read yet) |
| `notifications.quiet_start_hour` / `quiet_end_hour` | 21 / 7 | Notifications | **new**: automatic sender (not built yet) |
| `notifications.event_day_during_quiet_hours` | true | Notifications | **new**: automatic sender (not built yet) |
| `notifications.triggers.<trigger>` | true | Notifications | **new**: automatic sender (not built yet) |
| `security.printed_signin_codes` | true | Security | **new**: policy only, not enforced yet |
| `security.admin_session_hours` / `admin_idle_minutes` | 8 / 30 | Security | **new**: policy only; the sign-in service keeps its own session length |
| `onboarding.wizard_step` | — | Platform › New center | **new**: next wizard step while a center is onboarding |
| `onboarding.import_source` | — | Platform › New center | **new**: neon / salesforce / bloomerang / spreadsheet |

`onboarding.fields` keys: `name_relationship`, `date_of_birth`, `mobile_emails` (default
required); `gender`, `profession`, `employer`, `contact_channels`, `language`, `interests`
(default optional). Values: `required`, `optional`, `hidden`. Directory listing, photo consent
and physical mail are always asked and are not stored.

`notifications.triggers` keys: `rsvp_confirmation`, `lunch_reminder`, `special_day_labh`,
`family_celebration`, `saathi_support`, `boli_outbid`, `giving_opportunity`,
`pledge_reminder`, `store_order_ready`, `event_feedback`, `pachchakhan_reminder`.

Keys without a form (voting, identifiers, bank, accounting, `rsvp.nudge_hour_local`,
`membership.reference_required`, …) are edited in Settings › Rules › Advanced.
