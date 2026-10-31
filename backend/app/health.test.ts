import { FakeLlm } from "../shared/llm";
import { makeTestDeps } from "../shared/testing";
import { FakeTranscriber } from "../shared/transcriber";
import { SERVICES_TTL_MS, servicesProbe } from "./health";

describe("servicesProbe", () => {
  it("reports every service and key presence", async () => {
    const deps = makeTestDeps({ generator: null });
    expect(await servicesProbe(deps)()).toEqual({ whisperx: "ok", ollama: "ok", ollamaModel: "fake", stock: "ok", generator: "unset" });
  });

  it("memoises the probes for 30 s and shares one in-flight probe", async () => {
    let t = 0;
    const transcriber = new FakeTranscriber({ language: "en", words: [] });
    const health = vi.spyOn(transcriber, "health");
    const probe = servicesProbe(makeTestDeps({ transcriber, now: () => new Date(t) }));
    await Promise.all([probe(), probe()]);
    await probe();
    expect(health).toHaveBeenCalledTimes(1);
    t = SERVICES_TTL_MS;
    await probe();
    expect(health).toHaveBeenCalledTimes(2);
  });

  it("a down transcriber and a missing model show as such", async () => {
    const transcriber = new FakeTranscriber({ language: "en", words: [] });
    transcriber.health = async () => "down";
    const llm = new FakeLlm(() => ({}));
    llm.health = async () => ({ status: "model_missing", model: "qwen2.5:3b" });
    expect(await servicesProbe(makeTestDeps({ transcriber, llm, stock: null }))()).toEqual({ whisperx: "down", ollama: "model_missing", ollamaModel: "qwen2.5:3b", stock: "unset", generator: "ok" });
  });
});
