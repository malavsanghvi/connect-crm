# Modules

Each major subsystem is a **module** that an organization's admin can switch on or off
(Settings › Modules, `settings.manage`). This page lists, per module, the tables, RPCs, portal
routes, member-app screens and permissions that belong to it, and what switching it off does.

Schema: `supabase/migrations/0100`–`0104`. Tests: `supabase/tests/13_modules_audit_test.sql`.
Owner decision recorded in [DECISIONS.md](DECISIONS.md).

## How the switch works

| Piece | What it does |
|---|---|
| `app.modules` | The catalog: `key`, `label`, `description`, `core`, `depends_on`, `sort`. Readable by any signed-in user. |
| `app.center_modules` | One row per switch a center has flipped: `enabled`, `changed_by`, `changed_at`, `reason`. **No row means on**, so existing centers keep everything. Readable by members of the center; written only by `set_module_enabled`. Audited. |
| `app.module_tables` | Which module each app table belongs to. `NULL` = core platform (never switched off). A DB test fails if any app table is missing. |
| `app.module_enabled(center, key)` | `true` unless the center switched the module off. One primary-key probe. |
| `app.assert_module_enabled(center, key)` | Raises *"The {label} module is switched off for this community."* (hint: *An administrator can switch it on in Settings › Modules.*). Platform admins pass. |
| `app.set_module_enabled(center, key, enabled, reason)` | Needs `settings.manage` in that center (or platform admin) and a reason. Refuses to switch off a core module, a module that an enabled module depends on (the error names it), or to switch on a module whose dependency is off. The reason goes on the audit entry. |
| `app.my_modules(center)` | `(key, label, enabled, core)` for the apps; empty for someone who is not a member. |
| RLS `module_switch` | One **restrictive** policy per table of a switchable module (generated from `module_tables`): rows of a switched-off center are neither readable nor writable, except for platform admins. It is AND-ed with the existing policies, so it can only take access away. |
| RPC guards | Every security-definer RPC of a module calls `assert_module_enabled` once the center is known (listed per module below). |

Switching off never deletes or changes data. Switching back on restores access exactly as it was.
Background work that runs as `service_role` (webhooks, workers) bypasses RLS as before; the
Giving triggers keep posting a card payment that settles after Giving was switched off.

**Not guarded, on purpose:** RLS helper functions (`has_permission`, `is_member_of`,
`adult_of_household`, `can_see_event_ops`, `in_survey_audience`, …) — a raise inside a policy
would break unrelated reads; trigger functions — their tables are already gated; and the core
platform and People RPCs (`bootstrap_first_admin`, `approve_role_grant`, `next_number`,
`log_audit`, `link_account`, `create_my_household`, `find_my_family`, `directory_listing`,
`people_list`, `person_from_scan`, `resolve_identifier`, `household_card`,
`staff_household_search`, `staff_person_names`, `canonical_org_id`, `canonical_org_member`,
`next_special_day_on`).

## Traceability (every module)

Every app table except `audit_log` has an `audit_<table>` trigger on `app.audit_row()`. Each entry
records who (`actor_user_id`, `actor_role` from the JWT), when, what (`before`/`after`, masked by
`app.audit_mask`), the `module`, and — from the request headers — `correlation_id`
(`x-request-id`), `reason` (`x-audit-reason`, URL-decoded), `client_app` (`x-client-app`:
portal | member | kiosk | job), `client_screen` (`x-client-screen`), `user_agent` and `ip`
(first `x-forwarded-for`). RPCs and jobs set the same context with
`app.set_audit_context(reason, correlation)` or `set_config('app.audit_reason' | 'app.correlation_id' | 'app.client_app', …, true)`.
Rows that carry their own reason (write-off, refund, voting override, boli close, reference
decision, role grant, module switch) supply it when the request did not.

`record_id` is the row's `id`; for tables without one it is the primary key joined by `:`
(e.g. `household_members` → `<household_id>:<person_id>`, `accounts` → `<user_id>`).
`app.record_history(table, record_id)` returns one record's entries newest first with the actor's
name, to `audit.view` holders of that center and platform admins only (the same rows the
`audit_read` policy allows).

---

## People — Members & families (core: always on)

- **Tables:** households, people, household_members, zones, household_change_requests,
  merge_candidates, person_emails, external_ids, special_days
- **RPCs:** people_list, directory_listing, find_my_family, link_account, create_my_household,
  staff_add_person, move_person_household, make_primary_of_own_household, merge_people,
  merge_households, household_card, resolve_identifier, person_from_scan, staff_household_search,
  staff_person_names (not guarded: core)
- **Portal:** /households, /households/[id], /people, /people/[id], /people/directory, /people/merge
- **Member app:** Family tab, person/[id], family-review, special-days, member-card, onboarding
- **Permissions:** people.view, people.manage, people.approve
- **Switching off:** not possible. `merge_people` refuses while **Membership** is off, because the
  duplicate's memberships move with it and would be hidden from the merge. Merges record a default
  reason ("Merged duplicate … into …") unless the request sends one.

## Membership (depends on People)

- **Tables:** membership_types, memberships, membership_applications, eligibility_snapshots
- **RPCs guarded:** decide_reference, change_household_tier, my_reference_requests (filters
  instead of raising, it lists across centers), approve_as_second (for `eligibility_snapshots`)
- **Portal:** /memberships/applications, /people/voting
- **Member app:** guide/membership, reference requests, onboarding membership step
- **Permissions:** people.view, people.manage, people.approve, settings.manage (types)
- **Switching off:** membership rows, applications and voting eligibility are hidden and read-only
  to everyone but platform admins; tier changes, reference decisions and person merges refuse.
  Creating a household (`create_my_household`, `make_primary_of_own_household`) still works;
  the latter adds no community membership while the module is off.

## Events & RSVP (depends on People)

- **Tables:** event_templates, event_template_items, events, actions, rsvps, attendees,
  lunch_slots, scan_log
- **RPCs guarded:** submit_rsvp (also needs **Giving** when the RSVP carries a money commitment),
  cancel_rsvp, check_in, checkin_lookup_phone, create_event_from_template, ensure_lunch_slots,
  assign_lunch_for_rsvp, move_lunch_slot, event_live_stats, event_recent_checkins
- **Portal:** /events, /events/[id], /events/builder, /events/live, /events/feedback
- **Member app:** Events tab, event/[id], event/[id]/confirm, event/[id]/tickets
- **Permissions:** events.view, events.manage, events.confidential; scoped roles event_lead,
  checkin_volunteer, kitchen_lead
- **Switching off:** events, RSVPs, tickets and check-in are hidden and refuse; the kiosk cannot
  check anyone in.

## Pledges & donations — Giving (depends on People)

- **Tables:** funds, campaigns, opportunities, pledges, payments, payment_allocations,
  recurring_gifts, statements, counting_sessions, valuables_register, bank_accounts,
  bank_statement_imports, bank_transactions, known_originators, receipt_templates, labh_options,
  labh_fulfillments
- **RPCs guarded:** record_offline_payment, allocate_payment, preview_allocation,
  confirm_bank_match, match_deposit, suggest_bank_matches, suggest_deposit_payments,
  commit_labh, create_recurring_gift, opportunity_availability, approve_as_second (payments,
  pledges), enqueue_payment_posting and recompute_pledge_status (when called directly; not from
  the Giving triggers)
- **Portal:** /giving/pledges, /giving/payments, /giving/payments/bank, /giving/bank,
  /giving/opportunities, /giving/campaigns, /giving/recurring, /giving/labh, /giving/statements
- **Member app:** Give tab, pledges, recurring, recurring-setup, opportunity/[id], labh/[dayId]
- **Permissions:** giving.view, giving.manage, giving.approve, giving.record_offline
- **Switching off:** refused while Bolis or Accounting is on. Money data is hidden and frozen for
  everyone but platform admins; recording, matching, labh and recurring set-up refuse. The People
  household card (`household_card`) keeps identifying the household but returns no open-pledge total
  or last-gift date (0110), and the household page drops Record payment and its Pledges/Payments tabs.
  The member app hides "Plan labh". Money rules (allocation, write-off, refunds) are unchanged.

## Bolis (depends on Giving)

- **Tables:** bolis, boli_entries
- **RPCs guarded:** place_boli_entry, close_boli (its reason goes on every row it changes),
  boli_summary, boli_minimum
- **Portal:** /bolis, /bolis/upload
- **Member app:** bolis, boli/[id]
- **Permissions:** bolis.view, bolis.record, bolis.manage
- **Switching off:** bolis are hidden; pledging and closing refuse.

## Satvik Store (depends on People)

- **Tables:** store_categories, store_items, pickup_windows, store_orders, store_order_lines,
  inventory_movements
- **RPCs guarded:** none (the store writes through RLS; `apply_inventory_movement` is a trigger)
- **Portal:** /store, /store/menu, /store/orders
- **Member app:** store, cart
- **Permissions:** store.view, store.manage, store.pickup
- **Switching off:** items, orders and inventory are hidden and read-only.

## Pathshala (depends on People)

- **Tables:** pathshala_terms, pathshala_tracks, pathshala_levels, pathshala_classes,
  pathshala_teachers, pathshala_enrollments, pathshala_sessions, pathshala_attendance,
  pathshala_progress_reports, class_announcements, teacher_positions, teacher_applications
- **RPCs guarded:** pathshala_term_stats, redeem_attendance_qr
- **Portal:** /pathshala, /pathshala/classes, /pathshala/terms, /pathshala/enrollments,
  /pathshala/announcements, /pathshala/my-classes, /pathshala/committee/*
- **Member app:** pathshala-scan
- **Permissions:** pathshala.view, pathshala.manage, pathshala.teach
- **Switching off:** classes, enrollments and attendance are hidden; QR attendance refuses.

## Gyan Path — learning (no dependency)

- **Tables:** gyan_goals, gyan_levels, gyan_steps (no center_id: gated through their goal),
  gyan_progress, gyan_signoffs
- **RPCs guarded:** none (progress and sign-offs are written through RLS; points are awarded by
  triggers)
- **Portal:** /content/gyan-path, /pathshala/signoffs
- **Member app:** gyan, gyan/[goalId], gyan/[goalId]/level/[levelId]
- **Permissions:** content.manage (curriculum), pathshala.teach (sign-offs)
- **Switching off:** the center's goals, levels, steps, progress and sign-offs are hidden. Goals
  shared by every center (no center) stay readable.

## My Jain Way (no dependency)

- **Tables:** practices, practice_selections, practice_logs, points_ledger, streaks,
  saathi_settings, anumodana, daily_timings
- **RPCs guarded:** log_practice, unlog_practice, my_practice_standing, saathi_feed, send_anumodana
- **Portal:** /content/practices, /content/today
- **Member app:** Jain Way tab, pachchakhan/[id], guide/timings
- **Permissions:** content.manage (practices, timings); members act for themselves and their children
- **Switching off:** the center's practices, logs, streaks and points are hidden; logging refuses.
  Practices shared by every center (no center) stay readable.

## Content & library (no dependency)

- **Tables:** content_items, photo_albums, photos, guide_sections, role_roster
- **RPCs guarded:** none (content is written through RLS)
- **Portal:** /content/queue, /content/library, /content/photos, /content/guide, /content/today
- **Member app:** guide, guide/[slug], album/[id]
- **Permissions:** content.view, content.draft, content.manage, content.approve, settings.manage (roster)
- **Switching off:** refused while Niva is on. Library, guide, roster and photos are hidden.
  `legal_documents` stays readable: it backs the consent flow, which is core platform.

## Calendar (no dependency)

- **Tables:** calendar_layers, calendar_entries, tithi_days
- **RPCs guarded:** none
- **Portal:** /calendar
- **Member app:** the calendar on Home and Jain Way (tithi); tithi dates on special days
- **Permissions:** content.manage
- **Switching off:** calendar layers, entries and tithi days are hidden.

## Communications (depends on People)

- **Tables:** notification_topics (global catalog, nothing to switch), notification_preferences,
  channel_optins, push_devices, message_templates, messages, comms_campaigns, inboxes, threads,
  thread_messages, whatsapp_groups, whatsapp_join_requests, alerts
- **RPCs guarded:** segment_recipient_count, approve_as_second (comms_campaigns)
- **Portal:** /comms/newsletters, /comms/campaigns/[id], /comms/inbox, /comms/threads/[id],
  /comms/whatsapp, /comms/alerts
- **Member app:** preferences, guide/whatsapp
- **Permissions:** comms.view, comms.send, comms.approve, comms.inbox
- **Switching off:** campaigns, inbox, WhatsApp and messages are hidden; a member cannot register a
  push device or change notification preferences. Notification workers (service role) are not
  blocked by RLS; they should read `module_enabled` before sending.

## Surveys & data (no dependency)

- **Tables:** surveys, survey_responses, saved_segments
- **RPCs guarded:** none (`in_survey_audience` is an RLS helper)
- **Portal:** /comms/surveys, /comms/surveys/[id], /events/feedback/[surveyId]
- **Member app:** survey/[id]
- **Permissions:** comms.view, comms.send
- **Switching off:** surveys, responses and saved segments are hidden.

## Volunteers (depends on People)

- **Tables:** volunteer_groups, volunteer_shifts, volunteer_assignments, volunteer_interests,
  background_checks
- **RPCs guarded:** none
- **Portal:** /events/volunteers
- **Member app:** volunteer, guide/volunteer
- **Permissions:** volunteers.view, volunteers.manage, safety.view, safety.manage
- **Switching off:** groups, shifts, sign-ups and background checks are hidden.

## Accounting & QuickBooks (depends on Giving)

- **Tables:** qbo_account_mappings, ledger_postings, accounting_periods, payouts, sync_log
- **RPCs guarded:** none of its own. Ledger postings are still queued by the Giving flows
  (`confirm_bank_match`, `match_deposit`, the payments trigger), so switching Accounting back on
  loses nothing.
- **Portal:** /accounting/qbo, /accounting/close
- **Member app:** none
- **Permissions:** accounting.manage, accounting.close, giving.view
- **Switching off:** mappings, postings, periods, payouts and the sync log are hidden and
  read-only; month-end close is unavailable.

## Reports & dashboard (no dependency)

- **Tables:** public_kpi_settings
- **RPCs guarded:** public_kpis (also for anonymous visitors), kpi_flows, public_kpi_catalog
- **Portal:** /reports, /reports/community
- **Member app:** Home dashboard cards
- **Permissions:** reports.view, settings.manage (publishing KPIs)
- **Switching off:** center health and the publish list show the switched-off page; the public
  `/c/<slug>` page says the community isn't publishing its dashboard; `public_kpis` refuses.

## Niva assistant (depends on Content)

- **Tables:** niva_conversations
- **RPCs guarded:** none
- **Portal:** /content/niva
- **Member app:** niva, guide/ask
- **Permissions:** content.manage
- **Switching off:** conversations are hidden.

## Governance (depends on People)

- **Tables:** resolutions, resolution_votes, resolution_comments, concerns
- **RPCs guarded:** none
- **Portal:** /pathshala/committee/resolutions, /pathshala/committee/concerns
- **Member app:** none
- **Permissions:** governance.view, governance.manage, governance.vote, pathshala.view/manage (concerns)
- **Switching off:** resolutions, votes, comments and concerns are hidden.

## Core platform (not a module)

centers, roles, role_grants, center_users, accounts, consents, audit_log, legal_documents,
data_requests, import_runs, integration_connections, webhook_events, number_sequences, modules,
center_modules, module_tables. Always on, audited, `module` is NULL on their audit entries.
