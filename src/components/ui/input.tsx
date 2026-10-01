"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-md border border-border bg-surface px-2.5 text-[14px] text-text transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 read-only:bg-surface-2 disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/15";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-9", className)} {...props} />;
});

export const Label = ({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    className={cn("block text-[13px] font-medium text-text", className)}
    {...props}
  />
);

/**
 * Label, control, then a hint or an error. When the control is a single element, it is
 * described by the hint or error and marked invalid while there's an error.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  const noteId = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  const control = isValidElement<React.AriaAttributes>(children)
    ? cloneElement(children, {
        "aria-describedby":
          [children.props["aria-describedby"], noteId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": children.props["aria-invalid"] ?? (error ? true : undefined),
      })
    : children;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {control}
      {error ? (
        <p id={noteId} className="text-[12.5px] text-danger-text" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type AutoTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number;
  bare?: boolean;
};

/** Textarea that grows with its content. `bare` removes the field chrome. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  function AutoTextarea({ className, minRows = 1, bare, onChange, ...props }, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);

    const resize = useCallback(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, []);

    useLayoutEffect(resize, [resize, props.value, props.defaultValue]);

    return (
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        rows={minRows}
        onChange={(e) => {
          resize();
          onChange?.(e);
        }}
        className={cn(
          "block resize-none overflow-hidden",
          bare
            ? "w-full bg-transparent focus:outline-none"
            : cn(fieldBase, "py-2 leading-relaxed"),
          className,
        )}
        {...props}
      />
    );
  },
);
