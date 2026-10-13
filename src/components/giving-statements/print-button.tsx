"use client";

// Opens the browser's print dialog, where the copy is printed or saved as a PDF. There is no receipt generator in the portal (the
// statements service will make PDFs); printing the page is the honest way to hand over a copy today.

import { buttonClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={`${buttonClass("primary")} min-h-[44px] print:hidden`} data-testid="receipt-print">
      Print or save as PDF
    </button>
  );
}
