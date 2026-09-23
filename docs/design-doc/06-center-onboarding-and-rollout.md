> Exported from the JSH Platform · Recommendations and Roadmap doc (claude.ai artifact 338356dc…) on 2026-09-23. Source of truth for decisions made before the build; later decisions live in ../DECISIONS.md.

# Center onboarding and rollout

A center goes from signed agreement to community launch in about 10–12 weeks: 6 weeks of readiness, 2 weeks of pilot, then a 4-week launch. Nothing reaches members until clean data and a working login are proven with a pilot group.

## Organization readiness

The single biggest risk is data: sign-in matches members by the email and phone in the CRM, so bad contact data means people can't log in.

| # | Step | Owner | Duration |
| --- | --- | --- | --- |
| 1 | Agreement, data-processing terms, fees | Center president, platform owner | Week 1 |
| 2 | Appoint center roles: admin, treasurer, communications officer, privacy officer, membership coordinator, religious coordinator | EC | Week 1 |
| 3 | Configure the center: branding, tradition pack, zones and ZIPs, school districts, fees, rules, feature flags | Center admin with platform onboarding lead | Weeks 1–3 |
| 4 | Connect CRM (or import), QuickBooks, and payments; payment account verification can take several days | Center admin, treasurer | Weeks 1–3 |
| 5 | Data cleanup: merge duplicate households, fix emails and mobile numbers, relationships, children's DOB, membership types | Membership coordinator | Weeks 2–5 |
| 6 | Content: timings, guide, zones and leads, administration roster, first events and giving opportunities | Content editor, office | Weeks 3–5 |
| 7 | Train admins and volunteers: portal, ops app, check-in rehearsal | Platform onboarding lead | Weeks 4–6 |
| 8 | Pilot: EC, volunteers and 30–50 champion families use it for 2 weeks, including one real event | Center admin | Weeks 7–8 |
| 9 | Go or no-go: login success rate, check-in rehearsal, finance sync verified in QuickBooks | EC, treasurer | End of week 8 |

## Community rollout sequence

Anchor the launch to a major event where the app is the easiest way in (RSVP, tickets, lunch time); announce three weeks ahead, fix contact data two weeks ahead, and switch off old channels on a fixed date.

| When | Message | From | Channels | Goal |
| --- | --- | --- | --- | --- |
| T–21 days | Why we are moving to one app, what it replaces, launch date, privacy promise | President | Email, WhatsApp announcements, stage announcement, website banner | Awareness and trust |
| T–14 days | "Check your details": personal message showing the email and mobile on file, with a link to correct them | Membership coordinator | Email and SMS to every household | Login-ready data |
| T–7 days | How to install and sign in in 2 minutes; 60-second video in English and Gujarati; help-desk times | Communications officer | WhatsApp zone groups, Pathshala parents, email | Installs before the event |
| T–0 (launch event) | RSVP and tickets only through the app or guest link; lunch times in the app; App Seva desks at the entrance | Event lead, volunteers | On site, stage, QR posters | Mass installs in person |
| T+3 days | Thank you, what's next (bolis, Jain Way, calendar), family invite reminder | President | Push, email | Second-session use |
| T+14 days | Personal nudge to households not yet signed in; offer a call or help at next Sunday | Zone leads | WhatsApp one-to-one, phone | Close the gap |
| T+30 days | Old apps and RSVP links retired; links redirect to the new app | Center admin | All channels | One channel for everything |

Every message links to the guest web pages too, so nobody is blocked if they don't install.

## Channels ranked

In-person help at a large event converts best; WhatsApp reaches the most people; email carries the official, detailed message.

| Rank | Channel | Why it works | Best for |
| --- | --- | --- | --- |
| 1 | In-person App Seva desks at a big event | Volunteers install and sign in with the member on the spot | Seniors, less tech-comfortable members |
| 2 | WhatsApp announcements and zone groups | Where the community already reads news daily | Reminders, install links, short videos |
| 3 | Pathshala parents and students | Children motivate parents; class-by-class completion is visible | Young families |
| 4 | Stage announcements (pravachan, aarti, events) | Trusted voice, captive audience | Awareness, urgency |
| 5 | Email from the president | Official and detailed; links to FAQ and privacy | Trust, the data-check step |
| 6 | SMS | High open rates, good for the data-check link | Households without email |
| 7 | Zone lead one-to-one follow-up | Personal, catches stragglers | The last 20–30% |
| 8 | Posters with QR codes, website banner | Always visible at the derasar | Walk-ins, guests |

## Tactics to onboard the most people fastest

Make the app the easiest path to something people already want, remove every login obstacle, and let families pull each other in.

- **A reason to install on day one:** RSVP, tickets and lunch times for the launch event live in the app; the first boli or sponsorship opens the same week.
- **One adult per household is enough to start:** the first adult who signs in sees the whole family and invites the others with one tap.
- **Pre-verified logins:** because the data check ran two weeks earlier, sign-in is a code to a known email or phone, with no forms.
- **Youth App Ambassadors:** YJA and Pathshala students staff help desks and earn volunteer hours and JSH points.
- **Seniors first, in person:** a dedicated desk and large-text mode; family members can set up a senior's phone.
- **Welcome bonus and recognition:** welcome points, a "first families" badge, and zone-by-zone progress announced from the stage.
- **Pathshala class challenge:** the class with the most families signed in by T+14 gets recognized.
- **Short, bilingual help:** 60-second videos and one-page guides in English and Gujarati; a help line during launch weeks.
- **Retire old channels on a date:** after T+30 the old app and RSVP links redirect, so there is only one place to go.
- **Guest pages as the safety net:** nobody is ever blocked from RSVP or giving for not installing.

## Adoption targets and tracking

Suggested targets, measured by household rather than by person, reviewed weekly by the EC on the adoption dashboard.

| Milestone | Households signed in | Other signals |
| --- | --- | --- |
| End of pilot | Champions: 90% | Login success above 95%; check-in rehearsal under 10 seconds per family |
| Launch event | 40% | Most RSVPs for the event made in the app |
| T+30 days | 60% | Old channels retired; weekly active households tracked |
| T+90 days | 80% | Giving and RSVPs mostly through the app; zone leads' non-adopter lists under 20% |

The adoption dashboard shows sign-ins by zone, age band and membership type, plus a non-adopter list per zone lead with contact preferences.
