import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import { onboardingPackageSchema, type OnboardingPackage } from "./real-brand-onboarding.js";

export class RealBrandOnboardingRepository {
  constructor(private readonly pool: pg.Pool) {}
  async create(raw: OnboardingPackage): Promise<OnboardingPackage> {
    const item = onboardingPackageSchema.parse(raw);
    return withTenantTransaction(this.pool,item.tenantId,async(client)=>{
      await client.query(`insert into real_brand_onboarding_packages(id,tenant_id,brand_name,package,status,created_at) values($1,$2,$3,$4::jsonb,'draft',$5)`,[item.id,item.tenantId,item.brandName,JSON.stringify(item),item.createdAt]);
      await appendAuditEvent(client,createAuditEvent({tenantId:item.tenantId,actorType:"agent",actorId:"real-brand-onboarding.v1",traceId:item.id,action:"real_brand_onboarding.drafted",resourceType:"real_brand_onboarding_package",resourceId:item.id,detail:{sources:item.sources.length,facts:item.facts.length,competitors:item.competitors.length,gaps:item.gaps.length}}));
      return item;
    });
  }
  async latest(tenantId:string):Promise<OnboardingPackage|null>{return withTenantTransaction(this.pool,tenantId,async(client)=>{const result=await client.query(`select package from real_brand_onboarding_packages order by created_at desc,id desc limit 1`);return result.rows[0]?onboardingPackageSchema.parse(result.rows[0].package):null;});}
}
