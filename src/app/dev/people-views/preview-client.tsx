"use client";

import { useMemo, type ReactNode } from "react";

import { fixtureSearch } from "@/app/dev/people-home/fixtures";
import { FindBackendContext } from "@/components/people-v2/find/find-backend";
import { SavedActionsProvider, type SavedActions } from "@/components/people-v2/saved/saved-actions";
import { readsAsFilter } from "@/lib/find/classify";
import { showText } from "@/lib/people-v2/ask";
import { cleanViewName, sameViewName, viewToSave } from "@/lib/people-v2/saved-views";

import { gapRows, SAVED_NAMES, ZONES } from "./fixtures";

// DEV ONLY. The saved-views screens with fake writes, so each state can be drawn and checked without a database: every write waits a
// moment and then either works or (with ?fail=1) fails the way a lost connection does. The find box reads the invented people and
// counts the adults a contact-gap sentence finds ("Show 5 adults with no email").

const DOWN = "the database could not be reached — check the connection and try again.";
const wait = () => new Promise((r) => setTimeout(r, 350));

function fakeActions(fail: boolean): SavedActions {
  return {
    async save(input) {
      await wait();
      if (fail) return { ok: false, error: `Could not save the view — ${DOWN}` };
      const checked = viewToSave({ ...input, sort: input.sort ?? null });
      if (!checked.ok) return { ok: false, error: checked.error };
      if (SAVED_NAMES.some((n) => sameViewName(n, checked.view.name))) {
        return { ok: false, error: `You already have a saved view called “${checked.view.name}”. Choose another name, or delete that one first.` };
      }
      return { ok: true, message: `Saved “${checked.view.name}”.`, data: { id: "new-view", name: checked.view.name } };
    },
    async rename(input) {
      await wait();
      if (fail) return { ok: false, error: `Could not rename the view — ${DOWN}` };
      const name = cleanViewName(input.name);
      if (!name.ok) return { ok: false, error: name.error };
      return { ok: true, message: `Renamed to “${name.name}”.`, data: { id: input.id, name: name.name } };
    },
    async remove() {
      await wait();
      if (fail) return { ok: false, error: `Could not delete the view — ${DOWN}` };
      return { ok: true, message: "Deleted. Only your saved view is gone: no family or person was changed." };
    },
    async pin(input) {
      await wait();
      if (fail) return { ok: false, error: `Could not ${input.pinned ? "pin" : "unpin"} the family — ${DOWN}` };
      return { ok: true, message: input.pinned ? "Pinned. It is at the top of the People home." : "Unpinned.", data: { pinned: input.pinned } };
    },
  };
}

export function PreviewSaved({ fail, children }: { fail: boolean; children: ReactNode }) {
  const actions = useMemo(() => fakeActions(fail), [fail]);
  const search = useMemo(
    () => async (q: string) => {
      const res = fixtureSearch(q, { finance: false, fail: false, problem: false });
      const filter = res.ok ? res.data.filter : null;
      if (res.ok && filter?.list === "people") {
        const reading = readsAsFilter(q, { zones: ZONES, year: 2026 });
        const label = reading ? showText(reading.filters, gapRows({ ...reading.filters, q: null }).total) : null;
        if (label) return { ok: true as const, data: { ...res.data, filter: { ...filter, label } } };
      }
      return res;
    },
    [],
  );
  return (
    <FindBackendContext.Provider value={search}>
      <SavedActionsProvider actions={actions}>{children}</SavedActionsProvider>
    </FindBackendContext.Provider>
  );
}
