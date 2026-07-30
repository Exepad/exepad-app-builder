/**
 * Auth access check utilities — pure functions (no React dependencies).
 *
 * Used by page guards and nav filtering to determine if the current user
 * can access a page based on its AccessLevel.
 */

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { id: string; email: string; name?: string; roles?: string[] } | null;
  roles: string[];
  error: string | null;
}

export type AccessCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'loading' }
  | { allowed: false; reason: 'unauthenticated' }
  | { allowed: false; reason: 'forbidden'; requiredRole?: string };

/**
 * Check if the current auth state satisfies an access level requirement.
 *
 * @param access - The page's access level
 * @param auth - Current auth state from the store
 * @param roleExpansionMap - Pre-resolved role hierarchy (role → all effective roles)
 */
export function checkPageAccess(
  access: string | undefined,
  auth: AuthState,
  roleExpansionMap?: Record<string, string[]>
): AccessCheckResult {
  const effectiveAccess = access ?? 'public';

  // Public pages are always accessible
  if (effectiveAccess === 'public') return { allowed: true };

  // 'none' should not be on pages (validator catches this), but handle gracefully
  if (effectiveAccess === 'none') return { allowed: false, reason: 'forbidden' };

  // All other levels require auth to be resolved first
  if (auth.isLoading) return { allowed: false, reason: 'loading' };

  if (effectiveAccess === 'authenticated') {
    return auth.isAuthenticated
      ? { allowed: true }
      : { allowed: false, reason: 'unauthenticated' };
  }

  // 'owner' on a page doesn't make sense (it's per-record), treat as 'authenticated'
  if (effectiveAccess === 'owner') {
    return auth.isAuthenticated
      ? { allowed: true }
      : { allowed: false, reason: 'unauthenticated' };
  }

  // Role-based: 'role:admin', 'role:editor', etc.
  if (effectiveAccess.startsWith('role:')) {
    if (!auth.isAuthenticated) {
      return { allowed: false, reason: 'unauthenticated' };
    }

    const requiredRole = effectiveAccess.slice(5);
    const userRoles = auth.roles ?? auth.user?.roles ?? [];

    // Direct role check
    if (userRoles.includes(requiredRole)) return { allowed: true };

    // Check via role hierarchy expansion
    if (roleExpansionMap) {
      for (const userRole of userRoles) {
        const expandedRoles = roleExpansionMap[userRole];
        if (expandedRoles && expandedRoles.includes(requiredRole)) {
          return { allowed: true };
        }
      }
    }

    return { allowed: false, reason: 'forbidden', requiredRole };
  }

  // Legacy 'admin' (should have been normalized, but handle it)
  if (effectiveAccess === 'admin') {
    if (!auth.isAuthenticated) {
      return { allowed: false, reason: 'unauthenticated' };
    }
    const userRoles = auth.roles ?? auth.user?.roles ?? [];
    return userRoles.includes('admin')
      ? { allowed: true }
      : { allowed: false, reason: 'forbidden', requiredRole: 'admin' };
  }

  // Unknown access level — deny for safety, log a warning
  console.warn(`[authAccess] Unknown access level: "${effectiveAccess}". Denying access.`);
  return auth.isAuthenticated
    ? { allowed: false, reason: 'forbidden' }
    : { allowed: false, reason: 'unauthenticated' };
}

/**
 * Determine if a nav item should be visible based on page access.
 * Returns true during loading (prevents flash where nav is empty).
 */
export function canAccessPage(
  access: string | undefined,
  auth: AuthState,
  roleExpansionMap?: Record<string, string[]>
): boolean {
  const result = checkPageAccess(access, auth, roleExpansionMap);
  // While loading, assume accessible (prevents nav flash)
  if (!result.allowed && result.reason === 'loading') return true;
  return result.allowed;
}
