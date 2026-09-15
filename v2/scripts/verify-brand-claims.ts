import pg from "pg";
import {BrandClaimVerificationRepository} from "../src/modules/brand-claim-verification/brand-claim-verification-repository.js";
import {BrandClaimVerificationService} from "../src/modules/brand-claim-verification/brand-claim-verification-service.js";

const databaseUrl=process.env.DATABASE_URL,tenantId=process.env.TENANT_ID;
if(!databaseUrl||!tenantId) throw new Error("DATABASE_URL and TENANT_ID are required.");
const pool=new pg.Pool({connectionString:databaseUrl});
try{const result=await new BrandClaimVerificationService(new BrandClaimVerificationRepository(pool)).verifyTenant(tenantId);console.log(JSON.stringify(result));}finally{await pool.end();}
