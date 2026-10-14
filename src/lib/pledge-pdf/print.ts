// Printing a pledge from the browser (Giving › Pledges › ⋯ › Print…): fetch the PDF the server draws, hand it to the browser's print
// dialog through a hidden frame, and where a browser will not print a frame, open the PDF in a new tab (its own print button).
// Nothing here is silent: a PDF that cannot be made, or a window the browser blocks, comes back as a plain sentence for the person,
// and the button offers a retry. Client-side; the fetch, the frame and the tab are injected so the tests can use fakes.

/** The address that draws one pledge's PDF (the route in src/app/(app)/giving/pledges/[id]/pdf). */
export function pledgePdfAddress(pledgeId: string): string {
  return `/giving/pledges/${encodeURIComponent(pledgeId)}/pdf`;
}

export type PdfFetch = { ok: true; blob: Blob } | { ok: false; error: string };

/** Asks the server for the PDF. Anything but a PDF is a sentence: the server's own when it sent one, else a general one. */
export async function fetchPledgePdf(pledgeId: string, fetcher: typeof fetch = fetch): Promise<PdfFetch> {
  try {
    const res = await fetcher(pledgePdfAddress(pledgeId), { credentials: "same-origin", cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.toLowerCase().includes("application/pdf")) return { ok: true, blob: await res.blob() };
    const text = (await res.text().catch(() => "")).trim();
    // The server's own sentences start "Could not make the pledge PDF"; an error page of a proxy is not shown.
    if (/^could not /i.test(text) && text.length < 400) return { ok: false, error: text };
    if (res.status === 401) return { ok: false, error: "Could not make the pledge PDF — your session has expired. Sign in again." };
    return { ok: false, error: `Could not make the pledge PDF — the server answered ${res.status}. Try again.` };
  } catch {
    return { ok: false, error: "Could not make the pledge PDF — the server could not be reached. Check the connection and try again." };
  }
}

export type PrintFrame = { print(): void; remove(): void };

export type PrintEnv = {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** A hidden frame showing the PDF; `onLoad` runs once it has loaded. */
  addFrame(url: string, onLoad: () => void): PrintFrame;
  /** Opens the PDF in a new tab; false when the browser blocked it. */
  openTab(url: string): boolean;
  later(fn: () => void, ms: number): void;
};

export type PrintResult = { ok: true; via: "dialog" | "tab" } | { ok: false; error: string };

/** How long to wait for the frame before opening the tab instead, and how long the frame stays for the print dialog. */
export const FRAME_WAIT_MS = 10_000;
export const FRAME_KEEP_MS = 120_000;

export function printPledgePdf(blob: Blob, env: PrintEnv): Promise<PrintResult> {
  return new Promise<PrintResult>((resolve) => {
    let url: string;
    try {
      url = env.createObjectURL(blob);
    } catch {
      resolve({ ok: false, error: "Could not print the pledge — the browser could not open the PDF. Try again." });
      return;
    }
    let settled = false;
    let frame: PrintFrame | null = null;
    const finish = (r: PrintResult, keepMs: number) => {
      if (settled) return;
      settled = true;
      env.later(() => {
        frame?.remove();
        env.revokeObjectURL(url);
      }, keepMs);
      resolve(r);
    };
    const tab = () => {
      frame?.remove();
      frame = null;
      if (env.openTab(url)) finish({ ok: true, via: "tab" }, FRAME_KEEP_MS);
      else finish({ ok: false, error: "Could not open the pledge to print it — your browser blocked the new window. Allow pop-ups for this site, then try again." }, 0);
    };
    try {
      frame = env.addFrame(url, () => {
        if (settled) return;
        try {
          frame?.print();
          finish({ ok: true, via: "dialog" }, FRAME_KEEP_MS);
        } catch {
          tab();
        }
      });
    } catch {
      tab();
      return;
    }
    env.later(() => {
      if (!settled) tab();
    }, FRAME_WAIT_MS);
  });
}

/** The real browser's frame, tab and clock. */
export function browserPrintEnv(): PrintEnv {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    addFrame(url, onLoad) {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
      frame.onload = onLoad;
      frame.src = url;
      document.body.appendChild(frame);
      return {
        print() {
          const w = frame.contentWindow;
          if (!w) throw new Error("no window");
          w.focus();
          w.print();
        },
        remove() {
          frame.remove();
        },
      };
    },
    // Not "noopener": that makes window.open answer null even when the tab opened, and a blocked window could not be told apart.
    openTab: (url) => window.open(url, "_blank") !== null,
    later: (fn, ms) => {
      window.setTimeout(fn, ms);
    },
  };
}
