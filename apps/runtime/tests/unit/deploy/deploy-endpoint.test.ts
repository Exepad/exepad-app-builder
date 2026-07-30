/**
 * Tests for the deploy Hono router (POST + GET /api/deploy/:appId)
 *
 * Tests the 15-step deploy pipeline logic by mocking all external dependencies:
 * - Cloudflare env bindings (R2, Secrets Store)
 * - deploy-utils functions (D1, WfP, migrations, seeding, etc.)
 * - r2-helpers (deployment status, modules, templates, snapshots)
 * - crypto-utils
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── Mock crypto-utils ──────────────────────────────────────────────

vi.mock('../../../worker/src/lib/crypto-utils', () => ({
  constantTimeEqual: (a: string, b: string) => a === b,
}));

// ── Mock r2-helpers ────────────────────────────────────────────────

const mockSaveDeploymentStatus = vi.fn();
const mockLoadDeploymentStatus = vi.fn();
const mockReadRepoModules = vi.fn();
const mockReadWorkerTemplate = vi.fn();
const mockWritePublishedSnapshot = vi.fn();
const mockWriteSeoSnapshots = vi.fn();
const mockValidatePublishedManifest = vi.fn();

vi.mock('../../../worker/src/lib/r2-helpers', () => ({
  saveDeploymentStatus: (...args: unknown[]) => mockSaveDeploymentStatus(...args),
  loadDeploymentStatus: (...args: unknown[]) => mockLoadDeploymentStatus(...args),
  readRepoModules: (...args: unknown[]) => mockReadRepoModules(...args),
  readWorkerTemplate: (...args: unknown[]) => mockReadWorkerTemplate(...args),
  writePublishedSnapshot: (...args: unknown[]) => mockWritePublishedSnapshot(...args),
  writeSeoSnapshots: (...args: unknown[]) => mockWriteSeoSnapshots(...args),
  validatePublishedManifest: (...args: unknown[]) => mockValidatePublishedManifest(...args),
}));

// ── Mock deploy-utils ──────────────────────────────────────────────

const mockExtractBackendProps = vi.fn();
const mockValidateInjectedConfig = vi.fn();
const mockProvisionD1Database = vi.fn();
const mockProvisionR2Bucket = vi.fn();
const mockCreateAppBackendBindings = vi.fn();
const mockUploadWorkerScript = vi.fn();
const mockGenerateEntryModule = vi.fn();
const mockSeedFromR2 = vi.fn();
const mockResolveStaticSeeds = vi.fn();
const mockApplyMigrations = vi.fn();
const mockPlanMigrations = vi.fn();
const mockSaveDeploymentSnapshot = vi.fn();
const mockGetPreviousSchema = vi.fn();
const mockRollbackSchema = vi.fn();
const mockBackupAppDatabase = vi.fn();
const mockPruneAppDatabaseBackups = vi.fn();
const mockRestoreAppDatabase = vi.fn();
const mockAcquireDeployLock = vi.fn();
const mockReleaseDeployLock = vi.fn();
const mockGenerateFilesDDL = vi.fn();
const mockGenerateServicesDDL = vi.fn();
const mockExecuteD1DDL = vi.fn();
const mockExecuteD1Query = vi.fn();
const mockFindFormComponents = vi.fn();

vi.mock('@exepad/deploy-utils', () => ({
  extractBackendProps: (...args: unknown[]) => mockExtractBackendProps(...args),
  validateInjectedConfig: (...args: unknown[]) => mockValidateInjectedConfig(...args),
  provisionD1Database: (...args: unknown[]) => mockProvisionD1Database(...args),
  provisionR2Bucket: (...args: unknown[]) => mockProvisionR2Bucket(...args),
  createAppBackendBindings: (...args: unknown[]) => mockCreateAppBackendBindings(...args),
  uploadWorkerScript: (...args: unknown[]) => mockUploadWorkerScript(...args),
  generateEntryModule: (...args: unknown[]) => mockGenerateEntryModule(...args),
  seedFromR2: (...args: unknown[]) => mockSeedFromR2(...args),
  resolveStaticSeeds: (...args: unknown[]) => mockResolveStaticSeeds(...args),
  applyMigrations: (...args: unknown[]) => mockApplyMigrations(...args),
  planMigrations: (...args: unknown[]) => mockPlanMigrations(...args),
  saveDeploymentSnapshot: (...args: unknown[]) => mockSaveDeploymentSnapshot(...args),
  getPreviousSchema: (...args: unknown[]) => mockGetPreviousSchema(...args),
  rollbackSchema: (...args: unknown[]) => mockRollbackSchema(...args),
  backupAppDatabase: (...args: unknown[]) => mockBackupAppDatabase(...args),
  pruneAppDatabaseBackups: (...args: unknown[]) => mockPruneAppDatabaseBackups(...args),
  restoreAppDatabase: (...args: unknown[]) => mockRestoreAppDatabase(...args),
  acquireDeployLock: (...args: unknown[]) => mockAcquireDeployLock(...args),
  releaseDeployLock: (...args: unknown[]) => mockReleaseDeployLock(...args),
  generateFilesDDL: (...args: unknown[]) => mockGenerateFilesDDL(...args),
  generateServicesDDL: (...args: unknown[]) => mockGenerateServicesDDL(...args),
  executeD1DDL: (...args: unknown[]) => mockExecuteD1DDL(...args),
  executeD1Query: (...args: unknown[]) => mockExecuteD1Query(...args),
  findFormComponents: (...args: unknown[]) => mockFindFormComponents(...args),
}));

// ── Import the Hono router (AFTER mocks) ────────────────────────────

import { deploy as deployRouter } from '../../../worker/src/routes/deploy';

// ── Helpers ────────────────────────────────────────────────────────

const DEPLOY_SECRET = 'test-deploy-secret';
const APP_ID = 'app-1';

/** Helper to create a mock Secrets Store binding */
const mockSecret = (value: string) => ({ get: vi.fn(async () => value) });

const mockR2Get = vi.fn();
const mockR2Put = vi.fn();

function createMockEnv() {
  return {
    CONFIG_CACHE: { get: mockR2Get, put: mockR2Put } as unknown as R2Bucket,
    DEPLOY_SECRET: mockSecret(DEPLOY_SECRET),
    ENVIRONMENT: 'selfhost',
  };
}

/**
 * Send a request to the deploy router using Hono's app.request() with env bindings.
 * Hono expects env bindings as the 3rd argument to app.request().
 */
function postDeploy(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  envOverrides: Record<string, unknown> = {},
) {
  const env = { ...createMockEnv(), ...envOverrides };
  return {
    response: deployRouter.request(`/${APP_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    }, env),
    env,
  };
}

function getDeploy(
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
  envOverrides: Record<string, unknown> = {},
) {
  const env = { ...createMockEnv(), ...envOverrides };
  const params = new URLSearchParams(query);
  const qs = params.toString() ? `?${params}` : '';
  return {
    response: deployRouter.request(`/${APP_ID}${qs}`, {
      method: 'GET',
      headers,
    }, env),
    env,
  };
}

/** Set up all mocks for a successful deploy pipeline */
function setupSuccessfulDeploy() {
  const appConfig = {
    backend: {
      models: [{ name: 'tasks', columns: [] }],
      handlers: [{ method: 'getStats' }],
    },
    repo: {
      methods: {
        getStats: { compiled: 'repo/handlers/getStats_abc123.js' },
      },
    },
  };
  mockR2Get.mockResolvedValue({
    text: async () => JSON.stringify(appConfig),
    json: async () => appConfig,
  });

  mockExtractBackendProps.mockReturnValue({
    models: [{ name: 'tasks', columns: [] }],
    handlers: [{ method: 'getStats' }],
  });
  mockValidateInjectedConfig.mockReturnValue([]);
  mockReadRepoModules.mockResolvedValue(new Map([['getStats', 'export default async (ctx) => {};']]));
  mockReadWorkerTemplate.mockResolvedValue({ content: 'template-js-code', sha: 'sha-abc' });
  mockGenerateEntryModule.mockReturnValue('entry-js-code');
  mockProvisionD1Database.mockResolvedValue({ uuid: 'db-uuid-1', name: 'exepad-app-1' });
  mockProvisionR2Bucket.mockResolvedValue({ name: 'exepad-files-app-1' });
  mockAcquireDeployLock.mockResolvedValue(true);
  mockSaveDeploymentSnapshot.mockResolvedValue(undefined);
  mockApplyMigrations.mockResolvedValue({ statements: ['CREATE TABLE tasks ...'], warnings: [], isDestructive: false });
  // planMigrations gates the pre-migration backup; mirror applyMigrations so a
  // migration-bearing deploy takes a backup (backup path preferred on rollback).
  mockPlanMigrations.mockResolvedValue({ statements: ['CREATE TABLE tasks ...'], warnings: [], isDestructive: false });
  mockBackupAppDatabase.mockResolvedValue({ path: '/data/apps/app-1/backups/pre-migration-test.sqlite' });
  mockPruneAppDatabaseBackups.mockReturnValue(undefined);
  mockRestoreAppDatabase.mockResolvedValue(undefined);
  mockCreateAppBackendBindings.mockReturnValue([]);
  mockUploadWorkerScript.mockResolvedValue(undefined);
  mockReleaseDeployLock.mockResolvedValue(undefined);
  mockSaveDeploymentStatus.mockResolvedValue(undefined);
  mockLoadDeploymentStatus.mockResolvedValue(null);
  mockWritePublishedSnapshot.mockResolvedValue({
    configPath: 'published/releases/test-release/app-config.json',
    prefix: 'published/releases/test-release',
  });
  mockValidatePublishedManifest.mockResolvedValue(true);
  mockResolveStaticSeeds.mockResolvedValue({ resolved: [], errors: [] });
  mockGenerateFilesDDL.mockReturnValue([]);
  mockGenerateServicesDDL.mockReturnValue([]);
  mockExecuteD1DDL.mockResolvedValue(undefined);
  mockExecuteD1Query.mockResolvedValue(undefined);
  mockFindFormComponents.mockReturnValue([]);
}

// ── Test suites ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setupSuccessfulDeploy();
});

describe('POST /api/deploy/:appId', () => {
  // ── Auth ──

  describe('authentication', () => {
    it('returns 401 when X-Deploy-Secret is missing', async () => {
      const { response } = postDeploy({ mode: 'preview', configPath: 'repo/config.json' });
      const res = await response;

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Deploy-Secret is wrong', async () => {
      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': 'wrong-secret' },
      );
      const res = await response;

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('proceeds when X-Deploy-Secret matches', async () => {
      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  // ── Mode required ──

  it('returns 400 when mode is missing', async () => {
    const { response } = postDeploy(
      { configPath: 'repo/config.json' },
      { 'X-Deploy-Secret': DEPLOY_SECRET },
    );
    const res = await response;

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('mode is required');
  });

  // ── App alias validation ──

  it('returns 400 when appAlias is invalid', async () => {
    const { response } = postDeploy(
      { mode: 'preview', configPath: 'repo/config.json', appAlias: '!' },
      { 'X-Deploy-Secret': DEPLOY_SECRET },
    );
    const res = await response;

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('appAlias');
  });

  // ── Idempotency ──

  describe('idempotency', () => {
    it('returns cached result with idempotent: true for same correlationId', async () => {
      const existingStatus = {
        appId: APP_ID,
        mode: 'preview',
        status: 'success',
        lastCorrelationId: 'corr-abc',
        workerName: 'app-preview-app-1',
        d1Id: 'db-prev',
        duration: 500,
      };
      mockLoadDeploymentStatus.mockResolvedValue(existingStatus);

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json', correlationId: 'corr-abc' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.idempotent).toBe(true);
      expect(body.workerName).toBe('app-preview-app-1');
    });

    it('does not short-circuit when correlationId differs', async () => {
      mockLoadDeploymentStatus.mockResolvedValue({
        status: 'success',
        lastCorrelationId: 'corr-old',
      });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json', correlationId: 'corr-new' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.idempotent).toBeUndefined();
    });

    it('does not short-circuit when previous deploy failed', async () => {
      mockLoadDeploymentStatus.mockResolvedValue({
        status: 'failed',
        lastCorrelationId: 'corr-abc',
      });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json', correlationId: 'corr-abc' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      const body = await res.json();
      expect(body.idempotent).toBeUndefined();
    });
  });

  // ── Config path resolution ──

  describe('config path resolution', () => {
    it('preview mode uses {appId}/{configPath}', async () => {
      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/app_configs/config_abc.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockR2Get).toHaveBeenCalledWith('app-1/repo/app_configs/config_abc.json');
    });

    it('published mode reads published/app-config.json', async () => {
      const { response } = postDeploy(
        { mode: 'published', appAlias: 'my-app' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockR2Get).toHaveBeenCalledWith('app-1/published/app-config.json');
    });

    it('preview mode without configPath returns 500', async () => {
      const { response } = postDeploy(
        { mode: 'preview' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('configPath is required');
    });

    it('published mode without existing config returns user-friendly error', async () => {
      mockR2Get.mockResolvedValue(null);

      const { response } = postDeploy(
        { mode: 'published', appAlias: 'my-app' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('No published snapshot found');
    });
  });

  // ── Config validation ──

  describe('config validation', () => {
    it('returns 500 with validation errors when config is invalid', async () => {
      mockValidateInjectedConfig.mockReturnValue(['no models defined', 'missing handlers']);

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Config validation');
      expect(body.error).toContain('no models defined');
    });
  });

  // ── Empty-frontend gate ──
  //
  // Reproduced from app `r74zfpfj` (2026-05-15): every CBM dispatch hit
  // the 25-tool-call cap, 0 components saved, final config landed with
  // `repo.frontend.components = {}` while `frontend.pages` had 6 entries.
  // Old behavior: status: 'success'. New behavior: throw → status: 'failed'.

  describe('empty repo.frontend.components gate', () => {
    /** Helper: build an appConfig with the given frontend shape. */
    function setAppConfig(opts: {
      pages?: unknown[];
      components?: Record<string, unknown>;
    }) {
      const cfg: Record<string, unknown> = {
        backend: {
          models: [{ name: 'tasks', columns: [] }],
          handlers: [{ method: 'getStats' }],
        },
        frontend: {
          pages: opts.pages ?? [],
        },
        repo: {
          methods: {
            getStats: { compiled: 'repo/handlers/getStats_abc123.js' },
          },
          frontend: {
            components: opts.components ?? {},
          },
        },
      };
      mockR2Get.mockResolvedValue({
        text: async () => JSON.stringify(cfg),
        json: async () => cfg,
      });
    }

    it('rejects deploy when pages > 0 and components is empty', async () => {
      setAppConfig({
        pages: [{ slug: '/' }, { slug: '/about' }],
        components: {},
      });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('repo.frontend.components is empty');
      expect(body.error).toContain('frontend.pages has 2 entries');

      // The catch block must persist status: 'failed' to R2.
      expect(mockSaveDeploymentStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('allows deploy when pages > 0 and components has at least one entry', async () => {
      setAppConfig({
        pages: [{ slug: '/' }],
        components: { Foo: { source: 'repo/frontend/components/Foo.tsx' } },
      });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      // The empty-frontend check should not fire; later pipeline steps
      // may or may not succeed depending on mocks, but the rejection
      // signature is "repo.frontend.components is empty" — its absence
      // proves the guard let this config through.
      const body = await res.json();
      expect(body.error ?? '').not.toContain('repo.frontend.components is empty');
    });

    it('allows deploy when pages is empty (blog-only / admin-only app)', async () => {
      setAppConfig({ pages: [], components: {} });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;
      const body = await res.json();
      expect(body.error ?? '').not.toContain('repo.frontend.components is empty');
    });
  });

  // ── D1 naming ──

  describe('D1 database naming', () => {
    it('preview mode uses exepad-preview-{appId}', async () => {
      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockProvisionD1Database).toHaveBeenCalledWith(
        expect.objectContaining({ d1NamingPattern: 'exepad-preview-app-1' }),
      );
    });

    it('published mode uses exepad-{appId}', async () => {
      const { response } = postDeploy(
        { mode: 'published', appAlias: 'my-app' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockProvisionD1Database).toHaveBeenCalledWith(
        expect.objectContaining({ d1NamingPattern: 'exepad-app-1' }),
      );
    });
  });

  // ── WfP script naming ──

  describe('WfP script naming', () => {
    it('preview mode uploads as app-preview-{appId}', async () => {
      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockUploadWorkerScript).toHaveBeenCalledWith(
        expect.anything(),
        'app-preview-app-1',
        expect.anything(),
        expect.anything(),
      );
    });

    it('published mode uploads as app-{appId}', async () => {
      const { response } = postDeploy(
        { mode: 'published', appAlias: 'my-app' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockUploadWorkerScript).toHaveBeenCalledWith(
        expect.anything(),
        'app-app-1',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ── Multi-module upload ──

  describe('multi-module upload structure', () => {
    it('includes _entry.js, template.js, and handler modules', async () => {
      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      const uploadCall = mockUploadWorkerScript.mock.calls[0];
      const uploadOptions = uploadCall[3];

      expect(uploadOptions.mainModule).toBe('_entry.js');

      const moduleNames = uploadOptions.modules.map((m: { name: string }) => m.name);
      expect(moduleNames).toContain('_entry.js');
      expect(moduleNames).toContain('template.js');
      expect(moduleNames).toContain('handlers/getStats.js');
    });
  });

  // ── Seed non-fatal ──

  describe('seed mode gating', () => {
    it('published deploys never call seedFromR2 even when seed config is present', async () => {
      // Seed data is a preview-only fixture. Published D1 holds real user
      // rows — re-seeding on every republish would wipe and reintroduce
      // stale fixtures via the seeder's owner_id-scoped DELETE.
      const appConfig = {
        backend: { models: [{ name: 'tasks' }], handlers: [] },
        repo: {
          methods: {},
          seed: {
            tasks: { source: 'repo/seed/tasks.csv', model: 'tasks' },
          },
        },
      };
      mockR2Get.mockResolvedValue({
        text: async () => JSON.stringify(appConfig),
        json: async () => appConfig,
      });
      mockExtractBackendProps.mockReturnValue({
        models: [{ name: 'tasks' }],
        handlers: [],
      });
      mockSeedFromR2.mockClear();

      const { response } = postDeploy(
        { mode: 'published', appAlias: 'my-app' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      expect(mockSeedFromR2).not.toHaveBeenCalled();
    });
  });

  describe('seed failure handling', () => {
    it('seed failure does not prevent deploy success', async () => {
      const appConfig = {
        backend: { models: [{ name: 'tasks' }], handlers: [] },
        repo: {
          methods: {},
          seed: {
            tasks: { source: 'repo/seed/tasks.csv', model: 'tasks' },
          },
        },
      };
      mockR2Get.mockResolvedValue({
        text: async () => JSON.stringify(appConfig),
        json: async () => appConfig,
      });
      mockExtractBackendProps.mockReturnValue({
        models: [{ name: 'tasks' }],
        handlers: [],
      });
      mockSeedFromR2.mockRejectedValue(new Error('S3 timeout'));

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('seedErrors are surfaced in the deployment-status payload', async () => {
      // Per-row tolerance returns errors per failed row. The deploy
      // endpoint must surface those into deployment-status-preview.json
      // so operators see partial seed failures without probing D1.
      // First wired 2026-05-15 after the alo48zsn incident.
      const appConfig = {
        backend: { models: [{ name: 'bookings' }], handlers: [] },
        repo: {
          methods: {},
          seed: {
            bookings: { source: 'repo/seed/bookings.csv', model: 'bookings' },
          },
        },
      };
      mockR2Get.mockResolvedValue({
        text: async () => JSON.stringify(appConfig),
        json: async () => appConfig,
      });
      mockExtractBackendProps.mockReturnValue({
        models: [{ name: 'bookings' }],
        handlers: [],
      });
      mockSaveDeploymentStatus.mockClear();
      mockSeedFromR2.mockResolvedValue({
        seeded: ['bookings'],
        skipped: [],
        errors: [
          '[bookings] Relative-date expansion row 1: unit \'h\' is not allowed on __TODAY__ (use __NOW__)',
        ],
      });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      // The success-status saveDeploymentStatus call should carry seedErrors.
      const successCalls = mockSaveDeploymentStatus.mock.calls.filter(
        (call) => (call[1] as { status?: string })?.status === 'success',
      );
      expect(successCalls.length).toBeGreaterThan(0);
      const successPayload = successCalls[0][1] as { seedErrors?: string[] };
      expect(successPayload.seedErrors).toBeDefined();
      expect(successPayload.seedErrors).toHaveLength(1);
      expect(successPayload.seedErrors![0]).toContain('__TODAY__');
    });

    it('seedErrors omitted on clean deploy', async () => {
      const appConfig = {
        backend: { models: [{ name: 'tasks' }], handlers: [] },
        repo: {
          methods: {},
          seed: { tasks: { source: 'repo/seed/tasks.csv', model: 'tasks' } },
        },
      };
      mockR2Get.mockResolvedValue({
        text: async () => JSON.stringify(appConfig),
        json: async () => appConfig,
      });
      mockExtractBackendProps.mockReturnValue({
        models: [{ name: 'tasks' }],
        handlers: [],
      });
      mockSaveDeploymentStatus.mockClear();
      mockSeedFromR2.mockResolvedValue({
        seeded: ['tasks'],
        skipped: [],
        errors: [],
      });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      const successCalls = mockSaveDeploymentStatus.mock.calls.filter(
        (call) => (call[1] as { status?: string })?.status === 'success',
      );
      expect(successCalls.length).toBeGreaterThan(0);
      const successPayload = successCalls[0][1] as { seedErrors?: string[] };
      expect(successPayload.seedErrors).toBeUndefined();
    });
  });

  // ── Published snapshot fatal ──

  describe('published snapshot failure handling', () => {
    it('snapshot failure returns error (fatal)', async () => {
      mockWritePublishedSnapshot.mockRejectedValue(new Error('R2 write failed'));

      const { response } = postDeploy(
        { mode: 'published', appAlias: 'my-app' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('stages the published snapshot before uploading the worker', async () => {
      const { response } = postDeploy(
        { mode: 'published', appAlias: 'my-app' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      expect(mockWritePublishedSnapshot.mock.invocationCallOrder[0])
        .toBeLessThan(mockUploadWorkerScript.mock.invocationCallOrder[0]);
    });
  });

  // ── Lock lifecycle ──

  describe('deploy lock lifecycle', () => {
    it('releases lock in finally block when pipeline fails after lock acquisition', async () => {
      mockAcquireDeployLock.mockResolvedValue(true);
      mockApplyMigrations.mockRejectedValue(new Error('Migration error'));

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      expect(mockReleaseDeployLock).toHaveBeenCalled();
    });

    it('does not release lock when lock was never acquired', async () => {
      mockAcquireDeployLock.mockResolvedValue(false);

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Another deployment is in progress');
    });
  });

  // ── Success response shape ──

  describe('success response', () => {
    it('includes expected fields on successful deploy', async () => {
      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.workerName).toBe('app-preview-app-1');
      expect(body.d1Id).toBe('db-uuid-1');
      expect(body.templateSha).toBe('sha-abc');
      expect(body.migrations).toBe(1);
      expect(typeof body.duration).toBe('number');
    });

    it('saves deployment status to R2 on success', async () => {
      const { response, env } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockSaveDeploymentStatus).toHaveBeenCalledWith(
        env.CONFIG_CACHE,
        expect.objectContaining({
          appId: APP_ID,
          mode: 'preview',
          status: 'success',
        }),
      );
    });
  });

  // ── Error response shape ──

  describe('error response', () => {
    it('includes step information on failure', async () => {
      mockApplyMigrations.mockRejectedValue(new Error('SQL syntax error'));

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.step).toBe('schema');
      expect(body.error).toContain('SQL syntax error');
    });

    it('restores from the pre-migration backup when upload fails (byte-level rollback preferred)', async () => {
      // A migration-bearing deploy took a backup (default mocks), so the failure
      // path prefers a byte-level restore — which reverts schema AND row data —
      // over reverse-DDL rollbackSchema.
      mockUploadWorkerScript.mockRejectedValue(new Error('WfP upload failed'));

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.rolledBack).toBe(true);
      expect(mockRestoreAppDatabase).toHaveBeenCalledWith(
        expect.anything(),
        '/data/apps/app-1/backups/pre-migration-test.sqlite',
      );
      // Byte-restore succeeded, so reverse-DDL is NOT attempted.
      expect(mockRollbackSchema).not.toHaveBeenCalled();
    });

    it('falls back to reverse-DDL rollback when no pre-migration backup exists', async () => {
      // An additive/no-op plan takes no backup, so the failure path uses the
      // reverse-DDL rollbackSchema against the pre-migration schema snapshot.
      mockPlanMigrations.mockResolvedValue({ statements: [], warnings: [], isDestructive: false });
      mockUploadWorkerScript.mockRejectedValue(new Error('WfP upload failed'));
      mockGetPreviousSchema.mockResolvedValue({ tables: ['tasks'] });
      mockRollbackSchema.mockResolvedValue({ success: true, details: [] });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.rolledBack).toBe(true);
      expect(mockRestoreAppDatabase).not.toHaveBeenCalled();
      expect(mockGetPreviousSchema).toHaveBeenCalled();
      expect(mockRollbackSchema).toHaveBeenCalled();
    });

    it('saves failed status to R2 on error', async () => {
      mockApplyMigrations.mockRejectedValue(new Error('boom'));

      const { response, env } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      await response;

      expect(mockSaveDeploymentStatus).toHaveBeenCalledWith(
        env.CONFIG_CACHE,
        expect.objectContaining({
          appId: APP_ID,
          mode: 'preview',
          status: 'failed',
          error: 'boom',
        }),
      );
    });
  });

  // ── Storage validation ──

  describe('storage validation', () => {
    it('rejects storage.enabled with static backend mode', async () => {
      mockExtractBackendProps.mockReturnValue({
        models: [],
        handlers: [],
        storage: { enabled: true },
      });

      const appConfig = {
        backend: { mode: 'static', models: [], handlers: [] },
        repo: { methods: {} },
      };
      mockR2Get.mockResolvedValue({
        text: async () => JSON.stringify(appConfig),
        json: async () => appConfig,
      });

      const { response } = postDeploy(
        { mode: 'preview', configPath: 'repo/config.json' },
        { 'X-Deploy-Secret': DEPLOY_SECRET },
      );
      const res = await response;

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('storage.enabled requires backend.mode');
    });
  });
});

// ── GET endpoint ──────────────────────────────────────────────────

describe('GET /api/deploy/:appId', () => {
  it('returns 401 when X-Deploy-Secret is missing', async () => {
    const { response } = getDeploy({ mode: 'preview' });
    const res = await response;

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when no deployment status found', async () => {
    mockLoadDeploymentStatus.mockResolvedValue(null);

    const { response } = getDeploy(
      { mode: 'preview' },
      { 'X-Deploy-Secret': DEPLOY_SECRET },
    );
    const res = await response;

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('No deployment found');
  });

  it('returns deployment status data when found', async () => {
    const statusData = {
      appId: APP_ID,
      mode: 'preview',
      status: 'success',
      workerName: 'app-preview-app-1',
      d1Id: 'db-uuid-1',
      updatedAt: '2026-02-17T00:00:00Z',
    };
    mockLoadDeploymentStatus.mockResolvedValue(statusData);

    const { response } = getDeploy(
      { mode: 'preview' },
      { 'X-Deploy-Secret': DEPLOY_SECRET },
    );
    const res = await response;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(statusData);
  });

  it('defaults to published mode when mode query param is omitted', async () => {
    mockLoadDeploymentStatus.mockResolvedValue(null);

    const { response, env } = getDeploy(
      {},
      { 'X-Deploy-Secret': DEPLOY_SECRET },
    );
    await response;

    expect(mockLoadDeploymentStatus).toHaveBeenCalledWith(
      env.CONFIG_CACHE,
      APP_ID,
      'published',
    );
  });
});
