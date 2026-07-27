import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChromeTheme } from "@/hooks/useChromeTheme";

/** Light/dark toggle for the platform chrome. Defaults follow the OS. */
export function ThemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useChromeTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export default ThemeToggle;
