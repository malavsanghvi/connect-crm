"use client";

import { useId, useMemo, useRef, useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Card, StatusText, TableWrap, buttonClass } from "@/components/ui";
import {
  BASE_LEVELS,
  LEVEL_LABEL_MAX,
  MAX_MEMBERSHIP_LEVELS,
  MEMBERSHIP_TIERS,
  TIER_LABEL,
  describeLevel,
  describeRule,
  editableLevels,
  enforcementNote,
  featureChanges,
  levelsAtOrAbove,
  levelsChangeCount,
  levelsProblem,
  moveLevel,
  newEditableLevel,
  removalBlockers,
  type AccessFeatureRow,
  type AccessLevel,
  type EditableLevel,
  type MembershipTier,
  type MembershipTypeRow,
} from "@/lib/access";

import { saveLabel } from "../_components/settings-form";
import { saveAccessLevelsAction, saveFeatureAccessAction } from "./actions";

// ---------------------------------------------------------------------------
// Card 1 · Who can use each area
// ---------------------------------------------------------------------------

export function AreasCard({
  centerName,
  levels,
  features,
  types,
  moduleNotes,
}: {
  centerName: string;
  levels: AccessLevel[];
  features: AccessFeatureRow[];
  types: MembershipTypeRow[];
  /** Per area: why nobody can use it although a level is chosen (its module is switched off). */
  moduleNotes: Record<string, string>;
}) {
  const saved = useMemo(() => Object.fromEntries(features.map((f) => [f.key, f.levelKey])), [features]);
  const [chosen, setChosen] = useState<Record<string, string>>(saved);
  // After a save the page sends the new saved choices: start from them (keeping this form, so its "saved" message stays).
  const savedKey = features.map((f) => `${f.key}:${f.levelKey}`).join(";");
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setChosen(saved);
  }
  const reasonId = useId();
  const changes = featureChanges(saved, chosen);
  const byKey = new Map(levels.map((l) => [l.key, l]));

  return (
    <Card
      span={12}
      title="Who can use each area"
      description={`Choose the lowest level that may use each area of the member app in ${centerName}. Anyone at that level or above can use it. People below it are asked to sign in, or told which level they need.`}
    >
      <ActionForm
        action={saveFeatureAccessAction}
        submitLabel={saveLabel("Save", changes.length)}
        pendingLabel="Saving…"
        submitDisabled={changes.length === 0}
        buttonsClassName="mt-4 justify-end"
      >
        <input type="hidden" name="changes" value={JSON.stringify(changes)} />
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Area</th>
                <th className="w-[300px]">Who can use it</th>
                <th className="w-[200px]">Where it applies</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => {
                const options = levelsAtOrAbove(levels, f.floorLevel);
                const current = chosen[f.key] ?? f.levelKey;
                const selected = byKey.get(current);
                const changed = saved[f.key] !== current;
                const note = moduleNotes[f.key];
                return (
                  <tr key={f.key} data-highlight={changed ? "true" : undefined}>
                    <td className="min-w-[18rem]">
                      <p className="font-bold">{f.label}</p>
                      <p className="text-xs text-muted">{f.description}</p>
                      {note ? (
                        <p role="status" className="mt-1 text-xs font-semibold text-brown">
                          {note}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <select
                        aria-label={`Who can use ${f.label}`}
                        className="crm-input"
                        value={current}
                        onChange={(e) => setChosen({ ...chosen, [f.key]: e.target.value })}
                      >
                        {options.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.label}
                            {l.key === f.defaultLevel ? " (platform default)" : ""}
                          </option>
                        ))}
                        {!options.some((l) => l.key === current) ? <option value={current}>{selected?.label ?? current}</option> : null}
                      </select>
                      {selected ? <p className="crm-hint">{describeLevel(selected, types, centerName)}</p> : null}
                      {changed ? <p className="crm-hint font-semibold text-navy">Changed: not saved yet</p> : null}
                    </td>
                    <td className="text-[13px]">
                      {f.enforcedBy === "database" ? <StatusText tone="ok">{enforcementNote(f)}</StatusText> : <span className="text-muted">{enforcementNote(f)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <p className="crm-hint mt-2">
          <strong>Applies in the app</strong> means the member app hides the area from people below the level. The content itself stays readable by every
          community member in the database. <strong>Also enforced by the database</strong> means the database only hands the data to people at or above the
          level, guests included; for live darshan that is the stream&rsquo;s link. It cannot make a link private: the stream plays from the link&rsquo;s own
          site, so anyone who already has the link can still watch it. A stream shared by every community is not affected by this choice. The areas that
          are not listed here (giving, RSVPs, the store, family, Pathshala and the member directory) always need a signed-in community member.
        </p>
        {changes.length > 0 ? (
          <div className="mt-3 max-w-xl">
            <label htmlFor={reasonId} className="crm-label">
              Reason (kept in the audit log)
            </label>
            <input id={reasonId} name="reason" required maxLength={500} className="crm-input" placeholder="e.g. The live stream is for members while we test it" />
          </div>
        ) : null}
      </ActionForm>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 2 · Levels for {center}
// ---------------------------------------------------------------------------

type Row = EditableLevel & { uid: string };

function plain(r: Row): EditableLevel {
  return { key: r.key, label: r.label, tiers: r.tiers, membershipTypeKeys: r.membershipTypeKeys, ...(r.isNew ? { isNew: true } : {}) };
}

export function LevelsCard({
  centerName,
  levels,
  features,
  types,
}: {
  centerName: string;
  levels: AccessLevel[];
  features: AccessFeatureRow[];
  types: MembershipTypeRow[];
}) {
  const counter = useRef(0);
  const nextUid = () => `row-${(counter.current += 1)}`;
  const savedBase = {
    public: levels.find((l) => l.key === "public")?.label ?? BASE_LEVELS[0].label,
    community: levels.find((l) => l.key === "community")?.label ?? BASE_LEVELS[1].label,
  };
  const [base, setBase] = useState(savedBase);
  const [rows, setRows] = useState<Row[]>(() => editableLevels(levels).map((l) => ({ ...l, uid: `saved-${l.key}` })));
  // After a save the page sends the new saved ladder: start from it (keeping this form, so its "saved" message stays),
  // so a level that was just added is a saved level and not a change still waiting.
  const savedKey = levels.map((l) => `${l.key}|${l.label}|${l.rank}|${l.tiers.join(",")}|${l.membershipTypeKeys.join(",")}`).join(";");
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setBase(savedBase);
    setRows(editableLevels(levels).map((l) => ({ ...l, uid: `saved-${l.key}` })));
  }
  const reasonId = useId();
  const baseIds = [useId(), useId()];
  const dirty = levelsChangeCount(levels, rows.map(plain), base);
  const problem = dirty > 0 ? levelsProblem(rows, base) : null;

  function patch(uid: string, change: Partial<EditableLevel>) {
    setRows(rows.map((r) => (r.uid === uid ? { ...r, ...change } : r)));
  }

  function toggle(list: readonly string[], value: string): string[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  function discard() {
    setBase(savedBase);
    setRows(editableLevels(levels).map((l) => ({ ...l, uid: `saved-${l.key}` })));
  }

  return (
    <Card
      span={12}
      title={`Levels for ${centerName}`}
      description="A person is at the highest level whose rule they meet. Public and the community level are fixed (you can rename them); add your own membership levels above them, in order. Members of a household share its membership; a lapsed, ended or pending membership does not count."
    >
      <ActionForm
        action={saveAccessLevelsAction}
        submitLabel={saveLabel("Save levels", dirty)}
        pendingLabel="Saving…"
        submitDisabled={dirty === 0 || Boolean(problem)}
        buttonsClassName="mt-4 justify-end"
        extraButtons={
          dirty > 0 ? (
            <button type="button" className={buttonClass("ghost", "md")} onClick={discard}>
              Discard changes
            </button>
          ) : null
        }
      >
        <input type="hidden" name="levels" value={JSON.stringify(rows.map(plain))} />
        <ol className="divide-y divide-line-soft rounded-[10px] border border-line" aria-label="Access levels, from the lowest to the highest">
          <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3">
            <span className="w-6 pt-2 text-center font-mono text-[13px] font-bold text-navy">1</span>
            <div className="min-w-[14rem] flex-1">
              <label htmlFor={baseIds[0]} className="crm-label">
                Name of the lowest level (fixed)
              </label>
              <input id={baseIds[0]} className="crm-input max-w-sm" value={base.public} maxLength={LEVEL_LABEL_MAX} onChange={(e) => setBase({ ...base, public: e.target.value })} />
              <p className="crm-hint">Anyone, signed in or not. This level cannot be removed or moved.</p>
            </div>
          </li>
          <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3">
            <span className="w-6 pt-2 text-center font-mono text-[13px] font-bold text-navy">2</span>
            <div className="min-w-[14rem] flex-1">
              <label htmlFor={baseIds[1]} className="crm-label">
                Name of the community level (fixed)
              </label>
              <input id={baseIds[1]} className="crm-input max-w-sm" value={base.community} maxLength={LEVEL_LABEL_MAX} onChange={(e) => setBase({ ...base, community: e.target.value })} />
              <p className="crm-hint">Anyone who is signed in and part of {centerName}. This level cannot be removed or moved.</p>
            </div>
          </li>
          {rows.map((r, i) => {
            const blockers = r.isNew ? [] : removalBlockers(r.key, features);
            const shownTypes = types.filter((t) => t.active || r.membershipTypeKeys.includes(t.key));
            const unknown = r.membershipTypeKeys.filter((k) => !types.some((t) => t.key === k));
            return (
              <li key={r.uid} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3">
                <span className="w-6 pt-2 text-center font-mono text-[13px] font-bold text-navy">{i + 3}</span>
                <div className="min-w-[18rem] flex-1">
                  <label htmlFor={`${r.uid}-name`} className="crm-label">
                    Name of this level
                  </label>
                  <input
                    id={`${r.uid}-name`}
                    className="crm-input max-w-sm"
                    value={r.label}
                    maxLength={LEVEL_LABEL_MAX}
                    placeholder="e.g. Patron"
                    onChange={(e) => patch(r.uid, { label: e.target.value })}
                  />
                  <fieldset className="mt-3">
                    <legend className="crm-label">Who is at this level: a household with an active membership of</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      {MEMBERSHIP_TIERS.map((t) => (
                        <label key={t} className="inline-flex min-h-[34px] items-center gap-2 text-[13px]">
                          <input type="checkbox" checked={r.tiers.includes(t)} onChange={() => patch(r.uid, { tiers: toggle(r.tiers, t) as EditableLevel["tiers"] })} />
                          {TIER_LABEL[t]} tier
                        </label>
                      ))}
                    </div>
                    {shownTypes.length > 0 || unknown.length > 0 ? (
                      <>
                        <p className="crm-hint mt-2">…or of one of these membership types:</p>
                        <div className="flex flex-wrap gap-x-5 gap-y-1">
                          {shownTypes.map((t) => (
                            <label key={t.key} className="inline-flex min-h-[34px] items-center gap-2 text-[13px]">
                              <input
                                type="checkbox"
                                checked={r.membershipTypeKeys.includes(t.key)}
                                onChange={() => patch(r.uid, { membershipTypeKeys: toggle(r.membershipTypeKeys, t.key) })}
                              />
                              {t.name}
                              <span className="text-muted">
                                {" "}
                                ({TIER_LABEL[t.tier as MembershipTier] ?? t.tier} tier{!t.active ? ", not offered any more" : ""})
                              </span>
                            </label>
                          ))}
                          {unknown.map((k) => (
                            <label key={k} className="inline-flex min-h-[34px] items-center gap-2 text-[13px]">
                              <input type="checkbox" checked onChange={() => patch(r.uid, { membershipTypeKeys: toggle(r.membershipTypeKeys, k) })} />
                              {k} <span className="text-muted">(no longer exists)</span>
                            </label>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </fieldset>
                  <p className="crm-hint">{describeRule(r, types)}.</p>
                  {blockers.length > 0 ? (
                    <p className="crm-hint font-semibold text-brown">
                      {blockers.join(", ")} {blockers.length === 1 ? "is" : "are"} set to this level. Choose another level for {blockers.length === 1 ? "it" : "them"} above, save,
                      then this level can be removed.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    aria-label={`Move ${r.label || "this level"} up`}
                    disabled={i === 0}
                    onClick={() => setRows(moveLevel(rows, i, -1))}
                    className={buttonClass("ghost", "sm")}
                  >
                    ↑ Up
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${r.label || "this level"} down`}
                    disabled={i === rows.length - 1}
                    onClick={() => setRows(moveLevel(rows, i, 1))}
                    className={buttonClass("ghost", "sm")}
                  >
                    ↓ Down
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${r.label || "this level"}`}
                    disabled={blockers.length > 0}
                    title={blockers.length > 0 ? `Used by ${blockers.join(", ")}` : undefined}
                    onClick={() => setRows(rows.filter((x) => x.uid !== r.uid))}
                    className={buttonClass("bad", "sm")}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3">
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            disabled={rows.length >= MAX_MEMBERSHIP_LEVELS}
            onClick={() => setRows([...rows, { ...newEditableLevel(), uid: nextUid() }])}
          >
            + Add a membership level
          </button>
          {rows.length >= MAX_MEMBERSHIP_LEVELS ? <span className="crm-hint ml-2">At most {MAX_MEMBERSHIP_LEVELS} membership levels.</span> : null}
        </div>
        {problem ? (
          <p role="alert" className="mt-3 text-[13px] font-semibold text-danger">
            {problem}
          </p>
        ) : null}
        {dirty > 0 ? (
          <div className="mt-3 max-w-xl">
            <label htmlFor={reasonId} className="crm-label">
              Reason (kept in the audit log)
            </label>
            <input id={reasonId} name="reason" required maxLength={500} className="crm-input" placeholder="e.g. Added a Patron level for our donors" />
          </div>
        ) : null}
        <input type="hidden" name="base_public" value={base.public} />
        <input type="hidden" name="base_community" value={base.community} />
      </ActionForm>
    </Card>
  );
}
