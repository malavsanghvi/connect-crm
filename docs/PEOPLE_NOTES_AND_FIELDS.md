# People: custom fields and notes (plan)

Status: plan and clickable prototype, 2026-10-12, companion to [PEOPLE_REDESIGN.md](PEOPLE_REDESIGN.md). Owner request (2026-10-12): "Need to be able to add custom fields at person/household level. Eventually we would like to put notes at household/person level and admin controls who can see the notes across the org." Built for every organization Weaver onboards (any kind, any faith or none): the suggested fields and note categories below are **data keyed by the kind of organization** (`organization_categories`: `jain_center`, `chamber_of_commerce`, `nonprofit_secular`, `faith_other`), never code branches.

**Prototype**: `people-redesign-prototype.html` (the same file, extended): a Custom group on every person card and on the household, an "Add a field" sheet, a Notes card with a composer, a "Who sees notes" sheet. The guide bar has three switches for trying it: "You can" (edit people and settings / edit people, not settings / only view), "Notes seen as" (five roles) and "Kind" (four kinds of organization). Screenshots: `people-notes-*.png`.

## Part 1. Custom fields become first-class

### 1.1 What already exists (read from the code and migrations, 2026-10-12)

| Piece | What it does today | Where |
|---|---|---|
| Definitions | `app.custom_field_definitions`: label, key, type (text, number, date, yes/no, choice, money in cents, email, phone, url), choices, **sensitivity** (`staff`, `member_self`, `directory`), `searchable`, status `active` or `archived`, `sort`, source `manual` or `import`. Entities include `people` and `households`. Every change is audited by trigger. | 0190 |
| Values | In each table's `custom` jsonb; **staff-only values live in `app.custom_staff_values`**, readable only by staff who may read that kind of record, so a member's app never receives them. A trigger checks the type and routes the value; a null clears it. | 0190, 0401 |
| Write | `app.set_custom_value(entity, record, key, value)` runs as the caller (the table's own RLS and module switch apply). Screen path: `setCustomValueAction` in `src/app/custom-field-actions.ts`. There is no catalog command for it. | 0401 |
| Add a field | Settings › Custom fields (`/settings/custom-fields`), gate `centerSettings` = `settings.manage`, action `defineCustomFieldAction` → `app.define_custom_field`. **The function itself also accepts `people.manage` for people and households** (it was written for the import tool). | 0190, `settings/custom-fields/actions.ts` |
| Rename, change choices or visibility, archive | `app.update_custom_field`, needs `settings.manage`. The type can change only while no record has a value. Archive keeps every value and blocks new ones; **nothing is ever deleted**. | 0190 |
| Import | Creates fields from unmapped columns (`source = import`). | 0192 |
| Show and edit | The "More details" card (`MoreDetails`, `custom-fields-editor.tsx`): one Edit and Save per row; at the bottom of the household and person pages; **renders nothing until a field exists**; a "Manage the … custom fields" link for `settings.manage`. | `src/components/more-details.tsx` |
| Members | `member_self` and `directory` values are readable by the person or household (`app.person_custom_fields`); staff-only never leave. | 0190, 0401 |
| Lists and audiences | The People list can add one custom column (`CustomColumnPicker`); comms audiences filter on **searchable** fields (segments). | 0194, `comms/custom-segment-picker.tsx` |

Findings: (1) the Settings checkbox says "Searchable and usable as a filter", but today `searchable` only feeds comms segments: neither the top-bar search nor the People filters use it. (2) There is no way to reorder fields: `sort` is set at creation and never edited in a screen. (3) The feature is invisible to a new admin: the card does not appear until someone has found Settings › Custom fields. (4) A person with `people.manage` can add a person field through the database function but not through the screen: the two gates disagree.

### 1.2 What the redesigned pages do

| Where | Behaviour | Status |
|---|---|---|
| Person card and slide-over | A **Custom** group under Language, one row per active field for people, each with a small icon for who sees it (lock = staff only, eye = the member sees their own, list = directory), **click to edit like every other field** (Enter saves, Undo, conflict, per-type validation next to the field in the same words the database uses: "“Anniversary” takes a date as MM/DD/YYYY"). | New (display and edit use the existing action) |
| Household | A **Custom details** card in the right column under Address, same behaviour. | New |
| "Add a field" | A link at the end of each Custom group opens a small sheet: applies to (a person or a household, preselected), name, type, choices (only for a choice), **who can see it** in plain words (Staff only / The member can see their own / Shown in the member directory), and "Found by the one box and usable as a list filter". Suggestions for this kind of organization are chips at the top; picking one fills the sheet. Enter adds. The field appears on every card at once. The toast's Undo **archives** it. | New (calls the existing action and function: no migration) |
| Who may add | **Holders of `settings.manage`**, exactly the permission that manages definitions today. Everyone else with edit rights sees the same sheet in an "Ask an admin to add a field" state: they fill in what they want and the button reads "Copy request for an admin" (no new messaging feature). View-only people see no link. | New (see question A) |
| Manage | The Manage link (settings holders only) lists the fields of that kind with up and down arrows (order = order on the page) and Archive or Restore. Archived fields vanish from cards, keep their values, and can be restored. | New (arrows call `update_custom_field(p_sort)`) |
| Suggested fields per kind | Data: `src/lib/custom-field-suggestions.ts`, keyed by category key, plus shared ones (`any`). Examples: `faith_other` baptism date, membership class completed, home group; `chamber_of_commerce` industry (a choice, shown in the directory), number of employees, job title; `jain_center` native place, gotra; `nonprofit_secular` volunteer availability, how they heard about us; shared: pronouns, languages spoken at home. Nothing in code asks "is this a church". Later the same rows move to a platform reference table, like `organization_categories`. | New (slice 2: a data file; slice 13: a table) |
| The one box | A field marked searchable is **found by the box** (name, phone and IDs already are): a row says why it matched ("Volunteer skills: Catering, first aid"). Staff-only values are read through RLS from `custom_staff_values`. | New (slice 4, no migration: PostgREST `custom->>key` filters; fine at community scale) |
| List filters and saved views | "Gotra is Kashyap" is a filter chip on any People view, and can be saved. | New (slice 8) |
| Member app | Unchanged by design: `member_self` shows in the person's own profile, `directory` in the directory, `staff` never. Any directory value about a person under 18 is not listed (verify against `app.person_custom_fields` in slice 2). | Exists |
| Exports | A custom column is exported only if the exporter chose it in the column picker and may read it (RLS decides); exports are recorded (`app.record_export`). | Exists |
| Audit | Definition changes: trigger on `custom_field_definitions`. Value changes: an audited edit of the record (and of `custom_staff_values`); the History tab reads "Gotra changed". | Exists |
| Children (D2) | Custom values about anyone under 18 are staff-only on screen and never sent to Niva (`filterChildren`, `databaseMinorNames`); the box's custom-field lane returns adults only for a model. | Rule, applied in slices 2 and 4 |

Commands: field values use `setCustomValueAction` (the RPC) today. For Niva and the palette to share the path a wrapper `people.set_custom_value` (confirm level, children refused when the caller is the assistant) is added in slice 6 with the other wrappers; it needs an activity-allowlist row, so it waits for that migration. The RPC has no "expected value" input, so the conflict check compares the current value first (a small race window, accepted).

Click budget: **add a field** today about 6 (rail, Settings, Custom fields, record kind, name and type and who sees it, Add, then back to the record) to 3 (Add a field, pick a suggestion or type the name, Add). **Fill a value** today 5 (family, scroll to More details, Edit, type, Save) to 2 once the family is open (click, Enter).

### 1.3 Questions for the owner (custom fields)

A. **Who may add a field from the page?** *Recommend*: `settings.manage` holders only (today's rule for the screen); others copy a request. The database function already lets `people.manage` holders add people and household fields; opening the screen to them is a **permission change, NEEDS OWNER OK**.
B. **Suggested fields as a data file now, a table later?** *Recommend yes*: no migration for slice 2; the Weaver team edits a table (slice 13) once communities ask for more.
C. **Grouping.** One Custom group per record kind, ordered by `sort`. *Recommend*: no group labels yet; add an optional group name (a migration) only if a community has more than about ten fields.

## Part 2. Notes (later; the page leaves room now)

### 2.1 Today, and a finding to act on first

Only `households.notes` exists: one free-text column. People have no notes. **Finding:** the policy `households_mine` lets a member read their own household row, and the member app does `from('households').select('*')` (`connect-mobile/src/lib/api/member.ts`, line 159), so **staff text in `households.notes` is returned to the household's own members today**, whether or not the app shows it (an adult can also update the row, `households_adult_update`). The cure is not a column privilege (staff pages read the same table as the same database role); it is moving notes into a table that has no member policy. That is part of slice 10, and I recommend doing slice 10 before any other notes work.

### 2.2 The feature

- **Many dated notes** per household or person: author, time, body, **kind** (category), optional **follow-up date**. A note is about one subject: the whole family or one person (a person's note also shows on the Family page with their name on it).
- **Where**: a **Notes card** on the Family page (left column, beside IDs; the first four notes, "Show N more", chips for the kinds you can see, "Add a note"), and a **Notes** section in the person slide-over (that person's notes, "Add a note about Samira").
- **Composer**: who it is about, kind (only kinds your role may write), a plain-words **"Who can see this"** box (roles that can see it, "you see it because you wrote it", "Niva cannot read this kind of note", "not in the member app, not in exports unless chosen"), the note, a follow-up date. Ctrl+Enter adds.
- **Edit and remove**: the author can edit for 15 minutes ("Edit, 14 minutes left"); afterwards "Add a correction" appends a note that names the one it corrects. Remove asks a reason and leaves a line ("Removed by Ravi, reason: wrong family"); the text is kept out of every screen. Nothing is hard-deleted: only a privacy-officer deletion request purges text, with a fresh 2FA check.
- **Follow-ups** (later, slice 12): a follow-up date shows in the Inbox ("Follow up: Hassan household, Oct 20") for the author; mentions of a person or a role come after that.

### 2.3 Categories and who sees them (the model in three lines)

1. The community's admin defines **kinds of note** (examples as data by kind: General, Care and pastoral, Finance, Membership, Volunteering; a chamber might add Sponsorship) and, for each kind, **which roles can see it and which can write it**: a matrix of roles by kinds in Settings › **Who sees notes**.
2. **The author always sees their own note**; the organization owner sees every kind; **platform staff do not** (the payee-vault precedent: `app.payee_has_permission` ignores a platform admin's blanket permissions; a time-boxed support grant, B1, would be the only way in).
3. **RLS enforces it**: a note is readable only if you can already read its household or person **and** the kind allows one of your active role grants (or you wrote it). Members and every family role have no policy at all.

**Can the existing model express it?** Partly. Permissions are per module (`people.view`, `giving.view`, `events.confidential` and so on) and `has_permission` is permission-based, so a rule "kind X needs permission P" works today but is too coarse: the owner wants "Care notes for the pastoral lead, not the treasurer". Roles are rows of `app.roles` granted through `app.role_grants` (center, user, role key, scope, start and end, so time-bound roles expire by themselves), and the matrix keys on `role_key`, so a cloned or renamed role is simply another column. **Added**: three tables (`note_categories`, `note_category_access(category, role_key, level)`, `notes`), the helper `app.can_read_note_category(center, category)`, and one UI access key in `src/lib/permissions.ts` (convenience only). Not covered in v1: **scoped roles** (a zone lead sees no notes) and family roles.

**Who changes the matrix**: the organization owner and holders of `roles.manage`, through a function that asks for a reason and a fresh 2FA check (like role grants and module switches in `docs/ROLES.md`), audited with the reason; widening a kind needs the check, narrowing too.

### 2.4 The policy, in words (NEEDS OWNER OK: permissions and RLS; no migration numbers here)

| Table or function | Rule |
|---|---|
| `notes` read | Same center; the caller can read the subject (the existing people and household read rules); and (the caller is the author, or `can_read_note_category` is true). Removed notes are readable only as the tombstone fields. |
| `notes` insert | `can_write_note_category`; the author is the caller (checked in the policy's `with check`); the subject is readable. |
| `notes` update | Only the author, only inside the edit window, only the body, kind and follow-up; removal fields by the author or the owner. No other updates. |
| `notes` delete | No policy at all. Purging is a privacy-officer function with step-up. |
| `can_read_note_category` | Security definer: the owner; or an active center-wide grant (start and end respected) whose role key has read or write on the kind. Platform admins excluded. |
| Matrix writes | Only through `set_note_access(...)`: owner or `roles.manage`, reason, step-up, audit. |
| Reads of a sensitive kind | Opening the notes goes through a function that returns them under the same policy and writes one `note_reads` row per person, subject, kind and day for kinds with "record who reads it" (on for every kind except General by default). Cheap and bounded. |
| Audit of notes | The audit row records who, when, subject, kind and the event; **never the note text** (a redacted variant of `audit_row`), so `audit.view` cannot read a Care note through History. |

### 2.5 Never, by default

- **Member app**: never. Notes sit in their own table with no member policy, and the old column is emptied.
- **Exports**: not included unless the exporter chooses the Notes column and may read that kind; recorded in `app.record_export`.
- **The one box**: never searches notes.
- **AI**: **never by default.** Each kind has a "Niva may read it" switch, **off**, changeable only by the matrix editors with the same step-up. **Never for a note about anyone under 18 (D2), whatever the switch says**; a household note passes `filterChildren` (children's names removed) before any provider sees it; note text never goes into activity events.
- The existing **`households.notes` text** becomes the household's first **General** note (author "From the old household note", visible to staff who can read the household), then the column is cleared; a later migration drops it. Before that runs, the owner sees a count and one example, because old free text can hold anything.

### 2.6 States the screens must handle

- A kind you cannot read is **hidden** (not even a placeholder), because that a Care or Finance note exists is itself sensitive. Each kind has a switch "Show a locked line to others", off, for communities that prefer a visible lock ("A note in Care and pastoral · you don't have access to it"); the prototype shows both.
- A role on no kind at all sees "**You don't have access to this area.**" on the card and in the slide-over, never an empty list.
- A note about a child shows "Child · staff only" and cannot be read by Niva.
- A failed save keeps the text in the composer and says why, like every other edit.

### 2.7 Questions for the owner (notes)

1. **Hidden or a locked line** for a note someone cannot read? *Recommend hidden*, with a per-kind switch for the lock.
2. **Does the organization owner read every kind, and platform staff none?** *Recommend yes and yes* (owner can do every task, `docs/DECISIONS.md`; platform staff only through a time-boxed support grant, B1).
3. **Edit window.** *Recommend 15 minutes*, then corrections; removal always with a reason and a tombstone.
4. **Who changes who sees notes?** *Recommend the owner and `roles.manage` holders*, with a reason and a fresh 2FA check.
5. **Zone leads and other scoped roles.** *Recommend no notes in v1*; later a per-kind switch "zone leads for their own zone".
6. **Move today's household text first?** *Recommend yes, as slice 10 before anything else*, as a General note for staff who can read the household; the owner reviews the count first.

## Part 3. Build slices (numbers as in PEOPLE_REDESIGN.md section 9)

| # | Slice | Size | Migration | Touches permissions/RLS |
|---|---|---|---|---|
| 2 | **Custom fields on the page**: Custom group on person cards, the household card and the slide-over, click-to-edit through the existing action, "Add a field" sheet (and the "Ask an admin" state), Manage (order, archive), suggestions data file, per-type messages. Recommend this right after slice 1 | S-M | No | No (same gates as Settings) |
| 4 | **Find**, extended: searchable custom fields found by the box | (within slice 4) | No | No |
| 8 | **Saved views**, extended: custom-field filters | (within slice 8) | No | No |
| 10 | **Notes 1, the safe foundation**: tables and policies, one General kind, the Notes card and slide-over section, edit window, removal with a tombstone, `households.notes` moved and cleared, redacted audit | M-L | Yes | **NEEDS OWNER OK** (new tables and RLS; closes today's exposure to members) |
| 11 | **Notes 2, kinds and Who sees notes**: kinds, the roles-by-kinds matrix with reason and step-up, composer chooser, reads audit, per-kind Niva and lock switches, export option | L | Yes | **NEEDS OWNER OK** (a new visibility model; new function and audit rules) |
| 12 | **Notes 3, follow-ups**: follow-up dates in the Inbox and Today, mentions | M | Maybe | No new rule |
| 13 | **Suggested fields as a platform table** (and suggested note kinds by organization kind) | S | Yes | No (reference data) |
