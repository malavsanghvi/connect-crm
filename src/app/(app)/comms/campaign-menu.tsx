"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { ActionForm } from "@/components/action-form";
import { buttonClass } from "@/components/ui";
import { channelsLine, TEMPLATE_NOTE, templateChannelNote, type MenuItem, type MenuKey } from "@/lib/comms-templates";

import { CommsDialog } from "./dialog";
import { useStartDraft } from "./start-draft";
import { copyCampaignAction, saveTemplateAction } from "./template-actions";

export type MenuCampaign = { id: string; label: string; defaultTemplateName: string; channels: string[] };

const ITEM = "flex min-h-11 w-full flex-col justify-center rounded-xl px-3 py-1.5 text-left text-[14.5px] font-semibold text-ink hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none";

/**
 * What can be done with a communication in the list and on its own page: Copy as new draft, Save as template. The server decides
 * which items there are (campaignMenu: the permission, the kind and the channels the community has), so a person who may not copy
 * sees nothing here. "menu" is the ⋯ menu of a list row; "buttons" is the pair of buttons on an open communication.
 */
export function CampaignActions({ campaign, items, layout }: { campaign: MenuCampaign; items: MenuItem[]; layout: "menu" | "buttons" }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const draft = useStartDraft();
  const doing = "copy the communication";
  const copy = () => draft.run(copyCampaignAction, campaign.id, doing, () => setOpen(false));
  const choose = (key: MenuKey) => {
    if (key === "copy") copy();
    else {
      setOpen(false);
      setDialog(true);
    }
  };
  if (items.length === 0) return null;

  return (
    <>
      {layout === "buttons" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {items.map((i) => (
              <button
                key={i.key}
                type="button"
                title={i.hint}
                disabled={draft.pending && i.key === "copy"}
                onClick={() => choose(i.key)}
                className={buttonClass("ghost", "md")}
              >
                {i.key === "copy" && draft.pending ? "Copying…" : i.label}
              </button>
            ))}
          </div>
          {draft.error ? (
            <p role="alert" className="mt-2 w-full rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {draft.error}{" "}
              <button type="button" onClick={copy} className={`${buttonClass("bad", "xs")} align-middle`}>
                Try again
              </button>
            </p>
          ) : null}
        </>
      ) : (
        <RowMenu
          label={campaign.label}
          items={items}
          open={open}
          setOpen={setOpen}
          pending={draft.pending}
          error={draft.error}
          onChoose={choose}
          onRetry={copy}
        />
      )}
      {dialog ? <SaveTemplateDialog campaign={campaign} onClose={() => setDialog(false)} /> : null}
    </>
  );
}

function RowMenu({
  label,
  items,
  open,
  setOpen,
  pending,
  error,
  onChoose,
  onRetry,
}: {
  label: string;
  items: MenuItem[];
  open: boolean;
  setOpen: (v: boolean) => void;
  pending: boolean;
  error: string | null;
  onChoose: (key: MenuKey) => void;
  onRetry: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  // The menu is drawn on the page (not inside the table, which scrolls sideways and would clip it) just under its button.
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (rect) setAt({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, setOpen]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const live = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (live.length === 0) return;
    e.preventDefault();
    const idx = live.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (idx + 1) % live.length : (idx - 1 + live.length) % live.length;
    live[next]?.focus();
  }

  return (
    <div className="inline-block" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More about ${label}`}
        onClick={toggle}
        className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy md:size-9"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && at
        ? createPortal(
            <ul
              ref={menu}
              id={menuId}
              role="menu"
              aria-label={`More about ${label}`}
              style={{ position: "fixed", top: at.top, right: at.right }}
              className="z-[60] m-0 w-[min(20rem,calc(100vw-1rem))] list-none rounded-2xl border border-line bg-white p-1.5 text-left shadow-menu"
            >
              {items.map((i) => (
                <li key={i.key} role="none">
                  <button type="button" role="menuitem" disabled={pending && i.key === "copy"} onClick={() => onChoose(i.key)} className={ITEM}>
                    <span>{i.key === "copy" && pending ? "Copying…" : i.label}</span>
                    <span className="text-[12px] font-normal text-muted">{i.hint}</span>
                  </button>
                </li>
              ))}
              {error ? (
                <li role="none" className="px-2 pb-1 pt-2">
                  <p role="alert" className="m-0 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] font-normal text-danger">
                    {error}
                  </p>
                  <button type="button" onClick={onRetry} className={`${buttonClass("bad", "xs")} mt-2`}>
                    Try again
                  </button>
                </li>
              ) : null}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Asks for a name (the communication's own by default) and saves its words as a template. The dialog stays open on a failure, with the reason and the same button to try again. */
function SaveTemplateDialog({ campaign, onClose }: { campaign: MenuCampaign; onClose: () => void }) {
  const nameId = useId();
  const caveat = templateChannelNote(campaign.channels);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <CommsDialog kicker="Saved templates" title="Save as template" onClose={onClose}>
      <ActionForm
        action={saveTemplateAction}
        submitLabel="Save template"
        pendingLabel="Saving…"
        className="flex flex-col gap-3"
        buttonsClassName="justify-end"
        onSuccess={onClose}
        extraButtons={
          <button type="button" onClick={onClose} className={buttonClass("ghost", "modal")}>
            Cancel
          </button>
        }
      >
        <input type="hidden" name="id" value={campaign.id} />
        <div>
          <label htmlFor={nameId} className="crm-label">
            Template name
          </label>
          <input ref={input} id={nameId} name="name" required maxLength={120} defaultValue={campaign.defaultTemplateName} className="crm-input" />
        </div>
        <p className="crm-hint m-0">
          From &ldquo;{campaign.label}&rdquo; · {channelsLine(campaign.channels)}. {TEMPLATE_NOTE}
        </p>
        {caveat ? (
          <p role="note" className="m-0 rounded-[10px] border border-saffron/40 bg-saffron-50 px-3 py-2 text-[13px] text-brown-900">
            {caveat}
          </p>
        ) : null}
      </ActionForm>
    </CommsDialog>
  );
}
