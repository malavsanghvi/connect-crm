"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { ChipGroup } from "@/components/controls";
import { Card, InfoBox, buttonClass } from "@/components/ui";
import { RECEIPT_KINDS, receiptPreviewLines, type ReceiptKind } from "@/lib/giving";

import { saveReceiptTemplateAction } from "./actions";

export type TemplateValues = Record<ReceiptKind, { signedBy: string; note: string; updated: string | null }>;

const TONE = { navy: "text-navy", ink: "text-ink", muted: "text-muted" } as const;

/** Receipt template form (span 7) with the live preview beside it (span 5), prototype L604. */
export function ReceiptTemplateEditor({
  values,
  canEdit,
  centerName,
  centerAddress,
  year,
  currency,
}: {
  values: TemplateValues;
  canEdit: boolean;
  centerName: string;
  centerAddress: string | null;
  year: number;
  currency: string;
}) {
  const [kind, setKind] = useState<ReceiptKind>("donation_receipt");
  const [draft, setDraft] = useState(values);
  const cur = draft[kind];
  const set = (patch: Partial<{ signedBy: string; note: string }>) => setDraft((d) => ({ ...d, [kind]: { ...d[kind], ...patch } }));
  const lines = receiptPreviewLines({ kind, centerName, centerAddress, signedBy: cur.signedBy, note: cur.note, year, currency });

  return (
    <>
      <Card span={7} title="Receipt template" description={cur.updated ? `Last saved ${cur.updated}` : "Not customised yet — the standard wording is used"}>
        <ActionForm
          action={saveReceiptTemplateAction}
          submitLabel="Save template"
          pendingLabel="Saving…"
          hideSubmit={!canEdit}
          buttonsClassName="justify-end"
          extraButtons={
            <button
              type="button"
              disabled
              title="PDF rendering runs in the statements service, which is not connected to the console yet"
              className={buttonClass("off")}
            >
              Preview PDF
            </button>
          }
        >
          <input type="hidden" name="kind" value={kind} />
          <fieldset disabled={!canEdit} className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="crm-label">Template</p>
              <ChipGroup label="Template" value={kind} onChange={(v) => setKind(v as ReceiptKind)} options={RECEIPT_KINDS.map((k) => ({ value: k.kind, label: k.label }))} />
            </div>
            <div>
              <label htmlFor="rt-signed" className="crm-label">
                Signed by
              </label>
              <input
                id="rt-signed"
                name="signed_by"
                value={cur.signedBy}
                onChange={(e) => set({ signedBy: e.target.value })}
                placeholder={`Treasurer, ${centerName}`}
                maxLength={160}
                className="crm-input"
              />
            </div>
            <div>
              <label htmlFor="rt-note" className="crm-label">
                Personal note
              </label>
              <input
                id="rt-note"
                name="personal_note"
                value={cur.note}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="Anumodana for your generosity."
                maxLength={500}
                className="crm-input"
              />
            </div>
            <div>
              <p className="crm-label">Receipt name</p>
              <InfoBox>Payer by default · joint receipt on request</InfoBox>
            </div>
            <div>
              <p className="crm-label">Required wording</p>
              <InfoBox>Standard IRS acknowledgment; benefit disclosure when goods are received (to be confirmed by the accountant)</InfoBox>
            </div>
          </fieldset>
          {!canEdit ? <p className="mb-2 text-[13px] text-muted">Editing templates needs giving.manage.</p> : null}
          <p className="mb-2 text-xs text-muted">Preview PDF needs the statements service (a backend job), which the console cannot run yet.</p>
        </ActionForm>
      </Card>
      <Card span={5} title="Preview">
        <div className="flex flex-col gap-1.5 rounded-xl px-3.5 py-3 text-[13px] leading-[1.45]" style={{ background: "#FBF7F0" }}>
          {lines.map((l, i) => (
            <p key={i} className={`${TONE[l.tone]} ${l.strong ? "font-bold" : "font-medium"}`}>
              {l.text}
            </p>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Sample donor and amounts; the real receipt uses the payment&apos;s details.</p>
      </Card>
    </>
  );
}
