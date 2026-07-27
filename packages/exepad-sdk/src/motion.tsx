import * as React from 'react';
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  AnimatePresence,
  type Variants,
} from 'framer-motion';
import { cn } from './helpers/cn';

type MotionKitBaseProps = {
  children?: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  once?: boolean;
  style?: React.CSSProperties;
  id?: string;
};

const DEFAULT_DURATION = 0.5;
const DEFAULT_EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

export function FadeIn({
  children,
  className,
  delay = 0,
  duration = DEFAULT_DURATION,
  style,
  id,
}: MotionKitBaseProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      id={id}
      style={style}
      className={className}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration, ease: DEFAULT_EASE }}
    >
      {children}
    </motion.div>
  );
}

export function SlideUp({
  children,
  className,
  delay = 0,
  duration = DEFAULT_DURATION,
  distance = 24,
  style,
  id,
}: MotionKitBaseProps & { distance?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      id={id}
      style={style}
      className={className}
      initial={reduce ? false : { opacity: 0, y: distance }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration, ease: DEFAULT_EASE }}
    >
      {children}
    </motion.div>
  );
}

export type RevealProps = MotionKitBaseProps & {
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  distance?: number;
  amount?: number | 'some' | 'all';
};

export function Reveal({
  children,
  className,
  delay = 0,
  duration = DEFAULT_DURATION,
  once = true,
  direction = 'up',
  distance = 24,
  amount = 0.2,
  style,
  id,
}: RevealProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once, amount });
  const effectivelyInView = inView || reduce;
  const offset =
    direction === 'up'
      ? { x: 0, y: distance }
      : direction === 'down'
        ? { x: 0, y: -distance }
        : direction === 'left'
          ? { x: distance, y: 0 }
          : direction === 'right'
            ? { x: -distance, y: 0 }
            : { x: 0, y: 0 };
  return (
    <motion.div
      ref={ref}
      id={id}
      style={style}
      className={className}
      initial={reduce ? false : { opacity: 0, ...offset }}
      animate={effectivelyInView ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, ...offset }}
      transition={{ delay, duration, ease: DEFAULT_EASE }}
    >
      {children}
    </motion.div>
  );
}

export type StaggerGridProps = {
  children?: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  duration?: number;
  once?: boolean;
  amount?: number | 'some' | 'all';
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  distance?: number;
};

export function StaggerGrid({
  children,
  className,
  stagger = 0.08,
  delay = 0,
  duration = DEFAULT_DURATION,
  once = true,
  amount = 0.15,
  direction = 'up',
  distance = 20,
}: StaggerGridProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once, amount });
  const effectivelyInView = inView || reduce;
  const offset =
    direction === 'up'
      ? { x: 0, y: distance }
      : direction === 'down'
        ? { x: 0, y: -distance }
        : direction === 'left'
          ? { x: distance, y: 0 }
          : direction === 'right'
            ? { x: -distance, y: 0 }
            : { x: 0, y: 0 };
  const container: Variants = {
    hidden: { opacity: 1 },
    show: {
      opacity: 1,
      transition: { staggerChildren: stagger, delayChildren: delay },
    },
  };
  const item: Variants = {
    hidden: { opacity: 0, ...offset },
    show: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: { duration, ease: DEFAULT_EASE },
    },
  };
  return (
    <motion.div
      ref={ref}
      className={className}
      variants={container}
      initial={reduce ? 'show' : 'hidden'}
      animate={effectivelyInView ? 'show' : 'hidden'}
    >
      {React.Children.map(children, (child, i) => {
        if (child === null || child === undefined || typeof child === 'boolean') return null;
        return (
          <motion.div key={i} variants={item}>
            {child}
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export type AnimatedCounterProps = {
  from?: number;
  to: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  once?: boolean;
  format?: (value: number) => string;
};

export function AnimatedCounter({
  from = 0,
  to,
  duration = 1.2,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
  once = true,
  format,
}: AnimatedCounterProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once, amount: 0.5 });
  const effectivelyInView = inView || reduce;
  const raw = useMotionValue(reduce ? to : from);
  const spring = useSpring(raw, {
    duration: duration * 1000,
    bounce: 0,
  });
  const rounded = useTransform(spring, (v) => {
    const clamped = Number.isFinite(v) ? v : from;
    return format
      ? format(clamped)
      : `${prefix}${clamped.toFixed(decimals)}${suffix}`;
  });

  React.useEffect(() => {
    if (effectivelyInView) raw.set(to);
    else raw.set(from);
  }, [effectivelyInView, to, from, raw]);

  return (
    <motion.span ref={ref} className={className}>
      {rounded}
    </motion.span>
  );
}

export type MarqueeProps = {
  children?: React.ReactNode;
  className?: string;
  speed?: number;
  direction?: 'left' | 'right';
  pauseOnHover?: boolean;
  gap?: number;
};

export function Marquee({
  children,
  className,
  speed = 40,
  direction = 'left',
  pauseOnHover = true,
  gap = 32,
}: MarqueeProps) {
  const [paused, setPaused] = React.useState(false);
  const duration = Math.max(10, 400 / speed);
  return (
    <div
      className={cn('relative w-full overflow-hidden', className)}
      onMouseEnter={() => pauseOnHover && setPaused(true)}
      onMouseLeave={() => pauseOnHover && setPaused(false)}
    >
      <motion.div
        className="flex w-max flex-nowrap"
        style={{ gap }}
        animate={{ x: direction === 'left' ? ['0%', '-50%'] : ['-50%', '0%'] }}
        transition={{
          duration,
          ease: 'linear',
          repeat: Infinity,
        }}
        {...(paused ? { 'data-paused': 'true' } : {})}
      >
        <div className="flex shrink-0 items-center" style={{ gap }}>
          {children}
        </div>
        <div
          className="flex shrink-0 items-center"
          style={{ gap }}
          aria-hidden
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export type AnimatedGradientProps = {
  className?: string;
  variant?: 'aurora' | 'sunset' | 'ocean' | 'forest' | 'ember';
  duration?: number;
};

const GRADIENT_VARIANTS = {
  aurora:
    'linear-gradient(120deg, #0ea5e9 0%, #a855f7 30%, #22d3ee 60%, #14b8a6 100%)',
  sunset:
    'linear-gradient(120deg, #f97316 0%, #ec4899 40%, #8b5cf6 75%, #f43f5e 100%)',
  ocean:
    'linear-gradient(120deg, #0284c7 0%, #0ea5e9 40%, #14b8a6 75%, #06b6d4 100%)',
  forest:
    'linear-gradient(120deg, #166534 0%, #16a34a 40%, #65a30d 75%, #facc15 100%)',
  ember:
    'linear-gradient(120deg, #7c2d12 0%, #dc2626 40%, #f97316 75%, #fbbf24 100%)',
} as const;

export function AnimatedGradient({
  className,
  variant = 'aurora',
  duration = 16,
}: AnimatedGradientProps) {
  const gradient = GRADIENT_VARIANTS[variant];
  return (
    <motion.div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{
        background: gradient,
        backgroundSize: '200% 200%',
      }}
      animate={{
        backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
      }}
      transition={{ duration, ease: 'linear', repeat: Infinity }}
    />
  );
}

export { AnimatePresence };
