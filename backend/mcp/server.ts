import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SabiApi } from "./client";
import { TOOL_NAMES, callTool, toolSpec } from "./tools";

// Maps each tool's ToolResult onto MCP content (image first, then the text line). No model calls here, ever.
export function createSabiMcpServer(api: SabiApi): McpServer {
  const server = new McpServer({ name: "sabi", version: "0.1.0" });
  for (const name of TOOL_NAMES) {
    server.registerTool(name, toolSpec(name), async (input: unknown) => {
      const r = await callTool(api, name, input);
      return {
        content: [
          ...(r.image ? [{ type: "image" as const, data: r.image.data.toString("base64"), mimeType: r.image.mimeType }] : []),
          { type: "text" as const, text: r.text },
        ],
        ...(r.isError ? { isError: true } : {}),
      };
    });
  }
  return server;
}
