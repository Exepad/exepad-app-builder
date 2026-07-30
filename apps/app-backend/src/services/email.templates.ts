/**
 * Email Template Engine
 *
 * Simple {{variable}} interpolation with HTML escaping.
 * Supports dot notation ({{user.name}}) and nested values.
 * No logic, no conditionals, no loops — complex layouts use raw html.
 *
 * Resolution chain: app-defined templates → platform: built-in → error.
 */

// ── Interpolation Engine ────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] || ch);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Interpolate {{variable}} placeholders in a template string.
 * Values are HTML-escaped. Missing variables are left as-is.
 */
export function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    const value = getNestedValue(data, key);
    if (value === undefined || value === null) return _match;
    return escapeHtml(String(value));
  });
}

// ── Template Resolution ─────────────────────────────────────────

interface ResolvedTemplate {
  subject: string;
  html: string;
}

/**
 * Resolve a template by name.
 *
 * 1. App-defined inline templates (from services.email.templates config)
 * 2. Platform built-in templates (platform:name)
 * 3. Error if not found
 *
 * Returns the interpolated subject and html.
 */
export function resolveTemplate(
  name: string,
  data: Record<string, unknown>,
  appTemplates?: Record<string, { subject: string; html: string }>
): ResolvedTemplate {
  // 1. App-defined template (exact name match)
  if (appTemplates?.[name]) {
    const tmpl = appTemplates[name];
    return {
      subject: interpolate(tmpl.subject, data),
      html: interpolate(tmpl.html, data),
    };
  }

  // 2. Platform built-in template (platform:name)
  const platformName = name.startsWith('platform:') ? name.slice('platform:'.length) : name;
  const platformTmpl = PLATFORM_TEMPLATES[platformName];
  if (platformTmpl) {
    return {
      subject: interpolate(platformTmpl.subject, data),
      html: interpolate(platformTmpl.html, data),
    };
  }

  throw new Error(`Email template not found: "${name}"`);
}

// ── Platform Built-in Templates ─────────────────────────────────

const BASE_STYLES = `
  body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .container { max-width: 580px; margin: 0 auto; padding: 40px 20px; }
  .card { background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .header { text-align: center; margin-bottom: 24px; }
  .header h1 { color: #1a1a1a; font-size: 22px; font-weight: 600; margin: 0; }
  .body-text { color: #4a4a4a; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0; }
  .btn { display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 15px; }
  .footer { text-align: center; margin-top: 32px; color: #9ca3af; font-size: 13px; line-height: 1.5; }
`;

function wrapTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body><div class="container"><div class="card">${content}</div></div></body>
</html>`;
}

const PLATFORM_TEMPLATES: Record<string, { subject: string; html: string }> = {
  'password-reset': {
    subject: 'Reset your password — {{appName}}',
    html: wrapTemplate(`
      <div class="header"><h1>Password Reset</h1></div>
      <p class="body-text">You requested a password reset for your account at <strong>{{appName}}</strong>.</p>
      <p class="body-text">Click the button below to set a new password. This link expires in {{expiresIn}}.</p>
      <p style="text-align: center; margin: 28px 0;"><a href="{{resetUrl}}" class="btn" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 15px;">Reset Password</a></p>
      <p class="body-text" style="font-size: 13px; color: #9ca3af;">If you didn't request this, you can safely ignore this email.</p>
      <div class="footer"><p>{{appName}}</p></div>
    `),
  },

  'email-verification': {
    subject: 'Verify your email — {{appName}}',
    html: wrapTemplate(`
      <div class="header"><h1>Verify Your Email</h1></div>
      <p class="body-text">Welcome to <strong>{{appName}}</strong>! Please verify your email address to complete your registration.</p>
      <p style="text-align: center; margin: 28px 0;"><a href="{{verifyUrl}}" class="btn">Verify Email</a></p>
      <p class="body-text" style="font-size: 13px; color: #9ca3af;">If you didn't create an account, you can safely ignore this email.</p>
      <div class="footer"><p>{{appName}}</p></div>
    `),
  },

  'welcome': {
    subject: 'Welcome to {{appName}}!',
    html: wrapTemplate(`
      <div class="header"><h1>Welcome, {{userName}}!</h1></div>
      <p class="body-text">Thanks for joining <strong>{{appName}}</strong>. Your account has been created successfully.</p>
      <p style="text-align: center; margin: 28px 0;"><a href="{{appUrl}}" class="btn">Get Started</a></p>
      <div class="footer"><p>{{appName}}</p></div>
    `),
  },
};
