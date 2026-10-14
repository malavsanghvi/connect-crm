import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every staff page renders inside Niva's provider, so these tests are about what must NEVER happen: a blank portal, a stolen
// browser shortcut, or anything showing in a community that has Niva off. Nothing here talks to a server.
vi.mock("next/navigation", () => ({
  usePathname: () => "/giving/payments",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { NivaBoundary, reportNivaFailure, resetNivaReports } from "@/components/niva/niva-boundary";
import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { NivaDock } from "@/components/niva/niva-dock";
import { NivaProvider, NivaScope } from "@/components/niva/niva-provider";
import { NivaTopButton } from "@/components/niva/niva-top-button";
import { initialChatState } from "@/lib/assistant/chat-state";
import { fetchCommands } from "@/lib/assistant/client";
import { safeRouteContext } from "@/lib/assistant/context";
import { COMMANDS_LOADING, commandsGate } from "@/lib/assistant/gate";
import { KILL_KEY, nivaSwitchedOffHere } from "@/lib/assistant/kill-switch";
import { attachShortcuts, type KeyTarget } from "@/lib/assistant/shortcuts";

import { commandsOn, fakeFetch, json, sampleCommands } from "./fake-server";

const noop = () => {};
// createElement with the children as the third argument (the rule against a children prop, without the typing getting in the way).
const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;

function api(over: Partial<NivaApi> = {}): NivaApi {
  return {
    enabled: false,
    aiReady: false,
    aiOff: false,
    commands: [],
    nav: [],
    context: { path: "/" },
    dockOpen: false,
    paletteOpen: false,
    paletteQuery: "",
    openDock: noop,
    closeDock: noop,
    toggleDock: noop,
    openPalette: noop,
    closePalette: noop,
    chat: initialChatState,
    send: noop,
    stop: noop,
    retry: noop,
    newChat: noop,
    ask: noop,
    showResult: noop,
    showProposal: noop,
    ...over,
  };
}

afterEach(() => {
  resetNivaReports();
  vi.restoreAllMocks();
});

describe("the error boundary", () => {
  it("shows nothing after a failure, and shows the children before one", () => {
    const children = createElement("p", null, "Niva");
    const ok = new NivaBoundary({ name: "panel", children });
    expect(ok.render()).toBe(children);

    // What React does when a child throws: it asks for the new state, then renders again.
    const failed = new NivaBoundary({ name: "panel", children });
    failed.state = { ...failed.state, ...NivaBoundary.getDerivedStateFromError() };
    expect(failed.render()).toBeNull();
  });

  it("logs a failure once, however often the same part fails", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new NivaBoundary({ name: "panel", children: null });
    boundary.componentDidCatch(new Error("boom"));
    boundary.componentDidCatch(new Error("boom again"));
    reportNivaFailure("panel", new Error("and again"));
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("the panel hit an error and was hidden");
    // A different part is reported on its own.
    reportNivaFailure("top bar button", new Error("x"));
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("renders a healthy child unchanged", () => {
    expect(renderToStaticMarkup(h(NivaBoundary, { name: "panel" }, createElement("b", null, "hello")))).toBe("<b>hello</b>");
  });
});

describe("the provider is a pass-through until Niva is on", () => {
  const page = createElement("main", null, createElement("h1", null, "Giving"), createElement("p", null, "Payments"));
  const pageHtml = "<main><h1>Giving</h1><p>Payments</p></main>";

  it("renders the page exactly as it was before the first answer arrives", () => {
    expect(renderToStaticMarkup(h(NivaProvider, { nav: [] }, page))).toBe(pageHtml);
  });

  it("a failed or refused commands call means off, and off renders the page unchanged with nothing of Niva", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as never;
    for (const f of [down, fakeFetch({}), fakeFetch({ "/api/assistant/commands": () => json({ ok: false, error: "No" }, 403) })]) {
      const state = commandsGate(await fetchCommands(f));
      expect(state).toEqual({ status: "off" });
    }
    const off = api({ enabled: commandsGate(null).status === "on" });
    expect(renderToStaticMarkup(h(NivaScope, { value: off }, page))).toBe(pageHtml);
    for (const part of [NivaTopButton, NivaDock]) {
      expect(renderToStaticMarkup(createElement(NivaContext.Provider, { value: off }, createElement(part)))).toBe("");
    }
  });

  it("a community with Niva switched off is off", async () => {
    const res = await fetchCommands(fakeFetch({ "/api/assistant/commands": () => json({ ok: true, enabled: false, aiReady: true, commands: [] }) }));
    expect(commandsGate(res)).toEqual({ status: "off" });
    expect(COMMANDS_LOADING.status).toBe("loading");
  });

  it("only a clear enabled:true turns it on", async () => {
    const res = await fetchCommands(fakeFetch({ "/api/assistant/commands": () => json(commandsOn()) }));
    expect(commandsGate(res).status).toBe("on");
    expect(commandsGate({ ...commandsOn(), enabled: "yes" as never }).status).toBe("off");
  });

  it("when on, the page is still the first thing rendered, in the same place", () => {
    const on = api({ enabled: true, aiReady: true, commands: sampleCommands });
    expect(renderToStaticMarkup(h(NivaScope, { value: on }, page))).toBe(pageHtml);
  });

  it("an address or parameters it cannot read give the home path, not an error", () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("no"); } });
    expect(safeRouteContext("/events/abc", hostile as never)).toEqual({ path: "/" });
    expect(safeRouteContext(null, undefined)).toEqual({ path: "/" });
    expect(safeRouteContext("/events", {})).toEqual({ path: "/events" });
  });
});

describe("the kill switch", () => {
  it("hides Niva in a browser where niva.off is 1", () => {
    expect(KILL_KEY).toBe("niva.off");
    expect(nivaSwitchedOffHere({ getItem: (k) => (k === "niva.off" ? "1" : null) })).toBe(true);
  });

  it("anything else leaves it alone", () => {
    expect(nivaSwitchedOffHere({ getItem: () => null })).toBe(false);
    expect(nivaSwitchedOffHere({ getItem: () => "0" })).toBe(false);
    expect(nivaSwitchedOffHere({ getItem: () => "true" })).toBe(false);
    expect(nivaSwitchedOffHere(null)).toBe(false);
  });

  it("never throws when storage is blocked or missing", () => {
    expect(
      nivaSwitchedOffHere({
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      }),
    ).toBe(false);
    // In this test environment there is no localStorage at all.
    expect(nivaSwitchedOffHere()).toBe(false);
  });
});

describe("the keyboard shortcuts", () => {
  function fakeDocument() {
    const listeners = new Set<(e: KeyboardEvent) => void>();
    const target: KeyTarget = {
      addEventListener: (_type, fn) => void listeners.add(fn),
      removeEventListener: (_type, fn) => void listeners.delete(fn),
    };
    return { target, listeners };
  }
  const press = (key: string, over: Partial<KeyboardEvent> = {}) => {
    const preventDefault = vi.fn();
    return { event: { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault, ...over } as unknown as KeyboardEvent, preventDefault };
  };

  it("registers nothing when Niva is off, so the browser keeps Ctrl+K and Ctrl+J", () => {
    const doc = fakeDocument();
    const onShortcut = vi.fn();
    const off = attachShortcuts(doc.target, false, onShortcut);
    expect(doc.listeners.size).toBe(0);
    expect(() => off()).not.toThrow();
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it("registers them when on, takes the two keys, and removes them again", () => {
    const doc = fakeDocument();
    const onShortcut = vi.fn();
    const off = attachShortcuts(doc.target, true, onShortcut);
    expect(doc.listeners.size).toBe(1);
    const [listener] = [...doc.listeners];

    const k = press("k");
    listener(k.event);
    expect(onShortcut).toHaveBeenLastCalledWith("palette");
    expect(k.preventDefault).toHaveBeenCalled();

    const j = press("J", { ctrlKey: false, metaKey: true });
    listener(j.event);
    expect(onShortcut).toHaveBeenLastCalledWith("panel");

    off();
    expect(doc.listeners.size).toBe(0);
  });

  it("leaves every other key, and keys pressed with Shift or Alt, to the browser", () => {
    const doc = fakeDocument();
    const onShortcut = vi.fn();
    attachShortcuts(doc.target, true, onShortcut);
    const [listener] = [...doc.listeners];
    for (const e of [press("p"), press("k", { shiftKey: true }), press("k", { altKey: true }), press("k", { ctrlKey: false })]) {
      listener(e.event);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it("does not take over while the security-code window (or another dialog) is open", () => {
    const doc = fakeDocument();
    const onShortcut = vi.fn();
    attachShortcuts(doc.target, true, onShortcut, () => true);
    const [listener] = [...doc.listeners];
    const k = press("k");
    listener(k.event);
    expect(onShortcut).not.toHaveBeenCalled();
    expect(k.preventDefault).not.toHaveBeenCalled();
  });
});
