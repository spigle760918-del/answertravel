import { randomUUID } from "node:crypto";
import { analyzeGeoText, geoAnalysisRunSchema, geoClaimSchema, geoMentionSchema, geoRankingSchema } from "./geo-intelligence.js";
import { GeoIntelligenceRepository } from "./geo-intelligence-repository.js";

export class GeoIntelligenceService { constructor(private readonly repository:GeoIntelligenceRepository){}
  async analyzeAnswer(tenantId:string,answerId:string):Promise<{runId:string;idempotent:boolean}|{status:"entity_set_missing"}>{const existing=await this.repository.runForAnswer(tenantId,answerId);if(existing)return{runId:existing.id,idempotent:true};
    const entitySet=await this.repository.latestApprovedEntitySet(tenantId);if(!entitySet)return{status:"entity_set_missing"};const context=await this.repository.answerContext(tenantId,answerId);if(!context)throw new Error("Raw answer not found.");
    const facts=analyzeGeoText(context.answerText,entitySet),runId=randomUUID(),now=new Date().toISOString();const run=geoAnalysisRunSchema.parse({id:runId,tenantId,answerId,entitySetId:entitySet.id,entitySetVersion:entitySet.version,
      rulesVersion:"basic-geo.v1",status:"completed",questionObjectType:context.questionObjectType,errorCode:null,analyzedAt:now});
    await this.repository.save(run,facts.mentions.map(item=>geoMentionSchema.parse({id:randomUUID(),tenantId,runId,answerId,...item,createdAt:now})),
      facts.rankings.map(item=>geoRankingSchema.parse({id:randomUUID(),tenantId,runId,...item,createdAt:now})),facts.claims.map(item=>geoClaimSchema.parse({id:randomUUID(),tenantId,runId,...item,createdAt:now})));
    return{runId,idempotent:false};}
}
