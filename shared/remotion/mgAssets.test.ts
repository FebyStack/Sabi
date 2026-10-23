import { fontFaceCss, imageBlobs } from "./mgAssets";

describe("mgAssets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fontFaceCss keeps the bundled families' faces with indexed URLs", () => {
    const base = "http://localhost:5173/node_modules/@fontsource-variable/inter/index.css";
    const { css, urls } = fontFaceCss([
      { css: '@font-face { font-family: "Inter Variable"; font-style: normal; font-weight: 100 900; src: url("./files/inter-latin-wght-normal.woff2") format("woff2-variations"); unicode-range: U+0000-00FF; }', base },
      { css: "@font-face { font-family: Other; src: url(x.woff2); }", base },
      { css: ".x { color: red }", base },
    ], ["Inter Variable", "Bebas Neue"]);
    expect(css).toContain('url(__sabi_font_0__) format("woff2-variations")');
    expect(css).toContain("unicode-range: U+0000-00FF");
    expect(css).not.toContain("Other");
    expect(css).not.toContain(".x");
    expect(urls).toEqual(["http://localhost:5173/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"]);
  });

  it("imageBlobs fetches each URL once and lists failures", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/a") return new Response(new Blob(["a"]), { status: 200 });
      if (url === "/b") return new Response("nope", { status: 404 });
      throw new Error("down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await imageBlobs(["/a", "/b", "/c"]);
    expect(r.blobs.map(([u]) => u)).toEqual(["/a"]);
    expect(r.blobs[0][1]).toBeInstanceOf(Blob);
    expect(r.failed).toEqual(["/b", "/c"]);
    await imageBlobs(["/a"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
