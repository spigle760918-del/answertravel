import { describe, expect, it } from "vitest";
import { createEvidenceEnvelope, EvidenceEnvelopeSchema } from "../../src/kernel/evidence-envelope.js";

const tenantId = "11111111-1111-4111-8111-111111111111";

describe("evidence envelope", () => {
  it("creates a hash-verified immutable value contract", () => {
    const envelope = createEvidenceEnvelope({
      tenantId,
      artifactType: "model.raw_answer",
      factLevel: "F1",
      schemaVersion: 1,
      source: {
        system: "contract-test",
        reference: "fixture://answer/1",
        capturedAt: "2026-09-13T00:00:00.000Z",
        surface: "internal"
      },
      payload: { answer: "仅用于测试的回答", citations: [] }
    });

    expect(envelope.payloadSha256).toHaveLength(64);
    expect(EvidenceEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("rejects payload tampering", () => {
    const envelope = createEvidenceEnvelope({
      tenantId,
      artifactType: "model.raw_answer",
      factLevel: "F1",
      schemaVersion: 1,
      source: {
        system: "contract-test",
        reference: "fixture://answer/2",
        capturedAt: "2026-09-13T00:00:00.000Z"
      },
      payload: { answer: "原始内容" }
    });

    expect(() => EvidenceEnvelopeSchema.parse({ ...envelope, payload: { answer: "被修改" } })).toThrow(
      "Payload hash does not match payload"
    );
  });
});
