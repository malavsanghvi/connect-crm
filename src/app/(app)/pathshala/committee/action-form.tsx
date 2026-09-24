import { ActionForm } from "@/components/action-form";
import { PersonPicker } from "@/components/person-picker";
import type { Tables } from "@/lib/database.types";

import { searchPeopleAction } from "../actions";
import { Checkbox, FormGrid, PField, Select } from "../ui";
import { createAction, updateAction } from "./actions";

type Opt = { id: string; name: string; detail: string | null };

export function ActionEditor({
  action,
  events,
  owner,
  backups,
  defaultEventId,
  defaultPhase,
  openAfterCreate,
}: {
  action: Tables<"actions"> | null;
  events: { id: string; name: string; starts_at: string | null }[];
  owner: Opt | null;
  backups: Opt[];
  defaultEventId?: string | null;
  defaultPhase?: string | null;
  openAfterCreate?: boolean;
}) {
  return (
    <ActionForm buttonsClassName="mt-3"
      action={action ? updateAction.bind(null, action.id) : createAction}
      submitLabel={action ? "Save action" : "Add action"}
      resetOnSuccess={!action}
      variant="primary"
    >
      {!action && openAfterCreate && <input type="hidden" name="then" value="open" />}
      <FormGrid>
        <PField label="Action" className="sm:col-span-2">
          <input name="name" required defaultValue={action?.name ?? ""} className="crm-input" />
        </PField>
        <PField label="Event" hint="Leave empty for a standalone action">
          <Select
            name="event_id"
            defaultValue={action?.event_id ?? defaultEventId ?? ""}
            placeholder="No event (standalone)"
            options={events.map((e) => ({ value: e.id, label: `${e.name}${e.starts_at ? ` · ${e.starts_at.slice(0, 10)}` : ""}` }))}
          />
        </PField>
        <PField label="Phase" hint="“During” actions always use the event date">
          <Select
            name="phase"
            defaultValue={action?.phase ?? defaultPhase ?? ""}
            placeholder="—"
            options={[
              { value: "pre", label: "Before the event" },
              { value: "during", label: "During the event" },
              { value: "after", label: "After the event" },
            ]}
          />
        </PField>
        <PersonPicker search={searchPeopleAction} name="owner_person_id" label="Owner" initial={owner ? [owner] : []} />
        <PersonPicker search={searchPeopleAction} name="backup_owner_ids" label="Backups" multiple initial={backups} />
        <PField label="Due date">
          <input type="date" name="due_on" defaultValue={action?.due_on ?? ""} className="crm-input" />
        </PField>
        <PField label="Priority">
          <Select
            name="priority"
            defaultValue={action?.priority ?? "medium"}
            options={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "critical", label: "Critical" },
            ]}
          />
        </PField>
        <PField label="Type">
          <Select
            name="action_type"
            defaultValue={action?.action_type ?? "task"}
            options={[
              { value: "task", label: "Task" },
              { value: "meeting", label: "Meeting" },
              { value: "email", label: "Email" },
              { value: "call", label: "Call" },
              { value: "whatsapp_announcement", label: "WhatsApp announcement" },
            ]}
          />
        </PField>
        {action && (
          <PField label="State">
            <Select
              name="state"
              defaultValue={action.state}
              options={[
                { value: "not_started", label: "Not started" },
                { value: "in_progress", label: "In progress" },
                { value: "completed", label: "Completed" },
                { value: "removed", label: "Removed" },
              ]}
            />
          </PField>
        )}
        <PField label="Details" className="sm:col-span-2">
          <textarea name="description" rows={3} defaultValue={action?.description ?? ""} className="crm-input" />
        </PField>
      </FormGrid>
      <div className="mt-2 flex flex-wrap gap-x-6">
        <Checkbox name="confidential" label="Confidential" hint="Hidden from members without confidential access" defaultChecked={action?.confidential ?? false} />
        <Checkbox name="is_idea" label="Just an idea (not on the dashboard)" defaultChecked={action?.is_idea ?? false} />
      </div>
    </ActionForm>
  );
}
