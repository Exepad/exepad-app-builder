import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  /** Show only the mark, hide the wordmark (collapsed sidebar). */
  iconOnly?: boolean;
  className?: string;
}

const iconSize = { sm: "h-6 w-6", md: "h-7 w-7", lg: "h-9 w-9" } as const;
const textSize = { sm: "text-base", md: "text-lg", lg: "text-2xl" } as const;

/**
 * Exepad wordmark for the platform chrome. OSS ships only `/favicon.svg`
 * (no full logo SVG), so the mark is the favicon + a styled "Exepad" wordmark.
 */
export function Logo({ size = "md", iconOnly = false, className }: LogoProps) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <img
        src="/favicon.svg"
        alt="Exepad"
        className={cn(iconSize[size], "shrink-0")}
        loading="eager"
      />
      {!iconOnly && (
        <span
          className={cn(
            "font-heading font-semibold tracking-tight text-foreground",
            textSize[size],
          )}
        >
          Exepad
        </span>
      )}
    </span>
  );
}

export default Logo;
