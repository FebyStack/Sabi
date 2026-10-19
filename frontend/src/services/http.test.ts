import { json } from "./http";

describe("json", () => {
  it("throws the server's error code, so the page can show why a request failed", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "busy" }), { status: 409 }));
    await expect(json("/api/x", { method: "PATCH" })).rejects.toThrow("busy");
    vi.unstubAllGlobals();
  });
});
