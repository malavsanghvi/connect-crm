# Gamified Gyan Path — shared spec (owner request 2026-10-01)

> Parked 2026-10-01 (BACKLOG B43). This is the contract the three open PRs (connect-crm #64, #66; connect-mobile #50) were built to; file paths under a Temp scratchpad below were working copies and no longer exist.

Every workstream reads this whole file first. Names below are a contract between workstreams.

## Owner decisions (2026-10-01)
- Content for the Gyan Path, starting with **Learn Samayik** (12 levels) — interactive and fun; **points for each activity**.
- New module **Learn Puja: Navang puja of Mahavir Swami** (the nine-limb chandan puja). Two steps: **Learn** (guided, touch by
  touch, with what/why) then **Practice** (tap the spots in order, as many times as they like, points every successful try).
  Image: **the community's own derasar photo of Mahavir Swami** (the owner will send it). Until it arrives, a respectful
  placeholder illustration is bundled; swapping in the photo must only need a new image file + new spot coordinates.
- **Navkar Mantra voice learning**: listen first, repeat each verse, then say it all; the app listens and guides corrections.
  Listening is **on the phone** (the device's speech recognition) — this needs ONE new native app build; JS updates go over
  the air again afterwards.
- **Repeat points**: each successful practice try earns points, **up to 10 tries a day per activity** (configurable).
- Pathshala registration with level-based fees: **plan now, build after the learning work** (separate doc).

## Ground rules (all workstreams)
- Read each repo's CLAUDE.md / AGENTS.md. Errors always in plain English with retry; never "saved" when it failed.
- Work in your own git worktree under C:/Work/wt/<name>, branch from origin/main. Disk is tight (~3 GB free): no local
  `next build`, delete `dist/` after an expo export, remove the worktree when done (`git worktree remove --force`; leftover
  long paths: robocopy an empty dir over it with /MIR, then rmdir).
- No Postgres on this machine: Database tests run in CI. Read failing CI logs with
  `gh api repos/malavsanghvi/<repo>/actions/jobs/<id>/logs | grep ...`. Generated DB types come from the CI artifact
  `database-types` (`gh run download <run> -n database-types -D <scratch>`), copied verbatim, never hand-edited.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Open PRs and get checks green; **DO NOT MERGE**.
- Migrations: **0570** (schema + points), **0571** (content pack). Tests: next free numbers (54, 55, …). Org-local dates in
  tests (pg_temp.center_today()-style), never UTC current_date for anything compared with the community's day.
- Doctrinal care: every authored lesson is marked as needing Pathshala review (`activity.review = "needs_pathshala_review"`);
  write explanations in our own words; no song lyrics; sutra text only where verified (see WS-C).

## Data contract (connect-crm migration 0570)
`app.gyan_steps`:
- `kind` CHECK gains **'hotspot'** and **'voice'** (existing: read, listen, recite, quiz, video, practice).
- **`activity jsonb not null default '{}'`** — payload for non-quiz kinds:
  - read: `{ "cards": [ { "title": "...", "body_md": "...", "emoji": "🪔" (optional), "image": "asset:<name>" | https (optional) } ] }`
  - hotspot: `{ "image": "asset:mahavir-murti" | "<content-bucket key>" | https, "mode": "learn" | "practice",
      "intro": "...", "spots": [ { "key": "toes", "order": 1, "label": "Angutha (toes)", "x": 0.42, "y": 0.92, "r": 0.05,
      "say": "short instruction", "why": "own-words meaning" } ] }` — x, y, r are fractions of the image width/height.
      `practice` mode = tap all spots in order; a wrong tap shakes + hints the right one; unlimited tries.
  - voice: `{ "lang": "hi-IN", "mode": "listen_repeat_say", "pass_ratio": 0.7,
      "verses": [ { "text": "णमो अरिहंताणं", "translit": "Namo Arihantanam", "meaning": "...", "audio": "<optional url>" } ] }`
  - every kind may carry `"review": "needs_pathshala_review"`, `"tip"`, `"fun_fact"`.
- `quiz jsonb` keeps `{ "questions": [...] }`; each question gains an optional **`type`** (default "choice") and **`explain`**:
  - choice: `{ "type":"choice", "question", "options":[...], "answer": <0-based index>, "explain" }`
  - truefalse: `{ "type":"truefalse", "statement", "answer": true|false, "explain" }`
  - order: `{ "type":"order", "prompt", "items":[ ...in the correct order... ], "explain" }` (app shuffles)
  - match: `{ "type":"match", "prompt", "pairs":[ ["left","right"], ... ], "explain" }` (app shuffles the right column)
  - fill: `{ "type":"fill", "sentence":"Namo ___", "answer":"Arihantanam", "options":[ "...", "..." ], "explain" }`
- **`repeat_points integer not null default 0`** — points for each successful practice try (after/besides the first-completion
  `points`, which stays once-ever as today).
`app.gyan_levels`: **`treasure_points integer not null default 0`**, paid once when the level is completed.
**`app.gyan_attempts`** (center_id, person_id, step_id, success boolean, score int 0–100 null, detail jsonb, created_at):
own rows readable by the person and household adults (parents) and Pathshala teachers; written only by the RPC; module gyan_path.
**RPC `app.record_gyan_attempt(p_center uuid, p_step uuid, p_success boolean, p_score int default null, p_detail jsonb default '{}')
returns jsonb`** `{ "points_awarded": int, "tries_today": int, "cap": int, "first_time": bool }`: caller is a member of p_center;
records the attempt; if success and the person's successful tries of this step today (community-local day) < cap
(`centers.rules.points.gyan_practice_daily_cap`, default 10), awards `repeat_points` into `points_ledger` (one row per award).
**Level completion bonus**: when a person has completed every step of a level, award once: `gyan_levels.points` if the level
does NOT require a teacher sign-off (sign-off levels keep paying on approval as today) plus `treasure_points`. Idempotent.

## Points table for authored content (WS-C uses these)
read 5 · quiz 10 (+3 bonus per question right first try is NOT needed; keep it simple) · practice 10 · hotspot learn 10 ·
hotspot practice 10 first time, repeat_points 3 · voice 15 first time, repeat_points 3 · level points 20 (existing) ·
treasure_points 50 on badge levels (Samayik level 4 "Foundations badge", level 8 "Logassa badge + 50 bonus points").

## Mobile (connect-mobile)
- Renderers for: read cards (swipe/next), quiz types (choice with explanation + one retry, truefalse, order (tap to arrange),
  match (tap pairs), fill (pick the word)), hotspot (learn: glowing spot sequence with label/why; practice: tap in order,
  wrong-tap feedback, tries counter "3 of 10 today", unlimited tries), voice (listen → repeat each verse → say it all; device
  speech recognition; fuzzy word match; highlight words to fix; play the verse again; device text-to-speech when a verse has
  no audio).
- Gamification: "+N" points toast per activity, confetti burst (JS only), haptics, tries counter, level-complete bonus +
  treasure celebration. Points come from the DB (existing trigger for first completion; `record_gyan_attempt` for tries).
- Native: add `expo-speech-recognition`, `expo-speech`, `expo-haptics` (+ app.json plugin/permissions: microphone, speech
  recognition); bump `runtimeVersion` "2" → "3" and version 1.6.0 (CHANGELOG + README OTA note). The orchestrator runs the
  EAS Android build after merge.
- Bundled placeholder image `assets/gyan/mahavir-murti.png` (or SVG) referenced as `asset:mahavir-murti`.
