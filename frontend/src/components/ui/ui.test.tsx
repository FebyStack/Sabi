import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";
import { Switch } from "./Switch";

describe("ui primitives", () => {
  it("Switch and Segmented expose roles and state", () => {
    const sw = renderToStaticMarkup(<Switch label="Show overlay" checked onChange={() => {}} />);
    expect(sw).toContain('role="switch"');
    expect(sw).toContain('aria-checked="true"');
    expect(sw).toContain('aria-label="Show overlay"');
    const seg = renderToStaticMarkup(<Segmented label="Placement" value="top" options={[{ value: "full", label: "Full" }, { value: "top", label: "Top" }]} onChange={() => {}} />);
    expect(seg).toContain('role="radiogroup"');
    expect(seg).toContain('aria-label="Placement"');
    expect(seg.match(/role="radio"/g)).toHaveLength(2);
    expect(seg).toMatch(/aria-checked="true"[^>]*>Top</);
    expect(seg).toMatch(/aria-checked="false"[^>]*>Full</);
  });

  it("Sheet labels itself by its title", () => {
    const html = renderToStaticMarkup(<Sheet open onClose={() => {}} title="Delete overlay?"><p>x</p></Sheet>);
    const id = html.match(/aria-labelledby="([^"]+)"/)![1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(new RegExp(`id="${id}"[^>]*>Delete overlay\\?<`));
    expect(html.startsWith("<dialog")).toBe(true);
  });

  it("Notice is a polite status", () => {
    const html = renderToStaticMarkup(<Notice tone="warn" action={{ label: "Retry", onClick: () => {} }}>Changed elsewhere</Notice>);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(">Retry</button>");
  });

  it("Button variants keep the 44 px minimum", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"] as const)
      for (const size of ["md", "sm"] as const) expect(renderToStaticMarkup(<Button variant={variant} size={size}>x</Button>)).toContain("min-h-11");
  });
});
