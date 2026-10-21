import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AddressInfo } from "node:net";
import { createApp } from "../app/app";
import { readyProject } from "../shared/apiTestHelpers";
import { makeTestDeps } from "../shared/testing";
import { SabiApi } from "./client";
import { createSabiMcpServer } from "./server";
import { TOOL_NAMES } from "./tools";

describe("sabi mcp server", () => {
  it("lists nine tools and round-trips inspect_project over InMemoryTransport", async () => {
    const deps = makeTestDeps();
    const { project } = await readyProject(deps);
    const http = createApp(deps).listen(0);
    const api = new SabiApi(`http://127.0.0.1:${(http.address() as AddressInfo).port}`);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await createSabiMcpServer(api).connect(serverT);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientT);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(9);
    expect(tools.map((t) => t.name)).toContain("upload_asset");

    const res = await client.callTool({ name: "inspect_project", arguments: { projectId: project.id } });
    expect(res.isError).toBeFalsy();
    expect((res.content as { type: string; text: string }[])[0].text).toContain(`baseVersion: ${project.updatedAt}`);

    const frame = await client.callTool({ name: "render_frame", arguments: { projectId: project.id, timestampMs: 500 } });
    expect((frame.content as { type: string; mimeType?: string }[]).map((c) => c.type)).toEqual(["image", "text"]);

    const bad = await client.callTool({ name: "apply_actions", arguments: { projectId: project.id, baseVersion: "old", actions: [{ type: "setTitle", title: "x" }] } });
    expect(bad.isError).toBe(true);
    await client.close();
    http.close();
  });

  it("keeps long tool calls alive with progress notifications", async () => {
    const deps = makeTestDeps();
    const { project } = await readyProject(deps);
    const http = createApp(deps).listen(0);
    const api = new SabiApi(`http://127.0.0.1:${(http.address() as AddressInfo).port}`);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await createSabiMcpServer(api, { heartbeatMs: 50 }).connect(serverT);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientT);
    deps.jobs.enqueue(project.id, "plan", () => new Promise((r) => setTimeout(r, 1200)));

    let beats = 0;
    const res = await client.callTool({ name: "wait_job", arguments: { projectId: project.id } }, undefined,
      { timeout: 600, resetTimeoutOnProgress: true, onprogress: () => { beats++; } });
    expect((res.content as { text: string }[])[0].text).toMatch(/^status ready after \d+s; last job plan COMPLETE/);
    expect(beats).toBeGreaterThan(5);
    await client.close();
    http.close();
  });
});
