"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Toggle } from "@/components/controls";

import { saveLayerAction } from "./actions";

/** Inline edit of a center layer: default on/off and who maintains it. */
export function LayerEdit({ layerId, name, defaultOn, owner }: { layerId: string; name: string; defaultOn: boolean; owner: string }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <ActionForm action={saveLayerAction.bind(null, layerId)} submitLabel="Save" size="xs" variant="ghost" className="flex flex-wrap items-center gap-2" buttonsClassName="">
      <input
        name="owner_label"
        defaultValue={owner}
        maxLength={80}
        aria-label={`Owner of ${name}`}
        placeholder="e.g. Religious coordinator"
        className="crm-input h-[30px] min-h-0 w-48 py-1 text-[13px]"
      />
      <Toggle name="default_on" label={`${name} on by default`} checked={on} onChange={setOn} onNote="On" offNote="Off" />
    </ActionForm>
  );
}
