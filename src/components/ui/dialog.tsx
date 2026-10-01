"use client";

import { XIcon } from "@phosphor-icons/react/ssr";
import { Dialog as D } from "radix-ui";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  className,
  children,
  ...props
}: React.ComponentProps<typeof D.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
      <D.Content
        className={cn(
          // Capped to the viewport and scrollable, so long forms stay reachable on phones.
          "scrollbar-thin fixed left-1/2 top-[6vh] z-50 max-h-[88dvh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-pop outline-none animate-pop-in sm:top-[12vh] sm:max-h-[80dvh]",
          className,
        )}
        // Dialogs opened from a dropdown item would otherwise close at once:
        // the closing menu hands focus back to its trigger, which counts as
        // "focus outside". Focus stays trapped inside the dialog regardless.
        onFocusOutside={(e) => e.preventDefault()}
        // Open in the first field rather than on the close button; with no fields, on the
        // dialog itself. A field or button with its own autoFocus wins (Radix skips this).
        onOpenAutoFocus={(e) => {
          const content = e.currentTarget as HTMLElement | null;
          if (!content) return;
          e.preventDefault();
          // The first field that can take focus (not a hidden file chooser, say).
          const field = [
            ...content.querySelectorAll<HTMLElement>(
              'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
            ),
          ].find((el) => el.getClientRects().length > 0);
          (field ?? content).focus();
        }}
        // Without a description, say so rather than reading the title out twice.
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <D.Title className="text-[15px] font-semibold tracking-tight">
              {title}
            </D.Title>
            {description && (
              <D.Description className="text-[13px] text-muted">
                {description}
              </D.Description>
            )}
          </div>
          <D.Close
            className="-m-1.5 shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label="Close"
          >
            <XIcon size={16} />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
