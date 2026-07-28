import type { SecretBinding } from '../types/env';

export async function resolveSecret(binding: SecretBinding | undefined | null): Promise<string> {
  if (!binding) return '';
  if (typeof binding === 'string') return binding;

  try {
    return (await binding.get()) || '';
  } catch (err) {
    // A READ FAILURE degrades to '' just like an unset secret, which for a gate
    // that treats empty-means-open would silently disable it. We can't change
    // the return contract without auditing every call site, but we MUST make
    // the failure visible so it is distinguishable from an intentionally-unset
    // secret in the logs.
    console.error('[secrets] resolveSecret: binding.get() failed; treating secret as empty:', err);
    return '';
  }
}
