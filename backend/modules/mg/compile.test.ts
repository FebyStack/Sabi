import { compileMotionGraphic } from "./compile";

const ok = (code: string) => {
  const out = compileMotionGraphic(code);
  if ("error" in out) throw new Error(out.detail);
  return out.compiled;
};

describe("compileMotionGraphic", () => {
  it("compiles jsx to React.createElement", () => {
    const compiled = ok(`const Component = ({ item }) => <div style={{ position: "absolute", inset: 0 }}>{item.props.title}</div>;`);
    expect(compiled).toContain(`React.createElement("div"`);
    expect(compiled).not.toContain("<div");
  });

  it("rejects imports exports fetch window and dynamic import", () => {
    const cases: [string, string][] = [
      [`import x from "y";\nconst Component = () => null;`, "forbidden: import"],
      [`export const Component = () => null;`, "forbidden: export"],
      [`const Component = () => { fetch("https://x"); return null; };`, "forbidden: fetch"],
      [`const Component = () => window.location.href;`, "forbidden: window"],
      [`const Component = () => { import("x"); return null; };`, "forbidden: import()"],
    ];
    for (const [code, detail] of cases) expect(compileMotionGraphic(code), code).toEqual({ error: "bad_code", detail });
  });

  it("rejects code without Component", () => {
    expect(compileMotionGraphic(`const Other = () => null;`)).toEqual({ error: "bad_code", detail: "missing Component" });
    expect(compileMotionGraphic(`function f() { const Component = () => null; }`)).toEqual({ error: "bad_code", detail: "missing Component" });
  });

  it("reports syntax errors with a message", () => {
    const out = compileMotionGraphic(`const Component = (`);
    expect(out).toMatchObject({ error: "bad_code" });
    expect("detail" in out && out.detail.length).toBeGreaterThan(0);
  });

  it("rejects typescript annotations", () => {
    expect(compileMotionGraphic(`const Component = ({ item }: any) => null;`)).toMatchObject({ error: "bad_code" });
  });

  it("rejects with statements, eval and constructor escapes", () => {
    expect(compileMotionGraphic(`const Component = () => { with (Math) { return null; } };`)).toMatchObject({ error: "bad_code" });
    expect(compileMotionGraphic(`const Component = () => eval("1");`)).toEqual({ error: "bad_code", detail: "forbidden: eval" });
    expect(compileMotionGraphic(`const Component = () => [].map.constructor("return 1")();`)).toEqual({ error: "bad_code", detail: "forbidden: constructor" });
  });
});
