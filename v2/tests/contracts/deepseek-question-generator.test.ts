import { describe, expect, it } from "vitest";
import { DeepSeekQuestionError, DeepSeekQuestionGenerator } from "../../src/modules/question-intelligence/deepseek-question-generator.js";

const validQuestions = { questions: [{ text: "云南亲子旅行如何规划？", journeyStage: "planning", objectType: "neutral_category",
  panelRole: "baseline", intentCluster: "亲子规划", audience: "亲子家庭", scenario: "云南五日游", supportingFactIds: [], rationale: "覆盖规划阶段" }] };
const successBody = { id: "chatcmpl-test", model: "deepseek-chat", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validQuestions) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };

describe("DeepSeek question generator", () => {
  it("retries a rate limit and returns structured questions without exposing the key in its evidence request", async () => {
    const calls: Array<{ authorization: string | null }> = [];
    const responses = [new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
      new Response(JSON.stringify(successBody), { status: 200 })];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ authorization: new Headers(init?.headers).get("authorization") });
      return responses.shift()!;
    }) as typeof fetch;
    const generator = new DeepSeekQuestionGenerator({ apiKey: "secret-test-key", fetchImpl, wait: async () => {} });
    const result = await generator.generate("output JSON", "generate questions");
    expect(result.questions).toHaveLength(1);
    expect(result.exchanges.map((item) => item.httpStatus)).toEqual([429, 200]);
    expect(calls.every((item) => item.authorization === "Bearer secret-test-key")).toBe(true);
    expect(JSON.stringify(result.request)).not.toContain("secret-test-key");
  });

  it("records invalid JSON as an explicit failure", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ...successBody,
      choices: [{ finish_reason: "stop", message: { content: "not-json" } }] }), { status: 200 })) as typeof fetch;
    const generator = new DeepSeekQuestionGenerator({ apiKey: "secret-test-key", fetchImpl });
    await expect(generator.generate("output JSON", "generate questions")).rejects.toMatchObject({ code: "invalid_json" } satisfies Partial<DeepSeekQuestionError>);
  });

  it("rejects a length-truncated answer", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ...successBody,
      choices: [{ finish_reason: "length", message: { content: JSON.stringify(validQuestions) } }] }), { status: 200 })) as typeof fetch;
    const generator = new DeepSeekQuestionGenerator({ apiKey: "secret-test-key", fetchImpl });
    await expect(generator.generate("output JSON", "generate questions")).rejects.toMatchObject({ code: "incomplete_response" });
  });

  it("retains a non-JSON HTTP body in failure evidence", async () => {
    const fetchImpl = (async () => new Response("upstream unavailable", { status: 503 })) as typeof fetch;
    const generator = new DeepSeekQuestionGenerator({ apiKey: "secret-test-key", fetchImpl, maxAttempts: 1 });
    try { await generator.generate("output JSON", "generate questions"); expect.unreachable(); }
    catch (error) {
      expect(error).toMatchObject({ code: "http_503" });
      expect((error as DeepSeekQuestionError).exchanges[0]?.response).toEqual({ rawText: "upstream unavailable" });
    }
  });
});
