// --- @exepad/sdk/motion ---
// framer-motion `motion`/`Motion` proxy + the motion-kit presets
// (FadeIn/SlideUp/Reveal/StaggerGrid/AnimatedCounter/Marquee/AnimatedGradient/
// AnimatePresence). Isolated entry => framer-motion can only ever appear in
// THIS chunk (single-instance, enforced by check-split-chunks.mjs).
export { motion, motion as Motion } from 'framer-motion';

export {
  FadeIn,
  SlideUp,
  Reveal,
  StaggerGrid,
  AnimatedCounter,
  Marquee,
  AnimatedGradient,
  AnimatePresence,
} from '../motion';
export type {
  RevealProps,
  StaggerGridProps,
  AnimatedCounterProps,
  MarqueeProps,
  AnimatedGradientProps,
} from '../motion';
