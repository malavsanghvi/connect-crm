"use client";

import { ActionForm } from "@/components/action-form";

import { importNivaPagesAction, submitImportedNivaDraftsAction } from "./actions";

/**
 * content.draft: give Niva web pages to learn from (app.niva_import_pages). Sections arrive as drafts.
 * Since 0576 an address is written one way before duplicates are removed, and a page is saved under the
 * address it ends up at (after a redirect), so the www and plain forms of a page are one set of sources.
 */
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
        aria-describedby="niva-import-urls-hint"
        placeholder={"https://www.example.org/about-us\nhttps://www.example.org/faq"}
        className="crm-input font-mono text-[13px]"
      />
      <p id="niva-import-urls-hint" className="mt-1 text-[12px] text-muted">
        example.org/faq, www.example.org/faq/ and the same address with tracking tags (utm_…) are one page, imported once. Importing a page again
        refreshes its drafts and removes drafts the page no longer has. A section already sent for approval or published is never changed by an
        import: when the page now says something else, edit the section yourself.
      </p>
    </ActionForm>
  );
}

/** content.draft: one step from "imported drafts" to the Approval queue (they are still approved one by one there). */
export function SendImportedDraftsForm({ count }: { count: number }) {
  return (
    <ActionForm
      action={submitImportedNivaDraftsAction}
      submitLabel={`Send ${count} imported draft${count === 1 ? "" : "s"} for approval`}
      pendingLabel="Sending…"
      variant="ghost"
      size="sm"
      confirmMessage={`Send ${count} imported draft${count === 1 ? "" : "s"} to the Approval queue? Read them first: Niva repeats whatever is approved, and imported pages can contain dates or figures that are out of date.`}
    />
  );
}
