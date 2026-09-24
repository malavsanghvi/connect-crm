# Parity audit: the Learn tab ("Jain Way") and Gyan Path

**Scope.** I compared prototype `Main.dc.html` (`tab:'learn'` with its 4 sub-tabs, plus `view:'pach'`, `view:'niva'`, the Niva FAB and the family-circle push) and `GyanPath.dc.html` (4 screens: goals, map, lesson, done) against `/home/user/connect-mobile`.

- Hall, album and special days/calendar are in the Give, Events and Family tabs. I only cover them where the Learn tab links to them.
- This audit comes from reading the code line by line. I did not run Playwright or take screenshots.
- Nothing was edited.

**Headline.** The app's Jain Way shell matches the prototype: same 4 sub-tabs, same titles, and a working points/streak backend.
- **Missing whole screens and flows:** the Niva chat is a "coming soon" placeholder and the Niva FAB doesn't exist. There is no Gyan Path goals screen, no Duolingo-style map, no one-step-at-a-time lesson and no level-complete celebration screen.
- **Missing cards:** the Saathi celebration and "Be Dev's Saathi" cards, "Your standing this month", and "Remind me today" on pachchakhan.

---

## 1. My Jain Way shell
Prototype: tab bar → **Jain Way** (`goLearn`, Main:2216). Title map `learn:'My Jain Way'` (Main:1908). App: `src/app/(app)/(tabs)/jain-way.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Tab-bar label | "Jain Way" (Main:1325) | `tab.jainWay` 'Jain Way' (en.ts:36) | MATCH |
| Header title | "My Jain Way", left-aligned, Fraunces 22 (Main:36) | `jw.title`, **centered** (`components/screen.tsx:59-64`) | DIFFERS (layout, all screens) |
| Header left/right | Menu button (`showMenuBtn`); QR opens member card | menu + `qr-code-outline` (screen.tsx:58,71) | MATCH |
| Sub-tabs | Today · Learn · Saathi · Library, 4-col grid on #F6EFE3, **sticky** (`position: sticky`, Main:569) | `Segmented` (jain-way.tsx:25-35), inside the ScrollView, **not sticky** | DIFFERS |
| Red dot on Saathi | `dot: i===2 && (!helpDone \|\| anuSent<2)` (Main:1934) | `Segmented` supports `badge` (ui.tsx:361), but jain-way.tsx never passes it | MISSING |
| Default pane | Today (`jwTab:0`) | today, or library for guests (jain-way.tsx:20) | MATCH, plus EXTRA guest mode |
| Signed-out state | n/a | sign-in card + Library only (jain-way.tsx:36-45) | EXTRA-IN-APP (fine) |
| Niva FAB | saffron "Niva" pill, bottom-right at 92px; opens a 290px card ("Ask JSH Niva", "Timings, events, bolis, membership and practices", 3 question chips, **Open chat**); visibility rules at Main:2208 | nothing; Niva is reachable only from drawer "Ask Niva — Assistant — coming soon" (drawer.tsx:89, en.ts:58-59) | **MISSING** |
| Family-circle push (lock screen) | "JSH · Family circle": "Anya finished Learn Navkar Mantra!" / "Dev could use your support"; tap opens the Saathi tab; action "Send anumodana · +5 points" (Main:1445-1466, 1951-1960) | no notification-response routing (`push.ts` only registers tokens; no `NotificationResponse` handler in src) | MISSING |

## 2. Today pane (`jwTab 0`, or `view:'myway'`)
App: `TodayPane`, `src/features/jain-way.tsx:32-206`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Hero card eyebrow | "Today · Bhadarva sud 11" | `jw.todayTithi` + `tithiLabel` (jain-way.tsx:91) | MATCH |
| Big number | "{done} of {n} done" | `home.doneOf` (l.95) | MATCH |
| Points label | "**JSH points**" (Main:580) | `jw.points` "Points" (en.ts:580) | DIFFERS: should be tenant-named, e.g. "{center short_name} points" |
| Points value / "+N today" | 1,240 base + today's points + 20 day bonus + 5 per anumodana + 3 per support | `pointsTotal` / `jw.pointsToday` (l.102-106) | MATCH (real ledger) |
| Progress bar | 6px green on #33467A | `ProgressBar` (l.109) | MATCH |
| Streak row | Inside an inner panel (#26396E, radius 14); 30px flame; "11-day streak"; sub "Finish today's practices to make it 12 days" or "Best streak: 21 days · keep going tomorrow" | Plain row with no inner panel, **20px** flame (l.110-120); copy matches; EXTRA "start a streak" copy | DIFFERS (look) |
| Week strip | Letter **under** the circle. Done = saffron #F2A03D fill with "✓". Today = white fill, saffron ring, "·" | Letter **above** the circle; done = **green** fill + checkmark; partial = navyPanel; **today is not marked** (l.121-131) | DIFFERS |
| Day-complete banner | "Day complete · anumodana!" / "Streak extended to {n} days · **+20 completion bonus**" | `jw.dayCompleteBody` "…· completion bonus added." (en.ts:589) | DIFFERS (amount missing) |
| "Your standing this month" card | Title plus "Private to you". Per category: "Top {x}%" with a bar (green when ≤20%, else amber) and "{n} practices in your Jain Way · {k} done today / none done yet today" (Main:602-612, 2203) | none | **MISSING**. Needs a percentile query over the points ledger or practice logs by category. |
| Reminder note | "Reminders arrive 10 minutes before each practice." shown **above** the list (Main:613) | `jw.remindersNote` "Your practice data is private to you (and parents for children)." shown at the **bottom** (l.198-200, en.ts:602) | DIFFERS |
| Practice rows | **One card per practice**. 44px outlined green circle that **toggles** done/undone; name (grey when done); "**{time} · {category}**" (e.g. "6:45 AM · Mantra & jaap"); "+N" chip, amber (#FBEBD7) turning green; **bell icon**; sorted by time of day | One card with dividers. 32px circle. Tapping marks done and **cannot un-tick** (`disabled={isDone}`, l.148-149). Sub = "{min} min · Tapa" (`practiceSub`, l.24-26; raw category key capitalised). Pill "+N". No bell. Order = `sort_order` | DIFFERS. Time of day and category labels are missing; the schema has no scheduled time and categories are `ahimsa/tapa/swadhyay/seva/bhakti`, not the prototype's 5 labels (migrations/0007:125-136). |
| Tick feedback | No toast; a +20 bonus when the whole day is done | Toast "+N points · anumodana!" or "Day complete · +N points · N-day streak" (l.57) | EXTRA-IN-APP (acceptable) |
| Add/remove button | Dashed button "**+ Add or remove practices**" / "Done adding" **below the practice list**; the catalog opens **under** the list, which stays visible | "Add or remove practices" (no "+"; icon instead), secondary style, not dashed. Editing **hides the practice list** (l.140, 173-197) | DIFFERS |
| Catalog rows | No header. "{cat} · {pts} points · {time}"; button "Add" (white/navy) or "Added" (navy fill) | Header "Practices"; "{min} min · Cat · +N"; "Added" in **green** | DIFFERS |
| Empty state | n/a | "Choose your practices" (l.138) | EXTRA (fine) |

## 3. Learn pane (`jwTab 1`)
App: `LearnPane`, jain-way.tsx:212-335.

| Element | Prototype | App | Status |
|---|---|---|---|
| Gyan Path entry | **One navy hero card**: saffron "5" tile with a shadow; eyebrow "GYAN PATH · LEVEL 5 OF 12"; title "Learn Samayik · Iriyavahiyam sutra" (goal · current level); "Continue your path · 10 min today"; "›". Opens the **Gyan Path goals screen** (Main:637-642) | SectionTitle "Gyan Path" followed by **one white card per goal** (purple number tile, goal name, "Level X of N", progress bar), each going straight to that goal's map (l.232-262) | DIFFERS. There is no "continue" hero and no goals screen (see §7). |
| "Learning with family" | Lives on the Gyan Path goals screen (GyanPath) | Inline in the Learn pane, children only, "Name · Goal · Level x of n" or "Not started yet" (l.263-278) | DIFFERS (placement) |
| Pathshala heading | "Pathshala" | `learn.pathshala` | MATCH |
| Enrollment row | "Dev · Level 3", with "**Enrolled**" green and right-aligned; "Sundays 10:00 AM · attendance by QR at class"; "Anya · Level 1 · **Complete enrollment**" link | `ListRow` "Name · class"; subtitle "status · schedule · term"; status is not a right-aligned green label (l.296-300) | DIFFERS |
| "Complete enrollment" link | present (Main:646) | none | MISSING |
| Scan attendance button | n/a (text only) | "Scan class QR for attendance" goes to `/pathshala-scan` (l.301-310) | EXTRA-IN-APP (keep) |
| Empty Pathshala | n/a | "No Pathshala enrollments" (l.288) | EXTRA |
| "Listen and learn" | Heading always shown; 3 rows, each a 44px tinted circle with a play icon, name, sub "Jainism 1 · 6 min" | Hidden when there is no content; `headset-outline` icon with no circle; sub = `metadata.duration` only; tap opens a browser (l.319-332) | DIFFERS (icon, subtitle format "{course} · {min}") |

## 4. Saathi pane (`jwTab 2`)
App: `SaathiPane`, jain-way.tsx:341-420.

| Element | Prototype | App | Status |
|---|---|---|---|
| Intro | "Celebrate each other's progress **and lend a hand when someone falls behind.** Anumodana earns you 5 points, support earns 3." | `saathi.intro` without the middle clause (en.ts:664) | DIFFERS |
| Family circle header | "Family circle" with "**Walk the path together**" on the right | "Family circle" only (l.375) | MISSING sub |
| Member row | 36px avatar in the member's colour; name; **status on the right** ("Daily goal met" / "On track" / "Completed" / "3 days behind" in red / "Encouraged"); goal line (e.g. "Learn Logassa sutra · level 7 of 10", "Daily goal · 5 of 5 practices · 23-day streak"); bar coloured by status | 40px avatar (navy or purple); "N-day streak · x of y today" or "Progress is private"; purple bar; **no status label, no Gyan Path goal line** (l.376-387) | DIFFERS |
| Per-member buttons | none (actions live in the cards below) | "Send anumodana" on every member, plus "Encourage" when streak is 0 (l.388-395) | EXTRA-IN-APP |
| **CELEBRATE cards** | Amber card. "CELEBRATE · 2 HOURS AGO" + tag ("Learning" / "Daily goal"); Fraunces headline ("Anya completed Learn Navkar Mantra, all 9 levels!"); social line ("Rahul sent anumodana · her teacher sign-off is next" / "Be the first to send anumodana"). Button "Send anumodana · +5 points" turns into a green "Anumodana sent ✓" + toast "Anumodana sent · +5 JSH points" (Main:669-676, 1941-1944) | none; there is no activity/milestone feed | **MISSING** |
| **"BE DEV'S SAATHI" support card** | Purple-bordered card: "Dev hasn't practiced Logassa for 3 days"; explainer; **3 selectable preset messages**; "Send · +3 points" and "Practice together tonight". After sending, a confirmation block (two variants, Main:1950); toasts "Encouragement sent to Dev · +3 JSH points" / "Invite sent · Gyan Path together at 8:30 PM". Hidden in kid view (`showHelp: !s.kid`) | Only an "Encourage" button (adults, when streak is 0). **No message choice**: it passes `message=null` (l.355) although `send_anumodana` accepts `p_message` (lib/api/jainway.ts:117-118). No "practice together" | **MISSING** |
| "Anumodana for you" received list | n/a | purple card (l.399-414) | EXTRA-IN-APP |

## 5. Library pane (`jwTab 3`)
App: `LibraryPane`, jain-way.tsx:426-492.

| Element | Prototype | App | Status |
|---|---|---|---|
| Intro | "Reference for your practice: live darshan, pachchakhan and the JSH guide." | none | MISSING |
| Live darshan | **196px dark video tile**: red "LIVE" badge top-left; caption "Derasar camera · Aarti at 4:30 PM" bottom-left; 64px cream play button centred | Navy card **row**: LIVE pill, title, play icon; opens a browser; **hidden when there is no stream** (l.445-463) | DIFFERS (look). No "offline / next aarti" state. |
| "Pachchakhan library" heading | ✓ | `library.pachchakhan` | MATCH |
| Pachchakhan rows | name + `when`, "›", opens `view:'pach'` | ListRow title + `metadata.when`, chevron, goes to `/pachchakhan/[id]` (l.474) | MATCH |
| Guide card | 44px "i" tile; "**JSH guide and directory**"; sub "WhatsApp groups, your zone, timings, volunteering, who's who"; goes to Welcome guide | compass icon; "Guide and directory"; **no sub** (l.481-489, en.ts:682); `/guide` | DIFFERS (sub missing; title correctly drops "JSH") |

## 6. Pachchakhan detail
Prototype: Library → a row (`view:'pach'`), title "Pachchakhan". App: `src/app/(app)/pachchakhan/[id].tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Navy band: name + when | ✓ | `Band` (l.35) | MATCH |
| "What" paragraph | ✓ | `meta.what` (l.36-40) | MATCH |
| Sutra card | "Sutra" + italic placeholder | eyebrow "Sutra" + body or `library.sutraPending` | MATCH |
| "Listen to the recitation" | Always shown: white row with a 36px play circle (not wired in the prototype) | Primary button shown **only if `media_url`** (l.49) | DIFFERS (style; hidden when there is no media) |
| **"Remind me today"** toggle | Navy button; becomes green "**Reminder set · tap to remove**" (Main:561, 2192-2193) | none | **MISSING** |
| Guidance footnote | "For guidance on your own tapasya, please consult a guruji or Pathshala teacher." | `library.guidance` | MATCH |

## 7. Gyan Path (GyanPath.dc.html)
App: `src/app/(app)/gyan/[goalId]/index.tsx` (map) and `gyan/[goalId]/level/[levelId].tsx` (level).

### 7a. Header (all Gyan Path screens)
| Element | Prototype | App | Status |
|---|---|---|---|
| Back | goals screen → app; others → map/goals | router back | MATCH |
| Title | "Gyan Path" on goals; **goal name** elsewhere | map: "Gyan Path" (index.tsx:84); level: "Gyan Path level" (level:41) | DIFFERS |
| **Streak chip (🔥 11) + points chip (1,255)** in the header | ✓ (GyanPath:32-33) | none | MISSING |

### 7b. Goals screen: **MISSING as a screen** (partly folded into the Learn pane, §3)
| Element | Prototype | App | Status |
|---|---|---|---|
| Greeting | "Gyan Path · Jai Jinendra, Priya" / "Pick a goal. We'll guide you one small level at a time." / explainer ("…A Pathshala teacher signs off your final level. Points and streak are shared with My Jain Way.") | none | MISSING |
| **MY DAILY GOAL** selector | 5 min Casual / 10 min Regular / 15 min Serious (selectable) | none; no schema column | MISSING |
| LEARNING GOALS heading | ✓ | "Gyan Path" section title | DIFFERS |
| Goal card | Coloured letter tile (S/N/L/P, per-goal tint); name; "**FOR YOU**" badge on the recommended goal with a tinted border; description sub ("48 minutes of equanimity · 12 levels · about 3 weeks"); bar; progress "Level {n+1} of {N} · {n} done" / "Completed · all levels done" / "**Not started · already know it? Take a quick check to skip ahead**" | Purple number tile; name; "Level X of N" / "Completed · all levels done" / "Not started · {n} levels"; no description, no badge, no per-goal colour | DIFFERS |
| Learning with family | "Anya · Learn Navkar Mantra … Level 5 of 9" | in the Learn pane (children only) | DIFFERS (placement) |
| Footnote | "Level order… may differ by tradition." | `learn.contentNote`, shown on the map screen | MATCH (moved; "your Pathshala" is correct for multi-tenant) |

### 7c. Map screen
| Element | Prototype | App | Status |
|---|---|---|---|
| Top strip | "{chapter} · 10 min a day", progress bar, "4/12" | Purple `Band`: eyebrow "Level X of N", goal name, description, bar (index.tsx:94-96) | DIFFERS |
| **Duolingo-style zigzag path** | Nodes zig-zag (x = 195/280/195/110) along a connecting SVG line (done part green). Current node is 84px and pulsing; others 66px. Boss node "♛" is a rounded square; treasure node "◆" | Vertical list of Cards; current has a saffron border; boss/treasure icons appear only while locked (l.104-161) | **DIFFERS (major look)** |
| **Chapter headers** | Coloured pills, e.g. "CHAPTER 2 · SUTRAS OF SAMAYIK" | none; `gyan_levels` has no chapter field | MISSING |
| **Stars under done nodes** | ★★☆ | none on the map (stars are shown per step inside a level only) | MISSING |
| Node label | "5. Iriyavahiyam sutra · treasure" | name + "Steps: N · +pts · Treasure: X · Teacher sign-off" | DIFFERS (app shows more meta) |
| Tap a done node | toast "Replay level {n} anytime to earn more stars" | opens the level | DIFFERS |
| Tap a locked node | toast "Finish level {n} to unlock this one" | `learn.locked` toast | MATCH |
| Tap the current node | opens the lesson | opens the level | MATCH |
| Primary button | **Sticky bottom**, saffron with a 3D shadow: "Play level 5: Iriyavahiyam sutra" / "Goal complete · choose another" | `learn.play` Button (purple) at the end of the scroll; no complete-state label (l.163-169) | DIFFERS |
| Sign-off banner | n/a | shown when the goal is complete (l.97-102) | EXTRA-IN-APP (good) |

### 7d. Lesson (fixed steps: learn → quiz → quiz → recite)
| Element | Prototype | App | Status |
|---|---|---|---|
| Structure | **One step per screen**, top bar + "1 / 4", big primary button at the bottom | **All steps stacked as cards** on one scroll; only the active one expands (level:95-112) | **DIFFERS (major flow)** |
| Step label | "LEARN · LEVEL 5" / "QUICK QUIZ" / "RECITE" | "{i} · Learn/Listen/Quick quiz/Recite…" caption | DIFFERS |
| Learn step | Level name (big); meaning; audio toggle "Listen to the recitation" ↔ "Playing recitation · 0:42" (in-app playback); "SUTRA TEXT, LINE BY LINE" box | Content `body_md` or fallback copy; "Listen to the recitation" opens a **browser**; "Mark as done" (3 stars) | DIFFERS (no in-app audio, no line-by-line block) |
| Quiz | One question per step; option cards with a 3D shadow; "Check" greyed until a pick; "Correct! Well done." / "Not quite. The right answer is highlighted in green."; "Continue" | Multiple questions per step; Check disabled until all answered; banner "…right **answers** are highlighted" (en.ts:652) | Mostly MATCH; minor copy DIFFERS |
| Recite | "Now recite {sutra} aloud"; "Listen once more, then tap the microphone…"; **big mic button**: Tap to start → "Listening… tap to stop" → "Clear recitation · steady pace" + feedback "Anumodana! Your recitation matched the reference audio well."; primary "Skip recitation for now" becomes "Continue" | Text + **"I recited it"** (self-report, 3 stars) and "Skip recitation for now" (2 stars). **No recording**, although the schema has `recording_path` (migrations/0007:102) | **MISSING (mic/recording)** |
| Per-step toast | none | "Step complete · N of 3 stars" | EXTRA |

### 7e. Level complete
| Element | Prototype | App | Status |
|---|---|---|---|
| Full-screen navy celebration | "LEVEL 5 COMPLETE" (gold); Fraunces title; 3 big pop-in stars; stats row **+{pts} JSH points · {streak} day streak · {acc}% accuracy**; "Treasure unlocked: {badge}"; "Next up: level 6 · Tassa Uttari sutra" / "…Your teacher sign-off is next."; primary "**Next level**" / "Choose a new goal"; "Back to my path" | Inline green card: "Level N complete", level name, "**Worth {points} points once your progress is recorded.**", then "Request teacher sign-off" (final level) or "Back to my path" (level:113-137) | **DIFFERS / MISSING**: stars, stats, treasure-unlocked, next-up and the "Next level" CTA are all missing; the points copy is vague |
| Points model | 10 + stars×10 awarded **immediately** on finish | Step points come from a trigger on `gyan_progress` (migrations/0018:195-208); level points only on teacher approval (0017:212-217) | DIFFERS: decide on one rule and show the number earned |
| Teacher sign-off | text only ("…sign-off is next") | request button + requested / approved / needs-work states | EXTRA-IN-APP (keep) |

## 8. Niva chat (`view:'niva'`)
Prototype title "JSH Niva". App: `src/app/(app)/niva.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Title | "JSH Niva" | `niva.title` "Niva" | DIFFERS: needs a tenant-neutral decision, e.g. "Niva" with sub "{center} assistant" |
| Greeting bubble | "Jai Jinendra! I am Niva, the JSH assistant. Ask me about timings, events, bolis, membership or our practices." | none; card "Niva is coming soon" + body | **MISSING** |
| Bubbles | assistant left/white, user right/navy, "Source: …" under answers | none | MISSING |
| "Try asking" chips | 5 questions (derasar hours, weekend, voting eligibility, life membership, Ayambil); asked ones disappear | none | MISSING |
| Input + send | "Ask in English, Gujarati or Hindi", navy send button | none (a `niva_conversations` table exists in database.types.ts:2645) | MISSING |
| Footer | "Niva answers from JSH-approved content and shows its sources. Doctrinal questions are referred to Pathshala teachers." | similar sentence inside `niva.body` | PARTIAL |

## 9. Brand text
The product brand should be "Community Connect"; JSH stays as the tenant name.
- App name: `app.json:3` `"name": "Connect"`; scheme `connect`.
- `en.ts`: `drawer.version` "Connect · version {version}" (l.66); `setup.title` (l.82); `lock.body` (l.90); `bolis.reminderUnavailable` (l.543); `settings.biometricSub` (l.769); `settings.aboutSub` (l.800); `scan.cameraDenied` (l.929). All say "Connect" and should say "Community Connect".
- **Prototype copy that hard-codes "JSH"** must become tenant-driven in the app, never the literal "JSH": "JSH points", "+5 JSH points" toasts, "JSH Niva" / "the JSH assistant", "JSH guide and directory", "JSH Pathshala", "JSH · Family circle" push header. The app currently drops the tenant name ("Points", "Guide and directory", "Niva"). That fixes the hard-coding but loses the community identity; interpolate `center.short_name` instead.

---

## Prioritized fix list

### P1: broken or missing flows
1. **Niva chat plus the Niva FAB.** Build the chat: greeting, bubbles with sources, "Try asking" chips, input, footer; persist to `niva_conversations`. Add a FAB overlay with a quick menu of 3 chips and "Open chat", following the prototype's visibility rules. Files: `src/app/(app)/niva.tsx`, new `src/components/niva-fab.tsx`, mounted in `src/app/(app)/_layout.tsx` or the tabs layout; new `src/lib/api/niva.ts`; `en.ts` `niva.*`.
2. **Gyan Path lesson flow.** Change to one step per screen with a "n / 4" progress bar, a bottom primary button (Check / Continue / Skip recitation), and in-app audio playback (expo-audio) instead of opening a browser. File: `src/app/(app)/gyan/[goalId]/level/[levelId].tsx`.
3. **Recitation recording.** Mic button with idle / listening / recorded states; upload to `gyan_progress.recording_path` (90-day retention); feedback copy. Same file plus `src/lib/api/gyan.ts`.
4. **Level-complete celebration screen.** Stars, +points earned, streak, accuracy, "Treasure unlocked", "Next up", "Next level" / "Choose a new goal", "Back to my path". Fix the points rule so the number shown is the number credited. Files: new `gyan/[goalId]/level/done.tsx` (or a state in the level screen); `lib/api/gyan.ts`; migrations 0017/0018 if the rule changes.
5. **Saathi celebration and support cards.** Milestone feed (goal completed, daily goal met) with "Send anumodana · +5 points" and a sent state. "Be {name}'s Saathi" card with 3 preset messages passed as `p_message`, "Send · +3 points" and "Practice together tonight", plus the confirmation text. Hide the support card for children. Files: `src/features/jain-way.tsx` (SaathiPane), `src/lib/api/jainway.ts` (feed query), `en.ts` `saathi.*`; possibly a migration for a milestones/activity view.
6. **Gyan Path goals screen.** Greeting, explainer, MY DAILY GOAL (5/10/15 min), goal cards (letter, tint, description, FOR YOU badge, "Level n of N · k done", "Not started · already know it? Take a quick check to skip ahead"), learning with family. Replace the per-goal list in the Learn pane with the navy "continue" hero card. Files: new `src/app/(app)/gyan/index.tsx`; `features/jain-way.tsx` LearnPane; migration adding `gyan_goals.recommended/tint/mark` and a per-person daily-goal setting.
7. **Pachchakhan "Remind me today" toggle** (local notification at `when`), with the "Reminder set · tap to remove" state. File: `src/app/(app)/pachchakhan/[id].tsx`, plus a reminders helper in `src/lib/push.ts`.
8. **Push-tap routing** for family-circle notifications into the Saathi tab (`/jain-way?tab=saathi`) and the inline "Send anumodana" action. Files: `src/lib/push.ts`, `src/app/_layout.tsx`.

### P2: wrong fields, copy or behaviour
9. **Today practice rows.**
   - Add a time of day. Migration: `practices.time_label` or a default time, or a per-selection time.
   - Show "{time} · {category label}".
   - Map the category keys to the 5 prototype labels (Mantra & jaap, Tapasya & pachchakhan, Darshan & puja, Samayik & pratikraman, Swadhyay & learning).
   - Sort by time and add the bell icon.
   - Allow un-ticking (needs an `unlog_practice` RPC that reverses the points).

   Files: `features/jain-way.tsx:24-26, 140-171`; `lib/api/jainway.ts`; migrations.
10. **"Your standing this month" card**: Top X% per category, private to you. Files: `features/jain-way.tsx`; new RPC in migrations.
11. **Copy fixes in `en.ts`:**
    - `jw.points` → "{center} points"
    - `jw.remindersNote` → "Reminders arrive 10 minutes before each practice." (move it above the list; keep the privacy line elsewhere)
    - `jw.dayCompleteBody` → include "+20 completion bonus" (the real bonus value)
    - `jw.addRemove` → "+ Add or remove practices"
    - `saathi.intro` → add "and lend a hand when someone falls behind"
    - add the "Walk the path together" sub
    - `library.guide` → "{center} guide and directory" plus the sub "WhatsApp groups, your zone, timings, volunteering, who's who"
    - add the Library intro line
    - `learn.notStarted` → "Not started · already know it? Take a quick check to skip ahead"
    - `learn.someWrong` → singular "answer" per question
    - `learn.pointsNote` → state the actual points earned
12. **Catalog behaviour.** Keep the practice list visible while the catalog is open (the catalog appears below it). Catalog meta "{cat} · {pts} points · {time}"; "Added" in navy, not green; drop the "Practices" header. File: `features/jain-way.tsx:173-197`.
13. **Saathi member rows.** Add a status label (Daily goal met / On track / Completed / N days behind / Encouraged), colour the bar by status, and add the Gyan Path goal line. Move the per-member send buttons into the cards from item 5. Files: `features/jain-way.tsx:376-397`, `lib/api/jainway.ts` `loadSaathi`.
14. **Pathshala enrollment row.** Status as a right-aligned green label; "Complete enrollment" link for requested/waitlisted rows. File: `features/jain-way.tsx:290-314`.
15. **Gyan Path titles and header chips.** Goal name as the screen title on map and level screens; streak and points chips in the header. Files: `gyan/[goalId]/index.tsx:84`, `level/[levelId].tsx:41`, `components/screen.tsx` (`headerRight`).
16. **Map behaviour.** Tapping a done level shows the replay toast (or opens replay deliberately); "Goal complete · choose another" CTA; sticky footer Play button (`Screen footer=`). File: `gyan/[goalId]/index.tsx`.
17. **Saathi tab red dot.** Pass `badge` to `Segmented` when there is unsent anumodana or an open support ask. File: `app/(app)/(tabs)/jain-way.tsx:29-34`.
18. **Brand.** `app.json` name → "Community Connect"; the 7 "Connect" strings in `en.ts` (l.66, 82, 90, 543, 769, 800, 929); make "JSH …" copy tenant-interpolated.

### P3: visual polish
19. **Gyan Path map look.** Zigzag node path with a connecting line, 84px pulsing current node, crown boss node, treasure diamonds, chapter pills (needs `gyan_levels.chapter`), stars under done nodes, per-goal background tint. File: `gyan/[goalId]/index.tsx`.
20. **Today hero.** Streak in an inner #26396E panel with a 30px flame. Week strip with the letter under the circle, saffron fill for done days, and a saffron ring on today. File: `features/jain-way.tsx:110-132`.
21. **Practice rows as separate cards** with 44px circles and amber-to-green point chips. File: `features/jain-way.tsx:141-170`.
22. **Live darshan as a 196px dark video tile**: LIVE badge, caption "{camera} · Aarti at {time}", centred play button; add an offline state instead of hiding it. File: `features/jain-way.tsx:445-463`.
23. **Learn pane details.** "Listen and learn" rows with a tinted play circle and "{course} · {min}" sub; always show the heading. Pachchakhan "Listen" as a white row with a play circle (show a disabled state without media). Files: `features/jain-way.tsx:319-332`, `pachchakhan/[id].tsx:49`.
24. **Sticky sub-tab bar** on My Jain Way; left-aligned Fraunces 22 header title app-wide. Files: `app/(app)/(tabs)/jain-way.tsx`, `components/screen.tsx:59-64`.
25. **Gyan Path buttons and quiz options** with the 3D bottom-shadow style (saffron / green / grey by state). File: `level/[levelId].tsx`.

## Files referenced
- Prototypes: `/home/user/connect-crm/docs/handoff/prototypes/source/Main.dc.html` (Learn markup l.549-748, FAB l.1398-1411, family push l.1445-1466, logic l.1670-1720, l.1908-1960, l.2175-2213, l.2298-2302); `/home/user/connect-crm/docs/handoff/prototypes/source/GyanPath.dc.html`
- App:
  - `/home/user/connect-mobile/src/app/(app)/(tabs)/jain-way.tsx`
  - `/home/user/connect-mobile/src/features/jain-way.tsx`
  - `/home/user/connect-mobile/src/app/(app)/niva.tsx`
  - `/home/user/connect-mobile/src/app/(app)/pachchakhan/[id].tsx`
  - `/home/user/connect-mobile/src/app/(app)/gyan/[goalId]/index.tsx`
  - `/home/user/connect-mobile/src/app/(app)/gyan/[goalId]/level/[levelId].tsx`
  - `/home/user/connect-mobile/src/components/screen.tsx`
  - `/home/user/connect-mobile/src/components/ui.tsx`
  - `/home/user/connect-mobile/src/components/drawer.tsx`
  - `/home/user/connect-mobile/src/lib/api/jainway.ts`
  - `/home/user/connect-mobile/src/lib/api/gyan.ts`
  - `/home/user/connect-mobile/src/lib/rules.ts`
  - `/home/user/connect-mobile/src/i18n/en.ts`
  - `/home/user/connect-mobile/app.json`
- Schema: `/home/user/connect-crm/supabase/migrations/0007_learning_content_calendar.sql`, `0017_admin_gaps.sql`, `0018_mobile_gaps.sql`
