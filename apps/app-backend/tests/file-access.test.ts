/**
 * Tests for file access control
 *
 * Covers: FilePolicyProps enforcement, visibility-based ownership,
 * public/authenticated/role/none/owner access levels.
 */

import { describe, it, expect } from 'vitest';
import { checkFileAccess, type FileRecord } from '../src/file/access';
import { UnauthorizedError, ForbiddenError } from '../src/utils/errors';
import type { StorageProps } from '@exepad/types';
import type { UserContext } from '../src/rpc/types';

// ── Fixtures ──

const authUser: UserContext = {
  id: 'user-123',
  email: 'user@test.com',
  roles: [],
  isAuthenticated: true,
  authMethod: 'platform_header',
};

const adminUser: UserContext = {
  id: 'admin-1',
  email: 'admin@test.com',
  roles: ['admin'],
  isAuthenticated: true,
  authMethod: 'platform_header',
};

const anonUser: UserContext = {
  id: '',
  email: '',
  roles: [],
  isAuthenticated: false,
  authMethod: 'platform_header',
};

const editorUser: UserContext = {
  id: 'editor-1',
  email: 'editor@test.com',
  roles: ['editor'],
  isAuthenticated: true,
  authMethod: 'platform_header',
};

function makeStorage(overrides?: Partial<StorageProps>): StorageProps {
  return { enabled: true, ...overrides };
}

function makeFile(overrides?: Partial<FileRecord>): FileRecord {
  return {
    id: 'file-1',
    owner_id: 'user-123',
    app_id: 'app-1',
    filename: 'test.jpg',
    content_type: 'image/jpeg',
    size_bytes: 1024,
    r2_key: 'app-1/user-123/file-1/test.jpg',
    visibility: 'private',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────
// Default policy (authenticated)
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — default authenticated policy', () => {
  const storage = makeStorage();

  it('allows authenticated user for upload', () => {
    expect(() => checkFileAccess(authUser, storage, 'upload')).not.toThrow();
  });

  it('rejects unauthenticated user for upload', () => {
    expect(() => checkFileAccess(anonUser, storage, 'upload')).toThrow(UnauthorizedError);
  });

  it('allows authenticated user for download without file', () => {
    expect(() => checkFileAccess(authUser, storage, 'download')).not.toThrow();
  });

  it('rejects unauthenticated user for download', () => {
    expect(() => checkFileAccess(anonUser, storage, 'download')).toThrow(UnauthorizedError);
  });

  it('allows list for authenticated user', () => {
    expect(() => checkFileAccess(authUser, storage, 'list')).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────
// Ownership checks (with file record)
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — ownership', () => {
  const storage = makeStorage();

  it('allows owner to download their private file', () => {
    const file = makeFile({ owner_id: 'user-123', visibility: 'private' });
    expect(() => checkFileAccess(authUser, storage, 'download', file)).not.toThrow();
  });

  it('denies non-owner from downloading private file', () => {
    const otherUser: UserContext = { ...authUser, id: 'other-user' };
    const file = makeFile({ owner_id: 'user-123', visibility: 'private' });
    expect(() => checkFileAccess(otherUser, storage, 'download', file)).toThrow(ForbiddenError);
  });

  it('allows admin to download any private file', () => {
    const file = makeFile({ owner_id: 'someone-else', visibility: 'private' });
    expect(() => checkFileAccess(adminUser, storage, 'download', file)).not.toThrow();
  });

  it('allows any authenticated user to download shared file', () => {
    const otherUser: UserContext = { ...authUser, id: 'other-user' };
    const file = makeFile({ visibility: 'shared' });
    expect(() => checkFileAccess(otherUser, storage, 'download', file)).not.toThrow();
  });

  it('allows any authenticated user to download public file', () => {
    const otherUser: UserContext = { ...authUser, id: 'other-user' };
    const file = makeFile({ visibility: 'public' });
    expect(() => checkFileAccess(otherUser, storage, 'download', file)).not.toThrow();
  });

  it('does not check ownership for list operations', () => {
    const file = makeFile({ owner_id: 'someone-else', visibility: 'private' });
    // List with file arg should not throw (ownership not checked for list)
    expect(() => checkFileAccess(authUser, storage, 'list', file)).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────
// Delete is an OWNERSHIP action — 'shared'/'public' visibility grants READ,
// never the right to delete another user's file.
// Regression: before the fix, checkFileOwnership returned early for any
// shared (authenticated) or public file, so any authenticated user could
// delete another user's shared/public file.
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — delete is owner-only regardless of visibility', () => {
  const storage = makeStorage(); // default: delete -> 'authenticated'
  const otherUser: UserContext = { ...authUser, id: 'other-user' };

  it('denies a non-owner from deleting a SHARED file', () => {
    const file = makeFile({ owner_id: 'user-123', visibility: 'shared' });
    expect(() => checkFileAccess(otherUser, storage, 'delete', file)).toThrow(ForbiddenError);
  });

  it('denies a non-owner from deleting a PUBLIC file', () => {
    const file = makeFile({ owner_id: 'user-123', visibility: 'public' });
    expect(() => checkFileAccess(otherUser, storage, 'delete', file)).toThrow(ForbiddenError);
  });

  it('allows the owner to delete their own shared file', () => {
    const file = makeFile({ owner_id: 'user-123', visibility: 'shared' });
    expect(() => checkFileAccess(authUser, storage, 'delete', file)).not.toThrow();
  });

  it('allows an admin to delete any shared file', () => {
    const file = makeFile({ owner_id: 'someone-else', visibility: 'shared' });
    expect(() => checkFileAccess(adminUser, storage, 'delete', file)).not.toThrow();
  });

  it('still lets any authenticated user DOWNLOAD a shared file (read is unchanged)', () => {
    const file = makeFile({ owner_id: 'user-123', visibility: 'shared' });
    expect(() => checkFileAccess(otherUser, storage, 'download', file)).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────
// Public policy
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — public policy', () => {
  const storage = makeStorage({ filePolicy: { download: 'public', list: 'public' } });

  it('allows unauthenticated download', () => {
    expect(() => checkFileAccess(anonUser, storage, 'download')).not.toThrow();
  });

  it('allows unauthenticated list', () => {
    expect(() => checkFileAccess(anonUser, storage, 'list')).not.toThrow();
  });

  it('still requires auth for upload even with public download', () => {
    const uploadStorage = makeStorage({ filePolicy: { upload: 'public' } });
    expect(() => checkFileAccess(anonUser, uploadStorage, 'upload')).toThrow(UnauthorizedError);
  });

  it('still requires auth for delete even with public policy', () => {
    const deleteStorage = makeStorage({ filePolicy: { delete: 'public' } });
    expect(() => checkFileAccess(anonUser, deleteStorage, 'delete')).toThrow(UnauthorizedError);
  });
});

// ───────────────────────────────────────────────────────────────────
// publicAccess shortcut
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — publicAccess flag', () => {
  const storage = makeStorage({ publicAccess: true });

  it('allows unauthenticated download when publicAccess is true', () => {
    expect(() => checkFileAccess(anonUser, storage, 'download')).not.toThrow();
  });

  it('still requires auth for write ops', () => {
    expect(() => checkFileAccess(anonUser, storage, 'upload')).toThrow(UnauthorizedError);
    expect(() => checkFileAccess(anonUser, storage, 'delete')).toThrow(UnauthorizedError);
  });

  // Regression: app-level public access must NOT override a per-file privacy
  // choice. Before the fix, the public branch returned without ever calling
  // checkFileOwnership, so a `visibility: 'private'` file was served to anyone.
  it('still owner-gates a PRIVATE file download even under publicAccess', () => {
    const priv = makeFile({ owner_id: 'user-123', visibility: 'private' });
    // anonymous + non-owner are denied; owner + admin pass
    expect(() => checkFileAccess(anonUser, storage, 'download', priv)).toThrow(ForbiddenError);
    expect(() => checkFileAccess(editorUser, storage, 'download', priv)).toThrow(ForbiddenError);
    expect(() => checkFileAccess(authUser, storage, 'download', priv)).not.toThrow();
    expect(() => checkFileAccess(adminUser, storage, 'download', priv)).not.toThrow();
  });

  it('owner-gates a PRIVATE file delete even under publicAccess', () => {
    const priv = makeFile({ owner_id: 'user-123', visibility: 'private' });
    // delete by a non-owner authenticated user is denied (auth passes, ownership fails)
    expect(() => checkFileAccess(editorUser, storage, 'delete', priv)).toThrow(ForbiddenError);
    expect(() => checkFileAccess(authUser, storage, 'delete', priv)).not.toThrow();
  });

  it('still serves PUBLIC and SHARED files to anyone under publicAccess', () => {
    const pub = makeFile({ owner_id: 'someone-else', visibility: 'public' });
    const shared = makeFile({ owner_id: 'someone-else', visibility: 'shared' });
    expect(() => checkFileAccess(anonUser, storage, 'download', pub)).not.toThrow();
    expect(() => checkFileAccess(anonUser, storage, 'download', shared)).not.toThrow();
  });

  it('owner-gates a SHARED/PUBLIC file delete even under publicAccess', () => {
    const shared = makeFile({ owner_id: 'user-123', visibility: 'shared' });
    const pub = makeFile({ owner_id: 'user-123', visibility: 'public' });
    // A non-owner authenticated user cannot delete a shared/public file (auth
    // passes, ownership fails); the owner can.
    expect(() => checkFileAccess(editorUser, storage, 'delete', shared)).toThrow(ForbiddenError);
    expect(() => checkFileAccess(editorUser, storage, 'delete', pub)).toThrow(ForbiddenError);
    expect(() => checkFileAccess(authUser, storage, 'delete', shared)).not.toThrow();
  });

  it('also owner-gates a PRIVATE file when only filePolicy.download is public', () => {
    const dlPublic = makeStorage({ filePolicy: { download: 'public' as any } });
    const priv = makeFile({ owner_id: 'user-123', visibility: 'private' });
    expect(() => checkFileAccess(anonUser, dlPublic, 'download', priv)).toThrow(ForbiddenError);
    expect(() => checkFileAccess(authUser, dlPublic, 'download', priv)).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────
// Role-based policy
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — role-based policy', () => {
  const storage = makeStorage({ filePolicy: { upload: 'role:editor' as any } });

  it('allows user with required role', () => {
    expect(() => checkFileAccess(editorUser, storage, 'upload')).not.toThrow();
  });

  it('denies user without required role', () => {
    expect(() => checkFileAccess(authUser, storage, 'upload')).toThrow(ForbiddenError);
  });

  it('denies unauthenticated user', () => {
    expect(() => checkFileAccess(anonUser, storage, 'upload')).toThrow(UnauthorizedError);
  });
});

// ───────────────────────────────────────────────────────────────────
// 'none' policy — permanently disabled
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — none policy', () => {
  const storage = makeStorage({ filePolicy: { upload: 'none' } });

  it('denies even authenticated users', () => {
    expect(() => checkFileAccess(authUser, storage, 'upload')).toThrow(ForbiddenError);
  });

  it('denies admin users', () => {
    expect(() => checkFileAccess(adminUser, storage, 'upload')).toThrow(ForbiddenError);
  });
});

// ───────────────────────────────────────────────────────────────────
// 'owner' policy — explicit ownership enforcement
// ───────────────────────────────────────────────────────────────────
describe('checkFileAccess — owner policy', () => {
  const storage = makeStorage({ filePolicy: { download: 'owner' as any } });

  it('allows owner to download their own file', () => {
    const file = makeFile({ owner_id: 'user-123', visibility: 'private' });
    expect(() => checkFileAccess(authUser, storage, 'download', file)).not.toThrow();
  });

  it('denies non-owner from downloading private file', () => {
    const otherUser: UserContext = { ...authUser, id: 'other-user' };
    const file = makeFile({ owner_id: 'user-123', visibility: 'private' });
    expect(() => checkFileAccess(otherUser, storage, 'download', file)).toThrow(ForbiddenError);
  });

  it('requires auth', () => {
    expect(() => checkFileAccess(anonUser, storage, 'download')).toThrow(UnauthorizedError);
  });
});
