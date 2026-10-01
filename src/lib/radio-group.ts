import type { KeyboardEvent } from "react";

/**
 * Arrow keys for a segmented control or other radio group: move to the next option and
 * choose it, as the ARIA radio pattern expects (Home and End jump to the ends). Put it on
 * the role="radiogroup" element and give each option tabIndex={checked ? 0 : -1}, so the
 * group is a single tab stop.
 */
export function radioGroupKeys(e: KeyboardEvent<HTMLElement>) {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in steps) && e.key !== "Home" && e.key !== "End") return;
  const radios = [
    ...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'),
  ];
  if (radios.length === 0) return;
  const current = radios.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? radios.length - 1
        : (Math.max(current, 0) + steps[e.key] + radios.length) % radios.length;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
}
