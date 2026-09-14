import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOnboardingPackage, createIntakeSource } from "../../src/modules/real-brand-onboarding/real-brand-onboarding.js";
import { RealBrandOnboardingRepository } from "../../src/modules/real-brand-onboarding/real-brand-onboarding-repository.js";
import { withTenantTransaction } from "../../src/platform/database.js";
import { testDatabaseUrl } from "../support/environment.js";

const databaseUrl=testDatabaseUrl(),adminUrl=testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
describe.runIf(Boolean(databaseUrl&&adminUrl))("real brand onboarding persistence",()=>{
  const pool=new pg.Pool({connectionString:databaseUrl}),admin=new pg.Pool({connectionString:adminUrl});
  const tenantId=randomUUID();
  beforeAll(async()=>{await admin.query("insert into tenants(id,slug,display_name) values($1,$2,$3)",[tenantId,`onboarding-${tenantId.slice(0,8)}`,"Onboarding fixture"]);});
  afterAll(async()=>{await pool.end();await admin.end();});
  it("persists a draft with source lineage and tenant isolation",async()=>{
    const source=createIntakeSource({tenantId,sourceType:"manual",reference:"user-confirmed-main-brand",capturedAt:new Date().toISOString(),sensitive:false,content:{brandName:"北京珈程国际旅行社"}});
    const pack=buildOnboardingPackage({tenantId,brandName:"北京珈程国际旅行社",source,facts:[{statement:"主品牌名称为北京珈程国际旅行社",category:"identity",factLevel:"F0",visibility:"public",confidence:"high",needsHumanConfirmation:false}],competitors:[],gaps:["缺少竞品"]});
    const repository=new RealBrandOnboardingRepository(pool);await repository.create(pack);
    expect(await repository.latest(tenantId)).toMatchObject({id:pack.id,brandName:"北京珈程国际旅行社",gaps:["缺少竞品"]});
    expect(await repository.latest(randomUUID())).toBeNull();
    await expect(withTenantTransaction(pool,tenantId,(client)=>client.query("update real_brand_onboarding_packages set status='approved' where id=$1",[pack.id]))).rejects.toThrow("append-only");
  });
});
