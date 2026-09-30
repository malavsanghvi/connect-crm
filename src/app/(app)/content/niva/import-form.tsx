"use client";

import { ActionForm } from "@/components/action-form";

import { importNivaPagesAction } from "./actions";

/** content.draft: give Niva web pages to learn from (app.niva_import_pages). Sections arrive as drafts. */
export function ImportPagesForm() {
  return (
    <ActionForm action={importNivaPagesAction} submitLabel="Import pages" pendingLabel="Queuing…">
      <label htmlFor="niva-import-urls" className="crm-label">
        Web page addresses, one per line (up to 50)
      </label>
      <textarea
        id="niva-import-urls"
        name="urls"
        rows={5}
        required
        placeholder={"https://www.example.org/about-us\nhttps://www.example.org/faq"}
        className="crm-input font-mono text-[13px]"
      />
    </ActionForm>
  );
}
