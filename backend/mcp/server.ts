import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { SabiApi } from "./client";
import { TOOL_NAMES, callTool, toolSpec } from "./tools";

// Maps each tool's ToolResult onto MCP content (images first, then the text). No model calls here, ever.
export function createSabiMcpServer(api: SabiApi, { heartbeatMs = 5000 } = {}): McpServer {
  const server = new McpServer({ name: "sabi", version: "0.1.0" });
  for (const name of TOOL_NAMES) {
    server.registerTool(name, toolSpec(name), async (input: unknown, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      // Renders and wait_job can run for minutes: progress notifications let the client reset its request timeout.
      const token = extra._meta?.progressToken;
      let beat = 0;
      const timer = token === undefined ? null : setInterval(() => {
        void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++beat, message: `${name} still working` } }).catch(() => {});
      }, heartbeatMs);
      try {
        const r = await callTool(api, name, input);
        return {
          content: [
            ...(r.images ?? []).map((img) => ({ type: "image" as const, data: img.data.toString("base64"), mimeType: img.mimeType })),
            { type: "text" as const, text: r.text },
          ],
          ...(r.isError ? { isError: true } : {}),
        };
      } finally {
        if (timer) clearInterval(timer);
      }
    });
  }
  return server;
}
