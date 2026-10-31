import { LANGUAGE_NAMES, RunInput, SpokenLanguage } from "../contract";
import { WHISPER_LANGUAGES } from "./whisper";

it("is Whisper's 99 codes, covers every translation language, and RunInput rejects the rest", () => {
  expect(WHISPER_LANGUAGES).toHaveLength(99);
  expect(new Set(WHISPER_LANGUAGES).size).toBe(99);
  for (const code of Object.keys(LANGUAGE_NAMES)) expect(SpokenLanguage.safeParse(code).success, code).toBe(true);
  expect(RunInput.safeParse({ language: "tl" }).success).toBe(true);
  expect(RunInput.safeParse({ language: null }).success).toBe(true);
  expect(RunInput.safeParse({}).success).toBe(true);
  for (const bad of ["xx", "fil", "yue", "english", ""]) expect(RunInput.safeParse({ language: bad }).success, bad).toBe(false);
});
