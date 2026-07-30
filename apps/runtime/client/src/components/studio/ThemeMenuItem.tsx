import { Moon, Sun } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useChromeTheme } from "@/hooks/useChromeTheme";

/** Light/dark toggle rendered as a dropdown-menu item (for the profile menu). */
export function ThemeMenuItem() {
  const { dark, toggle } = useChromeTheme();
  return (
    <DropdownMenuItem
      className="cursor-pointer"
      // Keep the menu open so the theme change is visible immediately.
      onSelect={(e) => {
        e.preventDefault();
        toggle();
      }}
    >
      {dark ? <Sun /> : <Moon />}
      {dark ? "Light mode" : "Dark mode"}
    </DropdownMenuItem>
  );
}

export default ThemeMenuItem;
