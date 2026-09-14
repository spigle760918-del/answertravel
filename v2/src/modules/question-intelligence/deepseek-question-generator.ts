import { z } from "zod";
import { questionGenerationResultSchema, type GeneratedQuestion } from "./question-intelligence.js";

const deepSeekResponseSchema = z.object({
  id: z.string().min(1), model: z.string().min(1), system_fingerprint: z.string().optional(),
  choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }).optional(),
}).passthrough();

export type DeepSeekExchange = { attempt: number; httpStatus: number | null; durationMs: number; response: unknown; errorCode: string | null };
export type DeepSeekGeneration = { questions: GeneratedQuestion[]; request: Record<string, unknown>; exchanges: DeepSeekExchange[]; responseId: string; model: string; usage: unknown };

export class DeepSeekQuestionError extends Error {
  constructor(message: string, readonly code: string, readonly request: Record<string, unknown>, readonly exchanges: DeepSeekExchange[]) { super(message); }
}

export class DeepSeekQuestionGenerator {
  constructor(private readonly options: { apiKey: string; endpoint?: string; model?: string; timeoutMs?: number; maxAttempts?: number;
    fetchImpl?: typeof fetch; wait?: (ms: number) => Promise<void> }) {
    if (!options.apiKey.trim()) throw new Error("DeepSeek API key is required.");
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<DeepSeekGeneration> {
    const request = { model: this.options.model ?? "deepseek-chat", messages: [
      { role: "system", content: systemPrompt }, { role: "user", content: userPrompt },
    ], response_format: { type: "json_object" }, temperature: 0.2, max_tokens: 4096, stream: false };
    const exchanges: DeepSeekExchange[] = [];
    const attempts = this.options.maxAttempts ?? 3;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 45_000);
      const started = Date.now();
      try {
        const response = await fetchImpl(this.options.endpoint ?? "https://api.deepseek.com/chat/completions", {
          method: "POST", headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(request), signal: controller.signal,
        });
        const rawText = await response.text();
        let body: unknown;
        try { body = JSON.parse(rawText); } catch { body = { rawText }; }
        const retryable = response.status === 429 || response.status >= 500;
        exchanges.push({ attempt, httpStatus: response.status, durationMs: Date.now() - started, response: body,
          errorCode: response.ok ? null : `http_${response.status}` });
        if (!response.ok) {
          if (retryable && attempt < attempts) { await (this.options.wait ?? ((ms) => new Promise((yes) => setTimeout(yes, ms))))(250 * 2 ** (attempt - 1)); continue; }
          throw new DeepSeekQuestionError("DeepSeek request failed.", `http_${response.status}`, request, exchanges);
        }
        const parsed = deepSeekResponseSchema.safeParse(body);
        if (!parsed.success) throw new DeepSeekQuestionError("DeepSeek response contract is invalid.", "invalid_response", request, exchanges);
        const choice = parsed.data.choices[0];
        if (!choice || choice.finish_reason === "length") throw new DeepSeekQuestionError("DeepSeek response was incomplete.", "incomplete_response", request, exchanges);
        const content = choice.message.content;
        if (!content) throw new DeepSeekQuestionError("DeepSeek returned empty content.", "empty_content", request, exchanges);
        let json: unknown;
        try { json = JSON.parse(content); } catch { throw new DeepSeekQuestionError("DeepSeek JSON output is invalid.", "invalid_json", request, exchanges); }
        const generated = questionGenerationResultSchema.safeParse(json);
        if (!generated.success) throw new DeepSeekQuestionError("DeepSeek question output is invalid.", "invalid_question_contract", request, exchanges);
        return { questions: generated.data.questions, request, exchanges, responseId: parsed.data.id, model: parsed.data.model, usage: parsed.data.usage ?? null };
      } catch (error) {
        if (error instanceof DeepSeekQuestionError) throw error;
        const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
        exchanges.push({ attempt, httpStatus: null, durationMs: Date.now() - started, response: null, errorCode: code });
        if (attempt < attempts) { await (this.options.wait ?? ((ms) => new Promise((yes) => setTimeout(yes, ms))))(250 * 2 ** (attempt - 1)); continue; }
        throw new DeepSeekQuestionError("DeepSeek transport failed.", code, request, exchanges);
      } finally { clearTimeout(timer); }
    }
    throw new DeepSeekQuestionError("DeepSeek attempts exhausted.", "attempts_exhausted", request, exchanges);
  }
}
