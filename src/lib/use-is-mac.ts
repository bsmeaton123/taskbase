import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * Whether to show Mac shortcuts (⌘) rather than Ctrl. The server render and hydration
 * assume Ctrl; the browser then corrects it, without a hydration mismatch.
 */
export function useIsMac() {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );
}
