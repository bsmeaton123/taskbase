"use client";

import { Tooltip } from "radix-ui";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
        {children}
      </Tooltip.Provider>
      <Toaster
        position="bottom-left"
        toastOptions={{
          className:
            "!bg-surface !text-text !border !border-border !shadow-pop !rounded-[10px] !text-[13px]",
        }}
      />
    </>
  );
}
