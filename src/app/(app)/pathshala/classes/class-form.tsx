import { ActionForm } from "@/components/action-form";
import type { Level } from "@/lib/data/pathshala";
import type { Tables } from "@/lib/database.types";

import { saveClass } from "../actions";
import { Checkbox, FormGrid, PField, Select } from "../ui";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function ClassForm({
  cls,
  terms,
  levels,
  defaultTermId,
  cols = 2,
}: {
  cls: Tables<"pathshala_classes"> | null;
  terms: { id: string; name: string }[];
  levels: Level[];
  defaultTermId: string | null;
  cols?: 1 | 2;
}) {
  const grouped = new Map<string, Level[]>();
  for (const l of levels) grouped.set(l.track_name, [...(grouped.get(l.track_name) ?? []), l]);
  return (
    <ActionForm action={saveClass.bind(null, cls?.id ?? null)} submitLabel={cls ? "Save class" : "Create class"} resetOnSuccess={!cls} buttonsClassName="mt-3">
      <FormGrid cols={cols}>
        <PField label="Term">
          <Select
            name="term_id"
            required
            defaultValue={cls?.term_id ?? defaultTermId}
            options={terms.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Choose a term"
          />
        </PField>
        <PField label="Level">
          <select name="level_id" required defaultValue={cls?.level_id ?? ""} className="crm-input">
            <option value="">Choose a level</option>
            {[...grouped.entries()].map(([track, ls]) => (
              <optgroup key={track} label={track}>
                {ls.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </PField>
        <PField label="Class name" hint="For example Level 1 · Balvarg">
          <input name="name" required defaultValue={cls?.name ?? ""} className="crm-input" />
        </PField>
        <PField label="Room">
          <input name="room" defaultValue={cls?.room ?? ""} className="crm-input" />
        </PField>
        <PField label="Capacity" hint="Leave blank for no limit">
          <input name="capacity" type="number" min={0} defaultValue={cls?.capacity ?? ""} className="crm-input" />
        </PField>
        <PField label="Meets on">
          <Select name="meets_on" defaultValue={cls?.meets_on ?? "sunday"} options={DAYS.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))} />
        </PField>
        <PField label="Starts">
          <input type="time" name="starts_time" defaultValue={cls?.starts_time?.slice(0, 5) ?? ""} className="crm-input" />
        </PField>
        <PField label="Ends">
          <input type="time" name="ends_time" defaultValue={cls?.ends_time?.slice(0, 5) ?? ""} className="crm-input" />
        </PField>
        <PField label="Class email (role mailbox)">
          <input type="email" name="class_email" defaultValue={cls?.class_email ?? ""} className="crm-input" />
        </PField>
      </FormGrid>
      <Checkbox name="waitlist_enabled" label="Waitlist when full" defaultChecked={cls?.waitlist_enabled ?? true} />
    </ActionForm>
  );
}
