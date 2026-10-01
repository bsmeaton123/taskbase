export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "taskbase-theme";

/**
 * Runs in <head> before first paint: applies the saved theme (or the OS
 * setting) and keeps following the OS while the preference is "system".
 */
export const themeScript = `(function(){try{var k="${THEME_STORAGE_KEY}",d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t=localStorage.getItem(k)||"system";d.classList.toggle("dark",t==="dark"||(t==="system"&&m.matches))}a();m.addEventListener("change",a);window.addEventListener("storage",function(e){if(e.key===k)a()})}catch(e){}})()`;

export function applyTheme(pref: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* storage unavailable: still apply for this page view */
  }
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "system";
}
