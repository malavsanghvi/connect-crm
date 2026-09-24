"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Toggle } from "@/components/controls";
import { Drawer } from "@/components/drawer";
import { buttonClass } from "@/components/ui";
import { PRACTICE_CATEGORIES } from "@/lib/content";

import { savePracticeAction } from "../actions";

type Practice = {
  id: string;
  name: string;
  key: string;
  category: string;
  description: string | null;
  default_time: string | null;
  default_minutes: number | null;
  points: number;
  sort_order: number;
  active: boolean;
};

export function PracticeButton({ label, practice }: { label: string; practice?: Practice }) {
  const [open, setOpen] = useState(false);
  const p = practice;
  const id = p ? `pf-${p.id.slice(0, 8)}` : "pf-new";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(p ? "ghost" : "primary", p ? "xs" : "md")}>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} kicker="Practice catalog" title={p ? p.name : "New practice"}>
        <ActionForm action={savePracticeAction} submitLabel={p ? "Save practice" : "Add practice"} resetOnSuccess={!p}>
          {p ? <input type="hidden" name="id" value={p.id} /> : null}
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label htmlFor={`${id}-name`} className="crm-label">
                Practice
              </label>
              <input id={`${id}-name`} name="name" required defaultValue={p?.name ?? ""} className="crm-input" />
            </div>
            <div className="col-span-2">
              <label htmlFor={`${id}-cat`} className="crm-label">
                Category
              </label>
              <select id={`${id}-cat`} name="category" required defaultValue={p?.category ?? PRACTICE_CATEGORIES[0].key} className="crm-input">
                {PRACTICE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-time`} className="crm-label">
                Default time
              </label>
              <input id={`${id}-time`} type="time" name="default_time" defaultValue={p?.default_time?.slice(0, 5) ?? ""} className="crm-input" />
              <p className="crm-hint">Blank = anytime or relative to the sun</p>
            </div>
            <div>
              <label htmlFor={`${id}-pts`} className="crm-label">
                Points
              </label>
              <input id={`${id}-pts`} name="points" inputMode="numeric" defaultValue={p?.points ?? 5} className="crm-input" />
            </div>
            <div>
              <label htmlFor={`${id}-min`} className="crm-label">
                Minutes
              </label>
              <input id={`${id}-min`} name="default_minutes" inputMode="numeric" defaultValue={p?.default_minutes ?? ""} className="crm-input" />
            </div>
            <div>
              <label htmlFor={`${id}-ord`} className="crm-label">
                Order
              </label>
              <input id={`${id}-ord`} name="sort_order" inputMode="numeric" defaultValue={p?.sort_order ?? 0} className="crm-input" />
            </div>
            <div className="col-span-2">
              <label htmlFor={`${id}-key`} className="crm-label">
                Short key
              </label>
              <input id={`${id}-key`} name="key" defaultValue={p?.key ?? ""} placeholder="made from the name when blank" className="crm-input" />
            </div>
            <div className="col-span-2">
              <label htmlFor={`${id}-desc`} className="crm-label">
                Description
              </label>
              <input id={`${id}-desc`} name="description" defaultValue={p?.description ?? ""} className="crm-input" />
            </div>
            <div className="col-span-2">
              <Toggle name="active" label="Active" defaultChecked={p?.active ?? true} onNote="Shown in My Jain Way" offNote="Hidden from members" />
            </div>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}
