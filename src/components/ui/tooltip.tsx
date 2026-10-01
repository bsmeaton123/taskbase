"use client";

import { Tooltip as T } from "radix-ui";
import { forwardRef } from "react";

/**
 * Extra props and the ref go to the trigger, so a tooltip can sit inside another
 * Radix trigger (e.g. `<PopoverTrigger asChild><Tooltip><Button/></Tooltip></PopoverTrigger>`).
 */
export const Tooltip = forwardRef<
  HTMLButtonElement,
  {
    content: React.ReactNode;
    children: React.ReactNode;
    side?: "top" | "bottom" | "left" | "right";
  } & Omit<React.ComponentPropsWithoutRef<typeof T.Trigger>, "content" | "asChild">
>(function Tooltip({ content, children, side = "top", ...triggerProps }, ref) {
  return (
    <T.Root>
      <T.Trigger asChild ref={ref} {...triggerProps}>
        {children}
      </T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] max-w-xs rounded-md bg-text px-2 py-1 text-[12px] font-medium text-bg shadow-pop animate-fade-in"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
});
