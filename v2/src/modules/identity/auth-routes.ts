import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { loginRequestSchema } from "../../../contracts/auth.js";
import type { AppConfig } from "../../platform/config.js";
import { IdentityRepository, tokenSha256, type ResolvedSession } from "./identity-repository.js";
import { verifyPassword } from "./password.js";

const cookieValue = (request: FastifyRequest, name: string): string | null => {
  const item=request.headers.cookie?.split(";").map(value=>value.trim()).find(value=>value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length+1)) : null;
};
const issueToken=()=>randomBytes(32).toString("base64url");
const dummyHash="scrypt$v1$16384$8$1$YW5zd2VydHJhdmVsLWR1bW15$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export type ProductAuthMode="disabled"|"fixed_test"|"session";
export type AuthContext={session:ResolvedSession;memberships:Awaited<ReturnType<IdentityRepository["memberships"]>>};
export type TenantResolution={kind:"ok";tenantId:string}|{kind:"disabled"}|{kind:"unauthenticated"}|{kind:"selection_required"}|{kind:"forbidden"};

export function resolvedAuthMode(config:AppConfig):ProductAuthMode {
  if(config.PRODUCT_AUTH_MODE)return config.PRODUCT_AUTH_MODE;
  if(config.NODE_ENV!=="production"&&config.PRODUCT_TENANT_ID)return "fixed_test";
  return "disabled";
}

export function registerIdentityRoutes(app:FastifyInstance,pool:pg.Pool,config:AppConfig){
  const repository=new IdentityRepository(pool); const mode=resolvedAuthMode(config); const cookieName=config.PRODUCT_SESSION_COOKIE_NAME??"answertravel_session"; const ttlHours=config.PRODUCT_SESSION_TTL_HOURS??12;
  const cookie=(token:string,maxAge:number)=>`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.NODE_ENV==="production"?"; Secure":""}`;
  const sessionFor=async(request:FastifyRequest):Promise<AuthContext|null>=>{const raw=cookieValue(request,cookieName);if(!raw)return null;const session=await repository.resolveSession(tokenSha256(raw));if(!session)return null;return {session,memberships:await repository.memberships(session.userId)};};
  const sameOrigin=(request:FastifyRequest)=>{const origin=request.headers.origin;if(!origin)return config.NODE_ENV!=="production";try{if(config.PRODUCT_PUBLIC_ORIGIN)return new URL(origin).origin===new URL(config.PRODUCT_PUBLIC_ORIGIN).origin;const parsed=new URL(origin);return parsed.host===request.headers.host;}catch{return false;}};
  const attempts=new Map<string,{count:number;since:number}>();
  const rateLimited=(key:string)=>{const now=Date.now();const current=attempts.get(key);if(!current||now-current.since>15*60_000){attempts.set(key,{count:1,since:now});return false;}current.count+=1;return current.count>5;};
  const body=(context:AuthContext)=>({authenticated:true as const,user:{email:context.session.email},selectedTenantId:context.session.selectedTenantId,requiresWorkspaceSelection:context.memberships.length!==1&&!context.session.selectedTenantId,expiresAt:context.session.expiresAt});
  const unauthorized={code:"authentication_required",message:"请登录后继续。"};

  app.post("/api/v1/auth/login",async(request,reply)=>{if(mode!=="session")return reply.code(404).send({code:"identity_disabled",message:"身份入口尚未启用。"});if(!sameOrigin(request))return reply.code(403).send({code:"origin_rejected",message:"请求来源无效，请刷新页面后重试。"});const parsed=loginRequestSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({code:"invalid_login",message:"请输入有效的邮箱和密码。"});const subject=parsed.data.email.trim().toLowerCase();const ip=request.ip;const key=tokenSha256(`${ip}:${subject}`);if(rateLimited(key)){await repository.recordEvent({type:"login_failed",subject,detail:{reason:"rate_limited"}});return reply.code(429).send({code:"login_rate_limited",message:"尝试次数过多，请稍后再试。"});}const user=await repository.userByEmail(subject);const valid=await verifyPassword(parsed.data.password,user?.passwordHash??dummyHash).catch(()=>false);if(!user||!valid){await repository.recordEvent({type:"login_failed",subject,detail:{reason:"invalid_credentials"}});return reply.code(401).send({code:"invalid_credentials",message:"邮箱或密码不正确。"});}const memberships=await repository.memberships(user.id);const selectedTenantId=memberships.length===1?memberships[0]!.tenantId:null;const raw=issueToken();const now=new Date();const expiresAt=new Date(now.getTime()+ttlHours*3_600_000);const id=await repository.createSession({userId:user.id,tokenHash:tokenSha256(raw),selectedTenantId,expiresAt,now});await repository.recordEvent({type:"login_succeeded",userId:user.id,sessionId:id,subject:user.email});reply.header("set-cookie",cookie(raw,ttlHours*3_600));return {authenticated:true,user:{email:user.email},selectedTenantId,requiresWorkspaceSelection:memberships.length!==1,expiresAt:expiresAt.toISOString()};});
  app.post("/api/v1/auth/logout",async(request,reply)=>{if(!sameOrigin(request))return reply.code(403).send({code:"origin_rejected",message:"请求来源无效，请刷新页面后重试。"});const raw=cookieValue(request,cookieName);if(raw){const session=await repository.revoke(tokenSha256(raw));if(session)await repository.recordEvent({type:"logout",userId:session.userId,sessionId:session.id,subject:session.email});}reply.header("set-cookie",cookie("",0));return reply.code(204).send();});
  app.get("/api/v1/auth/session",async(request,reply)=>{if(mode==="fixed_test"&&config.PRODUCT_TENANT_ID)return {authenticated:true,user:{email:"local-preview@answertravel.invalid"},selectedTenantId:config.PRODUCT_TENANT_ID,requiresWorkspaceSelection:false,expiresAt:new Date(Date.now()+86_400_000).toISOString()};if(mode!=="session")return reply.code(404).send({code:"identity_disabled",message:"身份入口尚未启用。"});const context=await sessionFor(request);return context?body(context):reply.code(401).send(unauthorized);});
  app.get("/api/v1/workspaces",async(request,reply)=>{const context=await sessionFor(request);if(!context)return reply.code(401).send(unauthorized);if(!context.memberships.length)return reply.code(403).send({code:"membership_required",message:"当前账号尚未获得品牌空间权限。"});return {items:context.memberships};});
  app.post<{Params:{tenantId:string}}>("/api/v1/workspaces/:tenantId/select",async(request,reply)=>{if(!sameOrigin(request))return reply.code(403).send({code:"origin_rejected",message:"请求来源无效，请刷新页面后重试。"});const context=await sessionFor(request);if(!context)return reply.code(401).send(unauthorized);const membership=context.memberships.find(item=>item.tenantId===request.params.tenantId);if(!membership)return reply.code(403).send({code:"membership_required",message:"当前账号未获得该品牌空间权限。"});const raw=issueToken();const now=new Date();const expiresAt=new Date(now.getTime()+ttlHours*3_600_000);const newId=await repository.createSession({userId:context.session.userId,tokenHash:tokenSha256(raw),selectedTenantId:membership.tenantId,expiresAt,now});const oldRaw=cookieValue(request,cookieName)!;await repository.revoke(tokenSha256(oldRaw),now);await repository.recordEvent({type:"workspace_selected",userId:context.session.userId,sessionId:newId,subject:context.session.email,detail:{tenantId:membership.tenantId}});reply.header("set-cookie",cookie(raw,ttlHours*3_600));return {authenticated:true,user:{email:context.session.email},selectedTenantId:membership.tenantId,requiresWorkspaceSelection:false,expiresAt:expiresAt.toISOString()};});

  return {mode,sessionFor,resolveTenant:async(request:FastifyRequest):Promise<TenantResolution>=>{if(mode==="disabled")return {kind:"disabled"};if(mode==="fixed_test")return config.PRODUCT_TENANT_ID?{kind:"ok",tenantId:config.PRODUCT_TENANT_ID}:{kind:"disabled"};const context=await sessionFor(request);if(!context)return {kind:"unauthenticated"};if(!context.memberships.length)return {kind:"forbidden"};if(!context.session.selectedTenantId)return {kind:"selection_required"};return context.memberships.some(item=>item.tenantId===context.session.selectedTenantId)?{kind:"ok",tenantId:context.session.selectedTenantId}:{kind:"forbidden"};}};
}
