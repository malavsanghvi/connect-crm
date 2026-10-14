"use client";

import { useEffect, useMemo, useState } from "react";

import { AddFamilySheet, type AddFamilyActions } from "@/components/people-v2/add-family-sheet";

import { CJK_MATCHES, MATCHES, PREVIEW_COMMUNITY, type Scenario } from "./fixtures";

/** Sets a field the way a person typing would, so React sees it (dev preview only). */
function typeInto(label: string, value: string) {
  const el = Array.from(document.querySelectorAll<HTMLInputElement>("[data-testid=add-family-sheet] input")).find((i) => document.querySelector(`label[for="${i.id}"]`)?.textContent?.startsWith(label));
  if (!el) return;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const submitForm = () => document.querySelector<HTMLFormElement>("[data-testid=add-family-sheet] form")?.requestSubmit();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * DEV ONLY. The sheet with fake actions (no server, no database) and a scenario script that types and presses Enter for the screenshots:
 *   default   an empty sheet                      matches  "Priya Shah" and a mobile: three families that may already be this one
 *   confirm   after Enter: asks once more         nomatch  nothing alike yet
 *   error     the check fails (Try again)         adderror adding fails with a sentence
 *   noaccess  a role without people.manage        cjk      a name in Chinese and an Arabic-name spouse already here
 */
export function PreviewHarness({ scenario }: { scenario: Scenario }) {
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState<string[]>([]);

  const actions = useMemo<AddFamilyActions>(
    () => ({
      async check() {
        await wait(150);
        if (scenario === "error") return { ok: false, error: "Could not check for families that may already be here — the connection was lost." };
        if (scenario === "nomatch") return { ok: true, data: { total: 0, matches: [] } };
        if (scenario === "cjk") return { ok: true, data: { total: 1, matches: CJK_MATCHES } };
        if (scenario === "matches" || scenario === "confirm" || scenario === "adderror") return { ok: true, data: { total: 3, matches: MATCHES } };
        return { ok: true, data: { total: 0, matches: [] } };
      },
      async add(_prev, fd) {
        await wait(250);
        setLog((l) => [...l, `add ${String(fd.get("first_name"))} ${String(fd.get("last_name"))}${fd.get("none_of_these") ? " (none of these)" : ""}`]);
        if (scenario === "adderror") return { ok: false, error: "Could not add the family — the database did not answer. Nothing was added. Try again." };
        if (scenario === "noaccess") return { ok: false, error: "Could not add the family — you don't have permission (needs people.manage)." };
        return { ok: true, message: "Family added", data: { created: true, householdId: "55555555-5555-4555-8555-555555555555", personId: "66666666-6666-4666-8666-666666666666", householdNumber: "H-1201" } };
      },
    }),
    [scenario],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await wait(500);
      if (cancelled) return;
      if (scenario === "matches" || scenario === "confirm" || scenario === "error" || scenario === "adderror" || scenario === "nomatch") {
        typeInto("Mobile or email", "(512) 555-0188");
        await wait(900);
      }
      if (scenario === "confirm" || scenario === "adderror") {
        submitForm();
        await wait(300);
      }
      if (scenario === "adderror") {
        submitForm();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const name = scenario === "cjk" ? "李 明" : scenario === "default" || scenario === "noaccess" ? "" : "Priya Shah";
  return (
    <div className="min-h-screen bg-[var(--v2-page)] p-6">
      <div className="mx-auto max-w-[960px]">
        <p className="m-0 text-[12px] font-bold uppercase tracking-[0.04em] text-muted">DEV PREVIEW · SAMPLE DATA · {PREVIEW_COMMUNITY}</p>
        <h1 className="m-0 mt-1 font-display text-[30px] font-semibold text-ink">People</h1>
        <p className="m-0 mt-1 text-[14px] text-muted">The People home sits behind the sheet. Scenario: {scenario}.</p>
        {!open ? (
          <button type="button" className="cc-btn mt-4" onClick={() => setOpen(true)}>
            Add a family
          </button>
        ) : null}
        {log.length ? <pre className="mt-4 text-[12px] text-muted">{log.join("\n")}</pre> : null}
      </div>
      <AddFamilySheet
        open={open}
        onClose={() => setOpen(false)}
        initialName={name}
        canAdd={scenario !== "noaccess"}
        actions={actions}
        onAdded={(a) => {
          setLog((l) => [...l, `added ${a.householdId} (${a.householdNumber})`]);
          setOpen(false);
        }}
        onOpenFamily={(id) => {
          setLog((l) => [...l, `open ${id}`]);
          setOpen(false);
        }}
      />
    </div>
  );
}
