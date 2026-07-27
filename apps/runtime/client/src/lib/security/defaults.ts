/**
 * Default Security Rules — Secure Baseline
 *
 * These defaults are applied to all apps. Per-app overrides can
 * ADD sources to CSP directives and redirect allowlists, but cannot
 * remove defaults or disable LOCKED rules.
 */

import type { SecurityRuleSet } from './types';

export const DEFAULT_SECURITY_RULES: SecurityRuleSet = {
  version: '1.0',

  headers: {
    csp: {
      enabled: true,
      reportOnly: true, // Start report-only, switch to enforce after validation
      directives: {
        'default-src': ["'self'"],
        'script-src': [
          "'self'",
          "'unsafe-inline'", // Phase 2 replaces with nonce
          'https://ga.jspm.io',
          'https://cdn.exepad.com',
          'blob:',
        ],
        'style-src': [
          "'self'",
          "'unsafe-inline'", // Required for Tailwind + theme injection
          'https://fonts.googleapis.com',
        ],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': [
          "'self'",
          'data:',
          'https://storage.googleapis.com',
          'https://images.unsplash.com',
          'https://images.pexels.com',
          'https://pixabay.com',
          'https://cdn.pixabay.com',
          'https://api.openverse.org',
          'https://via.placeholder.com',
          'https://placehold.co',
          'https://picsum.photos',
          'https://cdn.exepad.com',
        ],
        'connect-src': [
          "'self'",
          'https://backend.exepad.com',
          'wss://backend.exepad.com',
          'https://storage.googleapis.com',
        ],
        'frame-src': [
          "'self'",
          'https://www.youtube.com',
          'https://player.vimeo.com',
          'https://www.google.com',
          'https://docs.google.com',
          'https://www.openstreetmap.org',
          'https://maps.google.com',
        ],
        'frame-ancestors': ["'self'", 'https://app.exepad.com'],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    frameProtection: {
      enabled: true,
      mode: 'sameorigin',
      allowedOrigins: ['https://app.exepad.com'],
    },
    contentTypeOptions: { enabled: true },
    referrerPolicy: {
      enabled: true,
      policy: 'strict-origin-when-cross-origin',
    },
    permissionsPolicy: {
      enabled: true,
      directives: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: ["'self'"],
        usb: [],
        autoplay: ["'self'"],
      },
    },
  },

  content: {
    forceSanitize: { enabled: true },
    blockDangerousSchemes: { enabled: true },
  },

  navigation: {
    allowedRedirectDomains: ['exepad.com', 'exepad.app'],
  },

  expression: {
    maxExpressionLength: 2000,
    maxAstDepth: 50,
  },
};
