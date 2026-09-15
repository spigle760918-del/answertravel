import {createHash} from "node:crypto";
import {verifyBrandClaims} from "./brand-claim-verification.js";
import {BrandClaimVerificationRepository} from "./brand-claim-verification-repository.js";

export class BrandClaimVerificationService{
  constructor(private readonly repository:BrandClaimVerificationRepository){}
  async verifyTenant(tenantId:string):Promise<{answers:number;created:number;idempotent:number;findings:number}>{const inputs=await this.repository.inputs(tenantId);let created=0,idempotent=0,findings=0;
    for(const input of inputs){const hash=createHash("sha256").update(JSON.stringify({answerId:input.answerId,text:input.answerText,truth:input.brandTruthCardId,version:input.brandTruthVersion,rules:"brand-claim-verification.v1"})).digest("hex");if(await this.repository.byInputHash(tenantId,hash)){idempotent++;continue;}
      const result=verifyBrandClaims({...input,tenantId,createdAt:new Date().toISOString()});await this.repository.save(result.run,result.findings);created++;findings+=result.findings.length;}
    return {answers:inputs.length,created,idempotent,findings};}
}
