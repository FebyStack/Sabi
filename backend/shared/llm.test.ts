import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { FakeLlm, OllamaLlm, askJson } from "./llm";

type Seen = { path?: string; body?: unknown };

function serve(status: number, body: string, seen: Seen = {}): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen.path = req.url;
        seen.body = raw ? JSON.parse(raw) : undefined; // a GET has no body
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

const req = { system: "S", user: "U", format: { type: "object" } };

describe("OllamaLlm", () => {
  it("posts model, schema and messages to /api/chat and returns the content", async () => {
    const seen: Seen = {};
    const { server, url } = await serve(200, JSON.stringify({ message: { role: "assistant", content: '{"ok":true}' } }), seen);
    const out = await new OllamaLlm(url, "qwen2.5:3b").chat(req);
    server.close();
    expect(out).toBe('{"ok":true}');
    expect(seen.path).toBe("/api/chat");
    expect(seen.body).toMatchObject({
      model: "qwen2.5:3b", stream: false, format: { type: "object" }, options: { temperature: 0 },
      messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }],
    });
  });

  it("ignores a trailing slash in the base URL", async () => {
    const seen: Seen = {};
    const { server, url } = await serve(200, JSON.stringify({ message: { content: "{}" } }), seen);
    await new OllamaLlm(`${url}/`, "m").chat(req);
    server.close();
    expect(seen.path).toBe("/api/chat");
  });

  it("maps a 404 to llm_model_missing", async () => {
    const { server, url } = await serve(404, JSON.stringify({ error: "model 'qwen2.5:3b' not found" }));
    await expect(new OllamaLlm(url, "qwen2.5:3b").chat(req)).rejects.toThrow("llm_model_missing");
    server.close();
  });

  it("maps 500, a bad body and a down server to llm_unavailable, a timeout to llm_timeout", async () => {
    const { server: s500, url: u500 } = await serve(500, "boom");
    await expect(new OllamaLlm(u500, "m").chat(req)).rejects.toThrow("llm_unavailable");
    s500.close();

    const { server: sBad, url: uBad } = await serve(200, JSON.stringify({ message: {} }));
    await expect(new OllamaLlm(uBad, "m").chat(req)).rejects.toThrow("llm_unavailable");
    sBad.close();

    const hung = createServer(() => { /* never responds */ });
    await new Promise<void>((r) => hung.listen(0, "127.0.0.1", r));
    const uHung = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
    await expect(new OllamaLlm(uHung, "m", { timeoutMs: 200 }).chat(req)).rejects.toThrow("llm_timeout");
    hung.closeAllConnections(); hung.close();

    await expect(new OllamaLlm("http://127.0.0.1:1", "m").chat(req)).rejects.toThrow("llm_unavailable");
  });
});

describe("OllamaLlm.health", () => {
  it("reads /api/tags for the configured model", async () => {
    const tags = (names: string[]) => JSON.stringify({ models: names.map((name) => ({ name })) });
    const has = await serve(200, tags(["qwen2.5:3b", "llama3:latest"]));
    expect(await new OllamaLlm(has.url, "qwen2.5:3b").health()).toEqual({ status: "ok", model: "qwen2.5:3b" });
    expect(await new OllamaLlm(has.url, "llama3").health()).toEqual({ status: "ok", model: "llama3" }); // a bare name is :latest
    expect(await new OllamaLlm(has.url, "qwen2.5:7b").health()).toEqual({ status: "model_missing", model: "qwen2.5:7b" });
    has.server.close();
    expect(await new OllamaLlm("http://127.0.0.1:1", "m").health()).toEqual({ status: "down", model: "m" });
    expect(await new FakeLlm(() => ({})).health()).toEqual({ status: "ok", model: "fake" });
  });
});

describe("askJson", () => {
  const schema = z.object({ ok: z.boolean() });

  it("askJson retries once on invalid output", async () => {
    let n = 0;
    const llm = new FakeLlm(() => (n++ === 0 ? "not json" : { ok: true }));
    expect(await askJson(llm, schema, "S", { a: 1 })).toEqual({ ok: true });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0].user).toBe('{"a":1}');
    expect(llm.calls[0].format).toMatchObject({ type: "object", properties: { ok: { type: "boolean" } } });
    expect(llm.calls[1].user).toContain("rejected");
  });

  it("askJson throws llm_invalid_output after two bad answers", async () => {
    const llm = new FakeLlm(() => ({ ok: "yes" }));
    await expect(askJson(llm, schema, "S", {})).rejects.toThrow("llm_invalid_output");
    expect(llm.calls).toHaveLength(2);
  });

  it("askJson does not retry transport errors", async () => {
    const llm = new FakeLlm(() => { throw new Error("llm_unavailable"); });
    await expect(askJson(llm, schema, "S", {})).rejects.toThrow("llm_unavailable");
    expect(llm.calls).toHaveLength(1);
  });
});
