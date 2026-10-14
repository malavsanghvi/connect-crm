"use client";

import { createContext, useContext, type ReactNode } from "react";

import { NO_CUSTOM_ACCESS, type CustomFieldsPayload } from "@/lib/people-v2/custom-fields";

// The community's custom fields, as the server read them for this page (src/lib/people-v2/custom-load.ts). The Family page gives them
// to its people cards and the household card through this context; the slide-over gets the same payload as a prop. Outside a provider
// (a page that did not read them) a card simply draws no custom group. D2: this never holds anything the assistant is given.

const Ctx = createContext<CustomFieldsPayload | null>(null);

export function CustomFieldsProvider({ payload, children }: { payload: CustomFieldsPayload | null | undefined; children: ReactNode }) {
  return <Ctx.Provider value={payload ?? null}>{children}</Ctx.Provider>;
}

export function useCustomFields(): CustomFieldsPayload | null {
  return useContext(Ctx);
}

/**
 * What a group says when it cannot show fields: this role may not read them ("You don't have access to this area", never an empty
 * group), or the read failed (in words, with how to try again). Null when the payload is fine.
 */
export function CustomFieldsNote({ payload }: { payload: Exclude<CustomFieldsPayload, { state: "ok" }> }): ReactNode {
  if (payload.state === "no-access") return <p className="m-0 py-1 text-[14px] text-muted">{NO_CUSTOM_ACCESS}</p>;
  return (
    <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      {payload.message} Reload the page to try again.
    </p>
  );
}
