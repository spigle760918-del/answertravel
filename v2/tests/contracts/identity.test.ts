import { describe,expect,it } from "vitest";
import { authSessionSchema,loginRequestSchema,workspaceListSchema } from "../../contracts/auth.js";
import { hashPassword,verifyPassword } from "../../src/modules/identity/password.js";
import { loadConfig } from "../../src/platform/config.js";

describe("invite identity contracts",()=>{
  it("hashes passwords with a random adaptive digest",async()=>{const first=await hashPassword("correct horse battery staple");const second=await hashPassword("correct horse battery staple");expect(first).not.toBe(second);expect(await verifyPassword("correct horse battery staple",first)).toBe(true);expect(await verifyPassword("wrong",first)).toBe(false);expect(first).not.toContain("correct horse");});
  it("keeps login, session and membership payloads strict",()=>{expect(loginRequestSchema.parse({email:"OWNER@EXAMPLE.COM",password:"secret"}).email).toBe("OWNER@EXAMPLE.COM");expect(authSessionSchema.parse({authenticated:true,user:{email:"owner@example.com"},selectedTenantId:null,requiresWorkspaceSelection:true,expiresAt:new Date().toISOString()}).authenticated).toBe(true);expect(workspaceListSchema.parse({items:[{tenantId:"00000000-0000-4000-8000-000000000001",brandName:"品牌甲",role:"owner"}]}).items).toHaveLength(1);});
  it("refuses fixed-tenant or origin-less production identity configuration",()=>{const base={NODE_ENV:"production",DATABASE_URL:"postgresql://u:p@localhost/db",REDIS_URL:"redis://localhost:6379",PRODUCT_AUTH_MODE:"fixed_test"};expect(()=>loadConfig(base)).toThrow(/session authentication|PRODUCT_AUTH_MODE/);expect(()=>loadConfig({...base,PRODUCT_AUTH_MODE:"session"})).toThrow(/PRODUCT_PUBLIC_ORIGIN/);expect(loadConfig({...base,PRODUCT_AUTH_MODE:"session",PRODUCT_PUBLIC_ORIGIN:"https://geo.example.com"}).PRODUCT_AUTH_MODE).toBe("session");});
});
