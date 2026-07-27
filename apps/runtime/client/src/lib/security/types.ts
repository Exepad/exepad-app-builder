/**
 * Security Rules Type Definitions
 *
 * Rule-based, plug-and-play security configuration.
 * Each rule is independently toggleable. Per-app overrides
 * are merged onto defaults at runtime.
 */

export interface BooleanRule {
  enabled: boolean;
}

export interface CspRule {
  enabled: boolean;
  /** CSP directives map, e.g. { 'script-src': ["'self'", "https://cdn.example.com"] } */
  directives: Record<string, string[]>;
  /** Start in report-only mode (logs violations without blocking) */
  reportOnly: boolean;
}

export interface FrameRule {
  enabled: boolean;
  mode: 'deny' | 'sameorigin';
  /** Origins allowed to embed this app (maps to frame-ancestors CSP directive) */
  allowedOrigins: string[];
}

export interface ReferrerRule {
  enabled: boolean;
  policy:
    | 'no-referrer'
    | 'no-referrer-when-downgrade'
    | 'origin'
    | 'origin-when-cross-origin'
    | 'same-origin'
    | 'strict-origin'
    | 'strict-origin-when-cross-origin';
}

export interface PermissionsPolicyRule {
  enabled: boolean;
  /** Feature → allowlist, e.g. { camera: [], microphone: [], payment: ["'self'"] } */
  directives: Record<string, string[]>;
}

export interface SecurityRuleSet {
  version: '1.0';

  // --- HTTP Headers (enforced at middleware layer) ---
  headers: {
    csp: CspRule;
    frameProtection: FrameRule;
    contentTypeOptions: BooleanRule;
    referrerPolicy: ReferrerRule;
    permissionsPolicy: PermissionsPolicyRule;
  };

  // --- Content Security (enforced at component layer) ---
  content: {
    /** Force sanitize=true on all markdown components (LOCKED — cannot be disabled) */
    forceSanitize: BooleanRule;
    /** Block javascript:, data:, vbscript: in all URL contexts (LOCKED) */
    blockDangerousSchemes: BooleanRule;
  };

  // --- Navigation Security (enforced at action/component layer) ---
  navigation: {
    /** Domains allowed for external redirects. Same-origin is always allowed. */
    allowedRedirectDomains: string[];
  };

  // --- Expression Security (enforced at expression parser layer) ---
  expression: {
    /** Max character length for a single expression */
    maxExpressionLength: number;
    /** Max AST recursion depth during evaluation */
    maxAstDepth: number;
  };
}

/** Rules that CANNOT be relaxed by per-app overrides */
export const LOCKED_RULES = [
  'content.forceSanitize',
  'content.blockDangerousSchemes',
  'headers.contentTypeOptions',
] as const;
