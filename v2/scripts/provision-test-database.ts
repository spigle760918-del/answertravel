import { pathToFileURL } from "node:url";
import pg from "pg";
import { runMigrations } from "../src/platform/migrations.js";
import { testDatabaseUrl } from "../tests/support/environment.js";

// Only for an isolated disposable test cluster; production role provisioning is separate.
export async function provisionTestDatabase(adminUrl: string, password: string): Promise<string> {
  const url = new URL(adminUrl);
  if (!url.pathname.endsWith("_test") || process.env.NODE_ENV === "production") throw new Error("Dedicated test database required.");
  const role = "answertravel_v2_app_test";
  const pool = new pg.Pool({ connectionString: adminUrl });
  try {
    await runMigrations(pool);
    const existing = await pool.query("select 1 from pg_roles where rolname = $1", [role]);
    if (existing.rowCount) throw new Error("Test role already exists; use a fresh isolated test cluster.");
    await pool.query(`create role ${pg.escapeIdentifier(role)} login nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)}`);
    await pool.query(`grant usage on schema public to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select on tenants to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select on platform_users, tenant_memberships to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant execute on function list_user_memberships(uuid) to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update on user_sessions to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant insert, select on auth_security_events to ${pg.escapeIdentifier(role)}`);
    // Extra mutation grants exercise append-only guards; production needs SELECT/INSERT only.
    await pool.query(`grant select, insert, update, delete, truncate on brand_truth_cards to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on brand_truth_quality_reports to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on question_generation_runs, question_panels to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on observation_plans, observation_targets, observation_attempts, raw_answers to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on citation_scans, citation_events, source_snapshots, trust_source_verification_snapshots to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on geo_entity_sets, geo_analysis_runs, geo_entity_mentions, geo_ranking_facts, geo_claim_facts to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on geo_diagnosis_snapshots, geo_action_proposals, competitor_deep_dive_recommendations to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on sampling_expansion_authorizations, comparable_observation_snapshots to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on real_brand_onboarding_packages to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on monitoring_schedules, monitoring_cycles to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on brand_claim_verification_runs, brand_claim_findings to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on evidence_gap_routing_snapshots to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on optimization_action_plan_snapshots to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on trust_evidence_blueprints to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on refund_policy_intake_snapshots to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on action_fact_intake_snapshots to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on website_diagnosis_snapshots to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on website_remediation_blueprints to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on competitor_scope_versions, competitor_scope_entities to ${pg.escapeIdentifier(role)}`);
    // Extra mutation grants exercise database triggers; production needs SELECT/INSERT only.
    await pool.query(`grant select, insert, update, delete, truncate on evidence_artifacts, audit_events to ${pg.escapeIdentifier(role)}`);
  } finally {
    await pool.end();
  }
  url.username = role;
  url.password = password;
  return url.toString();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
  const password = process.env.TEST_APP_PASSWORD;
  if (!adminUrl || !password) throw new Error("TEST_ADMIN_DATABASE_URL and TEST_APP_PASSWORD are required.");
  await provisionTestDatabase(adminUrl, password);
  console.log("Isolated test database migrated; non-superuser test role provisioned.");
}
