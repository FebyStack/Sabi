import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SabiApi } from "./client";
import { createSabiMcpServer } from "./server";

// stdio entry for Claude Code (.mcp.json). stdout is the protocol: log to stderr only.
const url = process.env.SABI_API_URL ?? "http://127.0.0.1:3001";
await createSabiMcpServer(new SabiApi(url)).connect(new StdioServerTransport());
console.error(`sabi mcp server ready (api ${url})`);
