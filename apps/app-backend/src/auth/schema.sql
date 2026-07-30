-- ============================================================================
-- Per-App Auth System Tables
-- Prefixed with _auth_ to separate from user-defined models.
-- Created automatically when backend.security is present in app config.
-- ============================================================================

-- Users: one row per end-user of the app
CREATE TABLE IF NOT EXISTS _auth_users (
  id            TEXT PRIMARY KEY,               -- UUID v4
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,                           -- NULL for social/SSO-only users
  email_verified INTEGER DEFAULT 0,
  name          TEXT,
  avatar_url    TEXT,
  roles         TEXT DEFAULT 'user',            -- comma-separated: 'user', 'admin', 'user,admin'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON _auth_users(email);

-- Sessions: one row per active login session
CREATE TABLE IF NOT EXISTS _auth_sessions (
  id            TEXT PRIMARY KEY,               -- SHA-256 hash of raw session token
  user_id       TEXT NOT NULL REFERENCES _auth_users(id) ON DELETE CASCADE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON _auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON _auth_sessions(expires_at);

-- Provider accounts: links users to auth providers (email, google, exepad)
CREATE TABLE IF NOT EXISTS _auth_accounts (
  id                  TEXT PRIMARY KEY,         -- UUID v4
  user_id             TEXT NOT NULL REFERENCES _auth_users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,            -- 'email' | 'google' | 'exepad'
  provider_account_id TEXT NOT NULL,            -- email address, google sub, platform user id
  access_token        TEXT,                     -- OAuth access token (encrypted)
  refresh_token       TEXT,                     -- OAuth refresh token (encrypted)
  expires_at          TEXT,                     -- OAuth token expiry
  UNIQUE(provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_accounts_user_id ON _auth_accounts(user_id);

-- Verification tokens: email verification + password reset
CREATE TABLE IF NOT EXISTS _auth_verification_tokens (
  token       TEXT PRIMARY KEY,                 -- random token (hashed)
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,                    -- 'email_verify' | 'password_reset'
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_verification_tokens_user_id ON _auth_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_verification_tokens_expires_at ON _auth_verification_tokens(expires_at);
