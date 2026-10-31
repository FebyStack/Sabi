import { servicesLine } from "./useServices";

const ok = { whisperx: "ok", ollama: "ok", ollamaModel: "qwen2.5:3b", stock: "ok", generator: "ok" } as const;

it("servicesLine names what is missing, nothing when all ok or unknown", () => {
  expect(servicesLine(undefined)).toBeNull();
  expect(servicesLine(ok)).toBeNull();
  expect(servicesLine({ ...ok, whisperx: "down", ollama: "model_missing", stock: "unset" })).toBe("whisperX off · Ollama model missing · Pexels key unset");
  expect(servicesLine({ ...ok, ollama: "down", generator: "unset" })).toBe("Ollama off"); // fal is not on Home
});
