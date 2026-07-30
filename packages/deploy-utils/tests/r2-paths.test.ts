/**
 * Tests for R2 path construction helpers and constants
 */

import { describe, it, expect } from 'vitest';
import { R2_PATHS, CONTENT_HASH_LENGTH, CONTENT_HASH_PREFIX } from '../src/deploy/r2-paths';

describe('R2_PATHS', () => {
  it('repoConfig — versioned app config', () => {
    expect(R2_PATHS.repoConfig('abc123')).toBe('repo/app_configs/app_config_abc123.json');
  });

  it('repoArtifact — versioned code artifact', () => {
    expect(R2_PATHS.repoArtifact('backend/handlers', 'getStats', 'abc123', 1, 'js')).toBe(
      'code/backend/handlers/getStats_abc123_v1.js'
    );
  });

  it('publishedConfig — frozen config', () => {
    expect(R2_PATHS.publishedConfig()).toBe('published/app-config.json');
  });

  it('publishedManifest — manifest', () => {
    expect(R2_PATHS.publishedManifest()).toBe('published/_manifest.json');
  });

  it('publishedArtifact — published code', () => {
    expect(R2_PATHS.publishedArtifact('handlers', 'getStats')).toBe(
      'published/handlers/getStats.js'
    );
  });

  it('publishedAsset — captured image', () => {
    expect(R2_PATHS.publishedAsset('deadbeef1234', 'png')).toBe(
      'published/assets/img_deadbeef1234.png'
    );
  });

  it('workerTemplate — global worker template path', () => {
    expect(R2_PATHS.workerTemplate('abc1234')).toBe('_system/worker-template-abc1234.js');
  });

  it('templatePointer — global pointer', () => {
    expect(R2_PATHS.templatePointer()).toBe('_system/worker-template-latest.json');
  });

  it('deploymentStatus — per-mode status', () => {
    expect(R2_PATHS.deploymentStatus('preview')).toBe('deployment-status-preview.json');
    expect(R2_PATHS.deploymentStatus('published')).toBe('deployment-status-published.json');
  });

  it('repoSeed — versioned seed data', () => {
    expect(R2_PATHS.repoSeed('contacts', 'a1b2c3', 1, 'csv')).toBe(
      'code/seed/contacts_a1b2c3_v1.csv'
    );
  });

  it('publishedSeed — published seed data', () => {
    expect(R2_PATHS.publishedSeed('contacts', 'csv')).toBe('published/seed/contacts.csv');
  });

  it('userUpload — user upload path', () => {
    expect(R2_PATHS.userUpload('preview', 'user-42', 'uuid-abc', 'png')).toBe(
      'uploads/preview/user-42/uuid-abc.png'
    );
  });
});

describe('R2 constants', () => {
  it('CONTENT_HASH_LENGTH is 12', () => {
    expect(CONTENT_HASH_LENGTH).toBe(12);
  });

  it('CONTENT_HASH_PREFIX is sha256', () => {
    expect(CONTENT_HASH_PREFIX).toBe('sha256');
  });
});
