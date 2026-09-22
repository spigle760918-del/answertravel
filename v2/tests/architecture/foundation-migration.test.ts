import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("foundation migration guardrails", () => {
  it("enforces append-only evidence and audit rows", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "migrations/0001_foundation.sql"),
      "utf8",
    );
    expect(sql).toContain("evidence_artifacts_append_only");
    expect(sql).toContain("audit_events_append_only");
    expect(sql).toContain("reject_immutable_mutation");
  });

  it("enables tenant row-level security", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "migrations/0001_foundation.sql"),
      "utf8",
    );
    expect(sql).toContain(
      "alter table evidence_artifacts enable row level security",
    );
    expect(sql).toContain(
      "alter table evidence_artifacts force row level security",
    );
    expect(sql).toContain("create policy evidence_tenant_isolation");
    expect(sql).toContain("create policy audit_tenant_isolation");
  });

  it("keeps brand truth quality reports immutable and tenant isolated", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "migrations/0004_brand_truth_quality.sql"),
      "utf8",
    );
    expect(sql).toContain("brand_truth_quality_reports_append_only");
    expect(sql).toContain("brand_truth_quality_reports_no_truncate");
    expect(sql).toContain(
      "alter table brand_truth_quality_reports force row level security",
    );
    expect(sql).toContain(
      "create policy brand_truth_quality_reports_tenant_isolation",
    );
  });

  it("keeps question generation and panels immutable and tenant isolated", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "migrations/0005_question_intelligence.sql"),
      "utf8",
    );
    expect(sql).toContain("question_generation_runs_append_only");
    expect(sql).toContain("question_panels_append_only");
    expect(sql).toContain("question_generation_runs_no_truncate");
    expect(sql).toContain("question_panels_no_truncate");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("question_panels_tenant_isolation");
  });
  it("keeps observation plans, attempts and raw answers append-only", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "migrations/0006_observations.sql"),
      "utf8",
    );
    expect(sql).toContain("observation_attempts");
    expect(sql).toContain("raw_answers");
    expect(sql).toContain("reject_immutable_mutation");
    expect(sql).toContain("force row level security");
  });
  it("keeps citation scans, events and source snapshots append-only and tenant isolated", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "migrations/0007_citation_source_evidence.sql"),
      "utf8",
    );
    expect(sql).toContain("citation_scans");
    expect(sql).toContain("citation_events");
    expect(sql).toContain("source_snapshots");
    expect(sql).toContain("reject_immutable_mutation");
    expect(sql).toContain("force row level security");
  });
  it("keeps GEO entity, analysis, mention, ranking and claim facts append-only and tenant isolated", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0008_basic_geo_intelligence.sql"), "utf8");
    for (const table of ["geo_entity_sets", "geo_analysis_runs", "geo_entity_mentions", "geo_ranking_facts", "geo_claim_facts"]) expect(sql).toContain(table);
    expect(sql).toContain("reject_immutable_mutation");
    expect(sql).toContain("force row level security");
  });
  it("keeps GEO diagnoses, actions and deep-dive recommendations append-only and tenant isolated", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0009_geo_gap_decisions.sql"), "utf8");
    for (const table of ["geo_diagnosis_snapshots", "geo_action_proposals", "competitor_deep_dive_recommendations"]) expect(sql).toContain(table);
    expect(sql).toContain("reject_immutable_mutation");
    expect(sql).toContain("force row level security");
  });
  it("keeps sampling approvals and comparable cycle snapshots append-only and tenant isolated", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0010_comparable_observation_cycles.sql"), "utf8");
    for (const table of ["sampling_expansion_authorizations", "comparable_observation_snapshots"]) expect(sql).toContain(table);
    expect(sql).toContain("authorization_id");
    expect(sql).toContain("reject_immutable_mutation");
    expect(sql).toContain("force row level security");
  });
  it("keeps real brand onboarding packages append-only and tenant isolated", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0011_real_brand_onboarding.sql"), "utf8");
    expect(sql).toContain("real_brand_onboarding_packages");
    expect(sql).toContain("reject_immutable_mutation");
    expect(sql).toContain("force row level security");
  });
  it("keeps trust source verification snapshots immutable, unpublished and tenant isolated", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0019_trust_source_verification.sql"), "utf8");
    expect(sql).toContain("trust_source_verification_snapshots_append_only");
    expect(sql).toContain("trust_source_verification_snapshots_no_truncate");
    expect(sql).toContain("publication_authorized=false");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("trust_source_verification_snapshots_tenant_isolation");
  });
  it("keeps refund policy intake immutable and blocks premature summaries or publication", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0020_refund_policy_intake.sql"), "utf8");
    expect(sql).toContain("refund_policy_intake_snapshots_append_only");
    expect(sql).toContain("summary_draft_authorized=false");
    expect(sql).toContain("publication_authorized=false");
    expect(sql).toContain("force row level security");
  });
  it("keeps personalized action fact intake immutable and blocks premature drafts or publication", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0021_action_fact_intake.sql"), "utf8");
    expect(sql).toContain("action_fact_intake_snapshots_append_only");
    expect(sql).toContain("personalization_mode='diagnosis_driven'");
    expect(sql).toContain("fact_draft_authorized=false");
    expect(sql).toContain("publication_authorized=false");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("action_fact_intake_snapshots_tenant_isolation");
  });
  it("keeps website diagnosis immutable, unpublished and tenant isolated", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0022_website_diagnosis.sql"), "utf8");
    expect(sql).toContain("website_diagnosis_snapshots_append_only");
    expect(sql).toContain("website_diagnosis_snapshots_no_truncate");
    expect(sql).toContain("publication_authorized=false");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("website_diagnosis_snapshots_tenant_isolation");
  });
  it("keeps website remediation blueprints immutable and blocks implementation or publication", async () => {
    const sql = await readFile(resolve(process.cwd(), "migrations/0023_website_remediation_blueprint.sql"), "utf8");
    expect(sql).toContain("website_remediation_blueprints_append_only");
    expect(sql).toContain("website_remediation_blueprints_no_truncate");
    expect(sql).toContain("implementation_authorized=false");
    expect(sql).toContain("publication_authorized=false");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("website_remediation_blueprints_tenant_isolation");
    const versionSql = await readFile(resolve(process.cwd(), "migrations/0024_website_remediation_blueprint_version.sql"), "utf8");
    expect(versionSql).toContain("add column rules_version");
    expect(versionSql).toContain("website-remediation-blueprint.v1");
    expect(versionSql).toContain("drop default");
  });
  it("copies shared API contracts into the production image build context", async () => {
    const dockerfile=await readFile(resolve(process.cwd(),"deploy/aliyun/Dockerfile"),"utf8");
    expect(dockerfile).toContain("COPY contracts ./contracts");
    expect(dockerfile).toContain("npm run build:web");
    expect(dockerfile).toContain("npm run build:server");
  });
});
