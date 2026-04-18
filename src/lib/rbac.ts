/**
 * AgentDyne — Role-Based Access Control (RBAC)
 *
 * Three-tier role system:
 *   user     — default: can browse marketplace, execute agents, create agents
 *   seller   — can publish agents, view their own analytics/earnings
 *   admin    — full platform access: approve agents, manage users, view all data
 *
 * Usage in API routes:
 *   const rbac = await getRBAC(supabase, userId)
 *   if (!rbac.can("approve_agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
 *
 * Edge-runtime safe: no Node.js APIs.
 */

export type UserRole = "user" | "seller" | "admin"

export type Permission =
  // Agent permissions
  | "create_agent"
  | "edit_own_agent"
  | "delete_own_agent"
  | "submit_agent_for_review"
  | "approve_agent"        // admin only
  | "reject_agent"         // admin only
  | "suspend_agent"        // admin only
  | "view_any_agent_draft" // admin only
  // Pipeline permissions
  | "create_pipeline"
  | "edit_own_pipeline"
  | "delete_own_pipeline"
  | "execute_pipeline"
  // Marketplace
  | "execute_agent"
  | "post_review"
  | "view_marketplace"
  // Analytics/earnings
  | "view_own_analytics"
  | "view_own_earnings"
  | "request_payout"
  | "view_all_analytics"   // admin only
  // API keys
  | "create_api_key"
  | "revoke_api_key"
  // Admin
  | "manage_users"
  | "view_audit_logs"
  | "view_injection_attempts"
  | "manage_platform"
  | "view_all_executions"

const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  user: new Set<Permission>([
    "view_marketplace",
    "execute_agent",
    "execute_pipeline",
    "create_agent",
    "edit_own_agent",
    "delete_own_agent",
    "submit_agent_for_review",
    "create_pipeline",
    "edit_own_pipeline",
    "delete_own_pipeline",
    "post_review",
    "create_api_key",
    "revoke_api_key",
    "view_own_analytics",
    "view_own_earnings",
  ]),
  seller: new Set<Permission>([
    "view_marketplace",
    "execute_agent",
    "execute_pipeline",
    "create_agent",
    "edit_own_agent",
    "delete_own_agent",
    "submit_agent_for_review",
    "create_pipeline",
    "edit_own_pipeline",
    "delete_own_pipeline",
    "post_review",
    "create_api_key",
    "revoke_api_key",
    "view_own_analytics",
    "view_own_earnings",
    "request_payout",
  ]),
  admin: new Set<Permission>([
    // All user + seller permissions
    "view_marketplace",
    "execute_agent",
    "execute_pipeline",
    "create_agent",
    "edit_own_agent",
    "delete_own_agent",
    "submit_agent_for_review",
    "create_pipeline",
    "edit_own_pipeline",
    "delete_own_pipeline",
    "post_review",
    "create_api_key",
    "revoke_api_key",
    "view_own_analytics",
    "view_own_earnings",
    "request_payout",
    // Admin-only
    "approve_agent",
    "reject_agent",
    "suspend_agent",
    "view_any_agent_draft",
    "manage_users",
    "view_audit_logs",
    "view_injection_attempts",
    "manage_platform",
    "view_all_analytics",
    "view_all_executions",
  ]),
}

export interface RBACContext {
  userId:  string
  role:    UserRole
  can:     (permission: Permission) => boolean
  canAll:  (permissions: Permission[]) => boolean
  canAny:  (permissions: Permission[]) => boolean
  isAdmin: boolean
  isSeller: boolean
}

/** Build RBAC context from a role string */
export function buildRBAC(userId: string, role: string | null | undefined): RBACContext {
  const normalizedRole: UserRole =
    role === "admin" ? "admin" : role === "seller" ? "seller" : "user"

  const perms = ROLE_PERMISSIONS[normalizedRole]

  return {
    userId,
    role:    normalizedRole,
    can:     (p) => perms.has(p),
    canAll:  (ps) => ps.every(p => perms.has(p)),
    canAny:  (ps) => ps.some(p => perms.has(p)),
    isAdmin:  normalizedRole === "admin",
    isSeller: normalizedRole === "seller" || normalizedRole === "admin",
  }
}

/**
 * getRBAC — fetch user's role from DB and return RBAC context
 * Use in API routes that need permission checks.
 */
export async function getRBAC(supabase: any, userId: string): Promise<RBACContext> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  return buildRBAC(userId, data?.role)
}

/**
 * requireRole — throws-style guard for inline use in API routes.
 * Returns 403 NextResponse if permission denied.
 *
 * Usage:
 *   const deny = requirePermission(rbac, "approve_agent")
 *   if (deny) return deny
 */
export function requirePermission(
  rbac: RBACContext,
  permission: Permission
): { error: string; status: number } | null {
  if (rbac.can(permission)) return null
  return { error: `Permission denied: ${permission}`, status: 403 }
}

/**
 * assertOwnership — checks that the requesting user owns the resource.
 * Returns 403 NextResponse if not owner and not admin.
 */
export function assertOwnership(
  rbac:       RBACContext,
  ownerId:    string
): { error: string; status: number } | null {
  if (rbac.isAdmin || rbac.userId === ownerId) return null
  return { error: "You do not have permission to modify this resource", status: 403 }
}
