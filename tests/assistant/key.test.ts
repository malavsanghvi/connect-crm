import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform-setup/server-config", () => ({ loadPlatformConfig: vi.fn(), platformValue: vi.fn() }));

import { assistantApiKey, assistantModelClient } from "@/lib/assistant/key";
import { loadPlatformConfig, platformValue } from "@/lib/platform-setup/server-config";

beforeEach(() => {
  vi.mocked(loadPlatformConfig).mockReset().mockResolvedValue(undefined);
  vi.mocked(platformValue).mockReset().mockReturnValue("");
});

describe("where the portal gets the AI key", () => {
  it("reads it the way every other platform key is read: the one saved in Platform › Setup, then the environment", async () => {
    vi.mocked(platformValue).mockImplementation((name) => (name === "ANTHROPIC_API_KEY" ? "sk-ant-saved" : ""));
    expect(await assistantApiKey()).toBe("sk-ant-saved");
    expect(loadPlatformConfig).toHaveBeenCalledTimes(1);
    expect(platformValue).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
  });

  it("has no client, and so no chat, without a key", async () => {
    expect(await assistantApiKey()).toBe("");
    expect(await assistantModelClient()).toBeNull();
  });

  it("makes a client when there is a key", async () => {
    vi.mocked(platformValue).mockReturnValue("sk-ant-saved");
    const client = await assistantModelClient();
    expect(client).not.toBeNull();
    expect(typeof client?.create).toBe("function");
  });
});
