// --- @exepad/sdk/icons ---
// Heavy curated lucide-react Icons namespace (~76KB gzip). Isolated into its
// own entry so it never weighs down /core. The curated synchronous subset
// bundles here; any other lucide name falls through to lazily-loaded
// `dist/icons/{name}-{hash}.js` chunks (same behavior as the monolith).
//
// This entry's source graph reaches ONLY curated-icons.ts (lucide-react) and
// must not pull recharts/framer/cmdk/vaul/embla/react-day-picker.
export { Icons } from '../curated-icons';
export type { CuratedIconName } from '../curated-icons';
