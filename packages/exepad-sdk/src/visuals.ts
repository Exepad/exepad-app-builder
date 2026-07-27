export * as Charts from 'recharts';
// Curated Icons subset — see curated-icons.ts for the rationale. Using a
// plain re-export of a statically-defined object (instead of
// `export * as Icons from 'lucide-react'`) lets Vite tree-shake ~1600
// unused icons from the bundle, saving hundreds of KB per generated app.
export { Icons } from './curated-icons';
export type { CuratedIconName } from './curated-icons';
export { motion, motion as Motion } from 'framer-motion';
