import { Slot } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]",
  secondary:
    "bg-surface text-text border border-border hover:bg-surface-2 hover:border-border-strong shadow-card",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-accent-fg hover:opacity-90",
  "danger-ghost": "text-danger-text hover:bg-danger-soft",
} as const;

const sizes = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
  lg: "h-10 px-4 text-sm gap-2",
  icon: "size-8 justify-center",
  "icon-sm": "size-7 justify-center",
} as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "secondary", size = "md", asChild, className, type, ...props },
    ref,
  ) {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(
          "inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,opacity,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
