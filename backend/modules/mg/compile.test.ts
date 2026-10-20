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

  it("closes string-to-code and window routes", () => {
    const cases: [string, string][] = [
      [`const Component = () => <div dangerouslySetInnerHTML={{ __html: "<img src=x onerror=alert(1)>" }} />;`, "forbidden: dangerouslySetInnerHTML"],
      [`const Component = () => <iframe srcDoc="<script>1</script>" />;`, "forbidden: <iframe>"],
      [`const Component = () => <script>{"1"}</script>;`, "forbidden: <script>"],
      [`const Component = () => <a href="javascript:alert(1)">x</a>;`, "forbidden: javascript: URL"],
      [`const Component = () => [].map["con" + "structor"]("return 1")();`, "forbidden: computed property name"],
      [`const Component = () => [].map[\`constructor\`]("return 1")();`, "forbidden: constructor"],
      [`const Component = () => top.location;`, "forbidden: top"],
      [`const Component = () => { new Image().src = "https://x/?d=1"; return null; };`, "forbidden: Image"],
      [`const Component = () => Reflect.get([], "x");`, "forbidden: Reflect"],
      [`const Component = ({ item }) => { const el = {}; el.innerHTML = item.props.t; return null; };`, "forbidden: innerHTML"],
    ];
    for (const [code, detail] of cases) expect(compileMotionGraphic(code), code).toEqual({ error: "bad_code", detail });
  });

  it("element access by a denied name stays forbidden", () => {
    expect(compileMotionGraphic(`const Component = ({ item }) => item["fetch"];`)).toEqual({ error: "bad_code", detail: "forbidden: fetch" });
    expect(compileMotionGraphic(`const Component = ({ item }) => item[\`top\`];`)).toEqual({ error: "bad_code", detail: "forbidden: top" });
  });

  it("keeps css values that share a name with a global", () => {
    expect(compileMotionGraphic(`const Component = () => <div style={{ verticalAlign: "top", transformOrigin: "top", position: "absolute" }}>Open</div>;`)).toHaveProperty("compiled");
  });

  it("keeps ordinary indexing", () => {
    expect(compileMotionGraphic(`const Component = ({ item }) => { const xs = [1, 2, 3]; const i = 1; return <div>{xs[i + 1]}{xs[0]}{item.props["title"]}</div>; };`))
      .toHaveProperty("compiled");
  });

  it("closes spread, string-keyed and createElement routes", () => {
    const cases: [string, string][] = [
      [`const Component = ({ item }) => <div {...item.props.attrs} />;`, "forbidden: {...spread} attribute"],
      [`const Component = () => <div {...{ "dangerouslySetInnerHTML": { __html: "x" } }} />;`, "forbidden: {...spread} attribute"],
      [`const Component = () => { const o = { "dangerouslySetInnerHTML": 1 }; return null; };`, "forbidden: dangerouslySetInnerHTML"],
      [`const Component = () => { const k = "constructor"; return [].map[k]; };`, "forbidden: constructor"],
      [`const Component = () => { const o = { ["dangerously" + "SetInnerHTML"]: 1 }; return null; };`, "forbidden: computed property name"],
      [`const Component = () => React.createElement("iframe", { src: "https://x" });`, "forbidden: <iframe>"],
    ];
    for (const [code, detail] of cases) expect(compileMotionGraphic(code), code).toEqual({ error: "bad_code", detail });
  });
});
