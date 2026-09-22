import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { withTenantTransaction } from "../../platform/database.js";

export const tokenSha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export type IdentityUser = { id: string; email: string; passwordHash: string };
export type Membership = { tenantId: string; brandName: string; role: "owner" | "viewer" };
export type ResolvedSession = { id: string; userId: string; email: string; selectedTenantId: string | null; expiresAt: string };

export class IdentityRepository {
  constructor(private readonly pool: pg.Pool) {}
  async userByEmail(email: string): Promise<IdentityUser | null> {
    const result = await this.pool.query<{id:string;email:string;password_hash:string}>(`select id,email,password_hash from platform_users where normalized_email=$1 and status='active'`, [normalizeEmail(email)]);
    const row = result.rows[0]; return row ? { id:row.id,email:row.email,passwordHash:row.password_hash } : null;
  }
  async memberships(userId: string): Promise<Membership[]> {
    const result = await this.pool.query<{tenant_id:string;role:"owner"|"viewer"}>(`select tenant_id,role from tenant_memberships where user_id=$1 and status='active' order by tenant_id`, [userId]);
    const memberships = await Promise.all(result.rows.map(async row => {
      const brand = await withTenantTransaction(this.pool, row.tenant_id, async client => {
        const tenant = await client.query<{display_name:string}>("select display_name from tenants where id=$1", [row.tenant_id]);
        return tenant.rows[0]?.display_name ?? null;
      });
      return brand ? { tenantId:row.tenant_id, brandName:brand, role:row.role } : null;
    }));
    return memberships.filter((membership): membership is Membership => membership !== null);
  }
  async createSession(input:{userId:string;tokenHash:string;selectedTenantId:string|null;expiresAt:Date;now:Date}): Promise<string> {
    const id=randomUUID(); await this.pool.query(`insert into user_sessions(id,user_id,token_sha256,selected_tenant_id,expires_at,last_used_at,created_at) values($1,$2,$3,$4,$5,$6,$6)`,[id,input.userId,input.tokenHash,input.selectedTenantId,input.expiresAt,input.now]); return id;
  }
  async resolveSession(tokenHash: string, now = new Date()): Promise<ResolvedSession | null> {
    const result=await this.pool.query<{id:string;user_id:string;email:string;selected_tenant_id:string|null;expires_at:Date}>(`select s.id,s.user_id,u.email,s.selected_tenant_id,s.expires_at from user_sessions s join platform_users u on u.id=s.user_id where s.token_sha256=$1 and s.revoked_at is null and s.expires_at>$2 and u.status='active'`,[tokenHash,now]);
    const row=result.rows[0]; if(!row)return null; await this.pool.query(`update user_sessions set last_used_at=$2 where id=$1 and last_used_at<($2::timestamptz-interval '5 minutes')`,[row.id,now]); return {id:row.id,userId:row.user_id,email:row.email,selectedTenantId:row.selected_tenant_id,expiresAt:row.expires_at.toISOString()};
  }
  async revoke(tokenHash:string, now=new Date()):Promise<ResolvedSession|null>{const session=await this.resolveSession(tokenHash,now);if(!session)return null;await this.pool.query(`update user_sessions set revoked_at=$2 where id=$1 and revoked_at is null`,[session.id,now]);return session;}
  async selectWorkspace(sessionId:string,userId:string,tenantId:string):Promise<boolean>{const result=await this.pool.query(`update user_sessions s set selected_tenant_id=$3,last_used_at=now() where s.id=$1 and s.user_id=$2 and exists(select 1 from tenant_memberships m where m.user_id=$2 and m.tenant_id=$3 and m.status='active')`,[sessionId,userId,tenantId]);return result.rowCount===1;}
  async recordEvent(input:{type:string;userId?:string;sessionId?:string;subject:string;detail?:Record<string,unknown>}):Promise<void>{await this.pool.query(`insert into auth_security_events(id,event_type,user_id,session_id,subject_sha256,detail,occurred_at) values($1,$2,$3,$4,$5,$6::jsonb,now())`,[randomUUID(),input.type,input.userId??null,input.sessionId??null,tokenSha256(input.subject),JSON.stringify(input.detail??{})]);}
}
