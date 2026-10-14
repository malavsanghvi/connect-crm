"use client";

import { useMemo } from "react";

import type { MembershipActions } from "@/components/people-v2/slideover/membership-panels";
import { MembershipsSection, type PanelStart } from "@/components/people-v2/slideover/memberships-section";
import type { MembershipsData } from "@/lib/people-v2/memberships";
import type { Part } from "@/lib/people-v2/slideover";

// DEV ONLY. The Memberships section with fake writes, so each state can be drawn and checked without a database:
//   scenario  ok (default) | error | access     what the next write answers
// (the preview's "conflict" scenario is not a thing for memberships: it answers like "ok").

export type MembershipsScenario = "ok" | "conflict" | "error" | "access";

function fakeActions(scenario: MembershipsScenario): MembershipActions {
  const wait = () => new Promise((r) => setTimeout(r, 160));
  const fail = (doing: string) =>
    scenario === "access"
      ? ({ ok: false, error: "You don't have access to this area. Nothing was changed." } as const)
      : ({ ok: false, error: `Could not ${doing} — the database could not be reached — check the connection and try again.` } as const);
  return {
    async edit() {
      await wait();
      if (scenario === "error" || scenario === "access") return fail("save the membership");
      return { ok: true, message: "Membership saved · audit logged" };
    },
    async assign() {
      await wait();
      if (scenario === "error" || scenario === "access") return fail("assign the membership");
      return { ok: true, message: "Membership assigned · audit logged", membershipId: "m-new", feeRecorded: true };
    },
    async tier() {
      await wait();
      if (scenario === "error" || scenario === "access") return fail("change the membership tier");
      return { ok: true, message: "The family now holds a Life membership · audit logged" };
    },
  };
}

export function MembershipsPreview({
  data,
  person,
  timeZone,
  scenario,
  open,
}: {
  data: Part<MembershipsData>;
  person: { id: string; firstName: string };
  timeZone: string;
  scenario: MembershipsScenario;
  open?: PanelStart;
}) {
  const actions = useMemo(() => fakeActions(scenario), [scenario]);
  return <MembershipsSection data={data} person={person} timeZone={timeZone} actions={actions} open={open} />;
}
