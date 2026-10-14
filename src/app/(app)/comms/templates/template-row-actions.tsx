"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ActionForm } from "@/components/action-form";
import { RowActions } from "@/components/row-actions";
import { buttonClass } from "@/components/ui";
import { MAX_TEMPLATE_NAME } from "@/lib/comms-templates";

import { CommsDialog } from "../dialog";
import { useStartDraft } from "../start-draft";
import { deleteTemplateAction, renameTemplateAction, startFromTemplateAction } from "../template-actions";

/** Use, rename and delete one saved template (the manage view). Each failure stays next to the buttons in plain English and can be tried again. */
export function TemplateRowActions({ id, name }: { id: string; name: string }) {
  const [renaming, setRenaming] = useState(false);
  const draft = useStartDraft();
  const startDraft = () => draft.run(startFromTemplateAction, id, "start from the template");

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={startDraft} disabled={draft.pending} className={buttonClass("primary", "xs")}>
          {draft.pending ? "Starting…" : "Use"}
        </button>
        <button type="button" onClick={() => setRenaming(true)} className={buttonClass("ghost", "xs")}>
          Rename
        </button>
        <RowActions
          action={deleteTemplateAction}
          fields={{ id }}
          buttons={[
            {
              label: "Delete",
              value: "delete",
              variant: "bad",
              confirm: `Delete the template "${name}"? Communications already made from it are not changed. This cannot be undone.`,
            },
          ]}
        />
      </div>
      {draft.error ? (
        <p role="alert" className="m-0 max-w-[26rem] rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-left text-[13px] text-danger">
          {draft.error}{" "}
          <button type="button" onClick={startDraft} disabled={draft.pending} className={`${buttonClass("bad", "xs")} align-middle`}>
            Try again
          </button>
        </p>
      ) : null}
      {renaming ? <RenameDialog id={id} name={name} onClose={() => setRenaming(false)} /> : null}
    </div>
  );
}

function RenameDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const nameId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <CommsDialog kicker="Saved templates" title="Rename template" onClose={onClose}>
      <ActionForm
        action={renameTemplateAction}
        submitLabel="Rename"
        pendingLabel="Saving…"
        className="flex flex-col gap-3 text-left"
        buttonsClassName="justify-end"
        onSuccess={onClose}
        extraButtons={
          <button type="button" onClick={onClose} className={buttonClass("ghost", "modal")}>
            Cancel
          </button>
        }
      >
        <input type="hidden" name="id" value={id} />
        <div>
          <label htmlFor={nameId} className="crm-label">
            Template name
          </label>
          <input ref={input} id={nameId} name="name" required maxLength={MAX_TEMPLATE_NAME} defaultValue={name} className="crm-input" />
        </div>
      </ActionForm>
    </CommsDialog>
  );
}
