/**
 * Security Rules Merge
 *
 * Deep-merges per-app security overrides onto the default ruleset.
 * Apps can ADD sources (CSP directives, redirect domains) but cannot
 * remove defaults or disable LOCKED rules.
 */

import { DEFAULT_SECURITY_RULES } from './defaults';
import type { SecurityRuleSet } from './types';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** CSP source values that are too permissive for sensitive directives */
const BLOCKED_CSP_SOURCES = ['*', "'unsafe-eval'"];
/** Directives where wildcard / unsafe-eval must never appear */
const SENSITIVE_DIRECTIVES = new Set([
  'script-src',
  'default-src',
  'object-src',
  'base-uri',
]);

/**
 * Validate a single CSP source string.
 * Returns true if the source is acceptable for the given directive.
 */
function isValidCspSource(directive: string, source: string): boolean {
  if (typeof source !== 'string' || source.length === 0) return false;
  if (SENSITIVE_DIRECTIVES.has(directive) && BLOCKED_CSP_SOURCES.includes(source)) {
    return false;
  }
  return true;
}

/**
 * Resolve the effective security rules for an app.
 * Returns DEFAULT_SECURITY_RULES if no overrides are provided.
 */
export function resolveSecurityRules(
  appOverrides?: DeepPartial<SecurityRuleSet>
): SecurityRuleSet {
  if (!appOverrides) return DEFAULT_SECURITY_RULES;

  const merged = structuredClone(DEFAULT_SECURITY_RULES);

  // --- LOCKED RULES: enforce even if override tries to disable ---
  // content.forceSanitize, content.blockDangerousSchemes, headers.contentTypeOptions
  // These are never overridden — the clone already has them enabled.

  // --- CSP directives: additive merge (app can ADD sources, not remove) ---
  if (appOverrides.headers?.csp?.directives) {
    for (const [directive, sources] of Object.entries(appOverrides.headers.csp.directives)) {
      if (!Array.isArray(sources)) continue;
      // Guard against prototype pollution keys that could crash or corrupt objects
      if (directive === '__proto__' || directive === 'constructor' || directive === 'prototype') continue;
      // Filter out invalid/dangerous sources
      const safeSources = sources.filter(s => isValidCspSource(directive, s));
      if (safeSources.length === 0) continue;

      if (merged.headers.csp.directives[directive]) {
        const combined = new Set([
          ...merged.headers.csp.directives[directive],
          ...safeSources,
        ]);
        merged.headers.csp.directives[directive] = Array.from(combined);
      } else {
        merged.headers.csp.directives[directive] = [...safeSources];
      }
    }
  }

  // CSP report-only can be toggled by app (to enforce stricter)
  if (appOverrides.headers?.csp?.reportOnly !== undefined) {
    merged.headers.csp.reportOnly = appOverrides.headers.csp.reportOnly;
  }

  // --- Frame protection: app can relax (e.g., allow embedding from their own domain) ---
  if (appOverrides.headers?.frameProtection?.allowedOrigins) {
    const validOrigins = appOverrides.headers.frameProtection.allowedOrigins.filter(
      o => typeof o === 'string' && o.length > 0 && o !== '*'
    );
    merged.headers.frameProtection.allowedOrigins = Array.from(new Set([
      ...merged.headers.frameProtection.allowedOrigins,
      ...validOrigins,
    ]));
  }

  // --- Navigation: app can add redirect domains ---
  if (appOverrides.navigation?.allowedRedirectDomains) {
    const validDomains = appOverrides.navigation.allowedRedirectDomains.filter(
      d => typeof d === 'string' && d.length > 0
    );
    merged.navigation.allowedRedirectDomains = Array.from(new Set([
      ...merged.navigation.allowedRedirectDomains,
      ...validDomains,
    ]));
  }

  // --- Expression limits: app can tighten (lower) but not loosen (raise) ---
  // Also clamp to sane minimum (1) to prevent negative or zero values
  if (appOverrides.expression?.maxExpressionLength !== undefined) {
    const val = Number(appOverrides.expression.maxExpressionLength);
    if (Number.isFinite(val) && val > 0) {
      merged.expression.maxExpressionLength = Math.min(
        val,
        DEFAULT_SECURITY_RULES.expression.maxExpressionLength
      );
    }
  }
  if (appOverrides.expression?.maxAstDepth !== undefined) {
    const val = Number(appOverrides.expression.maxAstDepth);
    if (Number.isFinite(val) && val > 0) {
      merged.expression.maxAstDepth = Math.min(
        val,
        DEFAULT_SECURITY_RULES.expression.maxAstDepth
      );
    }
  }

  return merged;
}
