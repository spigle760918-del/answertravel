import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("foundation migration guardrails", () => {
  it("enforces append-only evidence and audit rows", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0001_foundation.sql"), "utf8");
    expect(sql).toContain("evidence_artifacts_append_only");
    expect(sql).toContain("audit_events_append_only");
    expect(sql).toContain("reject_immutable_mutation");
  });

  it("enables tenant row-level security", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0001_foundation.sql"), "utf8");
    expect(sql).toContain("alter table evidence_artifacts enable row level security");
    expect(sql).toContain("alter table evidence_artifacts force row level security");
    expect(sql).toContain("create policy evidence_tenant_isolation");
    expect(sql).toContain("create policy audit_tenant_isolation");
  });
});
