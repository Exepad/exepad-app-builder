/**
 * Per-app auth module — handles auth_* RPC methods for Mode B authentication.
 */

export { authSignup } from './handlers/signup';
export { authSignin } from './handlers/signin';
export { authSignout } from './handlers/signout';
export { authMe } from './handlers/me';
export { authRequestReset } from './handlers/request_reset';
export { authResetPassword } from './handlers/reset_password';
export { authVerifyEmail } from './handlers/verify_email';
export { authRequestVerification } from './handlers/request_verification';
export { authSocialLogin } from './handlers/social_login';
export { authSocialComplete } from './handlers/social_complete';
export { validateSession, purgeExpiredSessions } from './session';
export type { AuthResult, AuthHandler, AuthUser } from './types';

// API key management
export {
  authCreateApiKey,
  authListApiKeys,
  authRevokeApiKey,
  authRotateApiKey,
  validateApiKey,
  buildApiKeyUserContext,
  hasScope,
  buildCrudScope,
  buildHandlerScope,
  enforceApiKeyScope,
} from './api-keys';
export type { ApiKeyInfo, CreateApiKeyResult, ValidatedApiKey } from './api-keys';
