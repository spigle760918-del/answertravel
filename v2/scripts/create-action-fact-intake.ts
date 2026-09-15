import pg from "pg";
import { ActionFactIntakeRepository } from "../src/modules/action-fact-intake/action-fact-intake-repository.js";
import { ActionFactIntakeService } from "../src/modules/action-fact-intake/action-fact-intake-service.js";

const databaseUrl = process.env.DATABASE_URL;
const tenantId = process.env.TENANT_ID;
const actionPackageKey =
  process.env.ACTION_PACKAGE_KEY ?? "website_product_facts";
if (!databaseUrl || !tenantId)
  throw new Error("DATABASE_URL and TENANT_ID are required.");

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const result = await new ActionFactIntakeService(
    new ActionFactIntakeRepository(pool),
  ).create(tenantId, actionPackageKey);
  console.log(
    JSON.stringify({
      id: result.intake.id,
      idempotent: result.idempotent,
      actionPackageKey: result.intake.actionPackageKey,
      status: result.intake.status,
      sourceFindings: result.intake.sourceFindingCount,
      focusAreas: result.intake.focusCount,
      envelopeFields: result.intake.coreEnvelopeFields.length,
      responseOptions: result.intake.responseOptions.length,
      factDraftAuthorized: result.intake.factDraftAuthorized,
      publicationAuthorized: result.intake.publicationAuthorized,
    }),
  );
} finally {
  await pool.end();
}
