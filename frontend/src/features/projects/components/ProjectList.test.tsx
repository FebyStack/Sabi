import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { editorProject } from "@shared/editing/fixtures";
import type { Project } from "@shared/types";
import { ProjectList } from "./ProjectList";

const list = (projects: Project[]) => {
  const qc = new QueryClient();
  qc.setQueryData(["projects"], projects);
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter><ProjectList /></MemoryRouter></QueryClientProvider>);
};

describe("ProjectList", () => {
  it("shows the demo badge and a delete button", () => {
    const html = list([editorProject({ id: "demo", title: "Morning routines (demo)", demo: true }), editorProject({ id: "p2", title: "Mine", status: "planning" })]);
    expect(html.match(/>Demo</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Delete Morning routines (demo)"');
    expect(html).toContain('aria-label="Delete Mine"');
    expect(html).toContain("Planning the edit"); // running statuses read like the stepper
    expect(html).toMatch(/<dialog/);
  });

  it("empty state names the create action", () => {
    const html = list([]);
    expect(html).toContain("No projects yet");
    expect(html).toMatch(/Create/);
  });
});
