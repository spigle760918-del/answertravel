import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashPassword } from "../src/modules/identity/password.js";
import { createDatabasePool } from "../src/platform/database.js";

const inputSchema=z.object({
  email:z.string().trim().email().max(320),
  password:z.string().min(12).max(1024),
  tenantId:z.string().uuid(),
  role:z.enum(["owner","viewer"]),
});
const execute=process.argv.includes("--execute");
const authorization="answertravel-invite-user-v1";
const input=inputSchema.parse({email:process.env.INVITE_EMAIL,password:process.env.INVITE_PASSWORD,tenantId:process.env.INVITE_TENANT_ID,role:process.env.INVITE_ROLE??"viewer"});
const databaseUrl=process.env.MIGRATION_DATABASE_URL;
if(!databaseUrl)throw new Error("MIGRATION_DATABASE_URL is required.");
const pool=createDatabasePool(databaseUrl);

try{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const tenant=(await client.query<{display_name:string}>("select display_name from tenants where id=$1",[input.tenantId])).rows[0];
    if(!tenant)throw new Error("INVITE_TENANT_ID does not exist.");
    const existing=(await client.query<{id:string;status:string}>("select id,status from platform_users where normalized_email=$1",[input.email.toLowerCase()])).rows[0]??null;
    const existingMembership=existing?(await client.query<{role:string;status:string}>("select role,status from tenant_memberships where user_id=$1 and tenant_id=$2",[existing.id,input.tenantId])).rows[0]??null:null;
    if(!execute){
      await client.query("rollback");
      console.log(JSON.stringify({event:"invite_user.dry_run",email:input.email,tenantId:input.tenantId,brandName:tenant.display_name,role:input.role,userExists:Boolean(existing),membershipExists:Boolean(existingMembership),passwordPrinted:false,executionAuthorized:false,requiredAuthorizationMarker:authorization}));
    }else{
      if(process.env.INVITE_USER_AUTHORIZATION!==authorization)throw new Error("Invite user authorization marker is missing or invalid.");
      if(existing&&existing.status!=="active")throw new Error("Existing user is not active; explicit account recovery is required.");
      const userId=existing?.id??randomUUID();
      if(!existing)await client.query("insert into platform_users(id,email,normalized_email,password_hash,status,created_at,updated_at) values($1,$2,$3,$4,'active',now(),now())",[userId,input.email,input.email.toLowerCase(),await hashPassword(input.password)]);
      if(existingMembership&&(existingMembership.status!=="active"||existingMembership.role!==input.role))throw new Error("Existing membership differs; explicit role/status change is required.");
      if(!existingMembership)await client.query("insert into tenant_memberships(user_id,tenant_id,role,status,created_at,updated_at) values($1,$2,$3,'active',now(),now())",[userId,input.tenantId,input.role]);
      await client.query("commit");
      console.log(JSON.stringify({event:"invite_user.provisioned",email:input.email,tenantId:input.tenantId,brandName:tenant.display_name,role:input.role,idempotent:Boolean(existing&&existingMembership),passwordPrinted:false,executionAuthorized:true}));
    }
  }catch(error){await client.query("rollback").catch(()=>undefined);throw error;}finally{client.release();}
}finally{await pool.end();}
