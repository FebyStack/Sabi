import { z } from "zod";

export type LlmRequest = { system: string; user: string; format: Record<string, unknown> };

export type LlmHealth = { status: "ok" | "down" | "model_missing"; model: string };

export interface Llm {
  chat(req: LlmRequest): Promise<string>;
  health(): Promise<LlmHealth>; // GET /api/health and npm run doctor (spec row 32)
}

const unavailable = () => new Error("llm_unavailable");
const PROBE_MS = 1500;

// Local Ollama (never the Anthropic API). `format` is a JSON schema, so the model's grammar enforces shape and array bounds.
export class OllamaLlm implements Llm {
  constructor(private baseUrl: string, private model: string, private opts: { timeoutMs?: number } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async chat({ system, user, format }: LlmRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model, stream: false, format, options: { temperature: 0, num_ctx: 8192 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10 * 60_000),
    }).catch((err: Error) => { throw err.name === "TimeoutError" ? new Error("llm_timeout") : unavailable(); });
    if (res.status === 404) throw new Error("llm_model_missing");
    if (!res.ok) throw unavailable();
    const body: { message?: { content?: unknown } } = await res.json().catch(() => { throw unavailable(); });
    if (typeof body.message?.content !== "string") throw unavailable();
    return body.message.content;
  }

  // Ollama names untagged pulls "<name>:latest".
  async health(): Promise<LlmHealth> {
    const model = this.model;
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(PROBE_MS) }).catch(() => null);
    if (!res?.ok) return { status: "down", model };
    const body: { models?: { name?: unknown }[] } = await res.json().catch(() => ({}));
    const names = new Set((body.models ?? []).map((m) => m.name));
    return { status: names.has(model) || names.has(`${model}:latest`) ? "ok" : "model_missing", model };
  }
}

export class FakeLlm implements Llm {
  calls: LlmRequest[] = [];
  constructor(private respond: (req: LlmRequest) => unknown) {}
  async chat(req: LlmRequest) {
    this.calls.push(req);
    const out = this.respond(req);
    return typeof out === "string" ? out : JSON.stringify(out);
  }
  async health(): Promise<LlmHealth> { return { status: "ok", model: "fake" }; }
}

// Two attempts; the retry says what was wrong (at temperature 0 the same prompt would repeat the same answer). Transport errors propagate.
export async function askJson<T>(llm: Llm, schema: z.ZodType<T>, system: string, input: unknown): Promise<T> {
  const first = JSON.stringify(input);
  const format = z.toJSONSchema(schema) as Record<string, unknown>;
  let user = first;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llm.chat({ system, user, format });
    let problem = "not JSON";
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      const issue = parsed.error.issues[0];
      problem = `${issue.path.join(".") || "answer"}: ${issue.message}`;
    } catch { /* not JSON */ }
    user = `${first}\n\nYour previous answer was rejected: ${problem}. Answer again.`;
  }
  throw new Error("llm_invalid_output");
}
