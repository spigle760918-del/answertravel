import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { ProductReadRepository } from "./product-read-repository.js";

type TenantResolution={kind:"ok";tenantId:string}|{kind:"disabled"}|{kind:"unauthenticated"}|{kind:"selection_required"}|{kind:"forbidden"};
export function registerProductReadRoutes(app: FastifyInstance, pool: pg.Pool, resolveTenant:(request:FastifyRequest)=>Promise<TenantResolution>, environment: "development" | "test" | "production") {
  const repository = new ProductReadRepository(pool, environment);
  const unavailable = { code:"product_workspace_disabled", message:"产品工作台尚未配置。" };
  const read = async (request:FastifyRequest,reply: any, operation: (tenantId:string) => Promise<unknown>) => {
    const resolved=await resolveTenant(request);
    if(resolved.kind==="disabled")return reply.code(404).send(unavailable);
    if(resolved.kind==="unauthenticated")return reply.code(401).send({code:"authentication_required",message:"请登录后继续。"});
    if(resolved.kind==="selection_required")return reply.code(409).send({code:"workspace_selection_required",message:"请先选择品牌空间。"});
    if(resolved.kind==="forbidden")return reply.code(403).send({code:"membership_required",message:"当前账号尚未获得品牌空间权限。"});
    const eventId = randomUUID();
    try { return await operation(resolved.tenantId); }
    catch (error) { app.log.error({ err:error,event:"product_read.failed",eventId }, "Product read API failed");
      return reply.code(503).send({ code:"product_data_unavailable",message:"数据暂时不可用，请稍后重试。",eventId }); }
  };
  const found = async (request:FastifyRequest,reply: any, operation: (tenantId:string) => Promise<unknown | null>) => {
    const result = await read(request,reply, operation);
    if (result === null) return reply.code(404).send({ code:"resource_not_found",message:"未找到该记录。" });
    return result;
  };

  app.get("/api/v1/workspace", async (request, reply) => found(request,reply, tenantId => repository.workspace(tenantId)));
  app.get("/api/v1/overview", async (request, reply) => read(request,reply, tenantId => repository.overview(tenantId)));
  app.get<{Querystring:{questionId?:string}}>("/api/v1/question-insights", async (request, reply) => {
    const questionId=request.query.questionId;
    if(questionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(questionId))
      return reply.code(400).send({code:"invalid_question_id",message:"游客问题标识无效。"});
    return read(request,reply,tenantId=>repository.questionInsight(tenantId,questionId));
  });
  app.get("/api/v1/question-performance", async (request, reply) => read(request,reply,tenantId=>repository.questionPerformance(tenantId)));
  app.get("/api/v1/ai-visibility", async (request, reply) => read(request,reply,tenantId=>repository.aiVisibility(tenantId)));
  app.get("/api/v1/source-analysis", async (request, reply) => read(request,reply,tenantId=>repository.sourceAnalysis(tenantId)));
  app.get("/api/v1/competitor-scope", async (request, reply) => read(request,reply,tenantId=>repository.competitorScope(tenantId)));
  app.get("/api/v1/competitor-analysis", async (request, reply) => read(request,reply,tenantId=>repository.competitorAnalysis(tenantId)));
  app.get("/api/v1/question-panels", async (request, reply) => read(request,reply, tenantId => repository.questionPanels(tenantId)));
  app.get<{Params:{panelId:string;version:string}}>("/api/v1/question-panels/:panelId/versions/:version", async (request, reply) => {
    const version = Number(request.params.version); if (!Number.isInteger(version) || version < 1) return reply.code(400).send({ code:"invalid_version",message:"问题组版本无效。" });
    return found(request,reply, tenantId => repository.questionPanel(tenantId, request.params.panelId, version));
  });
  app.get("/api/v1/observation-plans", async (request, reply) => read(request,reply, tenantId => repository.observationPlans(tenantId)));
  app.get<{Params:{planId:string}}>("/api/v1/observation-plans/:planId", async (request, reply) => found(request,reply, tenantId => repository.observationPlan(tenantId, request.params.planId)));
  app.get<{Params:{answerId:string}}>("/api/v1/raw-answers/:answerId", async (request, reply) => found(request,reply, tenantId => repository.rawAnswer(tenantId, request.params.answerId)));
}
