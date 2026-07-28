/**
 * R2 key construction helpers.
 *
 * Canonical path patterns for all R2 objects. Used by Runtime directly.
 * The Agent (Python) mirrors these patterns — see Cross-Language Contracts below.
 *
 * Most paths are relative to the {appId}/ prefix — the caller prepends {appId}/.
 * Exceptions: `workerTemplate()` and `templatePointer()` return global paths
 * under `_system/` — these are NOT prefixed with {appId}/.
 */
export const R2_PATHS = {
  /** Versioned app config: repo/app_configs/app_config_{hash}.json */
  repoConfig: (hash: string) =>
    `repo/app_configs/app_config_${hash}.json`,

  /** Versioned code artifact: code/{type}/{name}_{hash}_v{rev}.{ext} */
  repoArtifact: (type: string, name: string, hash: string, rev: number, ext: string) =>
    `code/${type}/${name}_${hash}_v${rev}.${ext}`,

  /** Published frozen config */
  publishedConfig: () => `published/app-config.json`,

  /** Published manifest (written last, validated on next deploy) */
  publishedManifest: () => `published/_manifest.json`,

  /** Published code artifact: published/{type}/{simpleName}.js */
  publishedArtifact: (type: string, simpleName: string) =>
    `published/${type}/${simpleName}.js`,

  /** Published captured image asset: published/assets/img_{hash}.{ext} */
  publishedAsset: (hash: string, ext: string) =>
    `published/assets/img_${hash}.${ext}`,

  /** CI-built worker template (versioned by git SHA). GLOBAL path — do NOT prepend {appId}/. */
  workerTemplate: (sha: string) =>
    `_system/worker-template-${sha}.js`,

  /** Pointer to latest worker template. GLOBAL path — do NOT prepend {appId}/. */
  templatePointer: () => `_system/worker-template-latest.json`,

  /** Deployment status (per app, per mode) */
  deploymentStatus: (mode: string) =>
    `deployment-status-${mode}.json`,

  /** Versioned seed data: code/seed/{model}_{hash}_v{rev}.{ext} */
  repoSeed: (model: string, hash: string, rev: number, ext: string) =>
    `code/seed/${model}_${hash}_v${rev}.${ext}`,

  /** Published seed data: published/seed/{model}.{ext} */
  publishedSeed: (model: string, ext: string) =>
    `published/seed/${model}.${ext}`,

  /** User upload: uploads/{mode}/{ownerId}/{uuid}.{ext} */
  userUpload: (mode: string, ownerId: string, uuid: string, ext: string) =>
    `uploads/${mode}/${ownerId}/${uuid}.${ext}`,
} as const;

/** SHA-256 hash truncation length (characters of hex digest) */
export const CONTENT_HASH_LENGTH = 12;

/** Content hash prefix in manifest/config (e.g., "sha256:2cf24dba5fb0") */
export const CONTENT_HASH_PREFIX = 'sha256';
