"use client";

import { useState } from "react";

import { GrantForm, type RoleOption } from "@/app/(app)/settings/roles/grant-form";
import { Drawer } from "@/components/drawer";
import { buttonClass } from "@/components/ui";

/**
 * "[Assign lead]" — the existing role-grant flow (Settings › Roles and access),
 * limited to the Zone lead role for this one zone. Needs roles.manage.
 */
export function ZoneLeadButton({
  zone,
  role,
  orgMemberLabel,
  today,
  label = "Assign lead",
}: {
  zone: { id: string; name: string };
  role: RoleOption;
  orgMemberLabel: string;
  today: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("warn", "xs")}>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} kicker="Zone lead" title={`${zone.name} zone`} subtitle="The lead answers the zone inbox and sees the zone's families.">
        <GrantForm roles={[role]} scopes={{ zone: [{ id: zone.id, label: zone.name }], event: [], class: [] }} orgMemberLabel={orgMemberLabel} today={today} />
      </Drawer>
    </>
  );
}
