import { useCallback, useEffect, useState } from "react";

/**
 * Light/dark theme for the operator-facing platform CHROME (Login/Apps/Settings/
 * Studio). Stores an explicit choice under `exepad-chrome-theme` ("light"|"dark");
 * absence of a key means "follow the OS". The same key + default is read by the
 * no-FOUC bootstrap in index.html.
 *
 * This is intentionally separate from the rendered-app theme system
 * (DynamicTheme/DefaultThemeApplier), which toggles `.dark` for app routes and
 * strips it on unmount. The mount effect here re-asserts the operator's chrome
 * preference so it survives a return from an app route.
 */
const STORAGE_KEY = "exepad-chrome-theme";

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function computeDark(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? stored === "dark" : prefersDark();
  } catch {
    return prefersDark();
  }
}

function applyDark(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
}

export function useChromeTheme() {
  const [dark, setDark] = useState<boolean>(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );

  // Re-assert the chrome preference on mount (covers returning from an app route
  // where DefaultThemeApplier removed `.dark`).
  useEffect(() => {
    const d = computeDark();
    applyDark(d);
    setDark(d);
  }, []);

  // Follow the OS while the operator has not made an explicit choice.
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      if (!stored) {
        applyDark(mql.matches);
        setDark(mql.matches);
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: "light" | "dark") => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyDark(next === "dark");
    setDark(next === "dark");
  }, []);

  const toggle = useCallback(
    () => setTheme(dark ? "light" : "dark"),
    [dark, setTheme],
  );

  return { dark, theme: (dark ? "dark" : "light") as "light" | "dark", setTheme, toggle };
}
