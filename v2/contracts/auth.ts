import { z } from "zod";

export const workspaceMembershipSchema = z.object({
  tenantId: z.string().uuid(),
  brandName: z.string().min(1),
  role: z.enum(["owner", "viewer"]),
});

export const authSessionSchema = z.object({
  authenticated: z.literal(true),
  user: z.object({ email: z.string().email() }),
  selectedTenantId: z.string().uuid().nullable(),
  requiresWorkspaceSelection: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }),
});

export const workspaceListSchema = z.object({ items: z.array(workspaceMembershipSchema) });
export const loginRequestSchema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(1024) });
export type AuthSession = z.infer<typeof authSessionSchema>;
export type WorkspaceMembership = z.infer<typeof workspaceMembershipSchema>;
