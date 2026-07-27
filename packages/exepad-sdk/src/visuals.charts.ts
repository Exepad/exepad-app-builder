// Isolated recharts re-export. The monolith barrel (`visuals.ts`) bundles
// Charts + Icons + motion together; the split /charts entry imports ONLY this
// file so its source graph reaches recharts alone (no lucide/framer leak).
export * as Charts from 'recharts';
