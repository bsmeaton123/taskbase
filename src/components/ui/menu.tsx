"use client";

import { CheckIcon } from "@phosphor-icons/react/ssr";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuGroup = DropdownMenu.Group;
export const MenuSub = DropdownMenu.Sub;

// Capped to the space Radix measures, so a long menu scrolls instead of running off a phone.
const surface =
  "scrollbar-thin z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto overflow-x-hidden rounded-[10px] border border-border bg-surface p-1 text-[13px] text-text shadow-pop animate-pop-in";

export function MenuContent({
  className,
  align = "start",
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(surface, className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

const itemBase =
  "relative flex h-8 select-none items-center gap-2 rounded-md px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:shrink-0 [&_svg]:text-muted";

export function MenuItem({
  className,
  danger,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Item> & { danger?: boolean }) {
  return (
    <DropdownMenu.Item
      className={cn(
        itemBase,
        danger && "text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text",
        className,
      )}
      {...props}
    />
  );
}

export function MenuCheckItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem className={cn(itemBase, "pr-8", className)} {...props}>
      {children}
      <DropdownMenu.ItemIndicator className="absolute right-2 inline-flex">
        <CheckIcon size={14} weight="bold" className="!text-accent" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.CheckboxItem>
  );
}

export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={cn(itemBase, "pr-8", className)} {...props}>
      {children}
      <DropdownMenu.ItemIndicator className="absolute right-2 inline-flex">
        <CheckIcon size={14} weight="bold" className="!text-accent" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn("px-2 pb-1 pt-2 text-[12px] font-medium text-muted", className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Separator>) {
  return (
    <DropdownMenu.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function MenuSubTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenu.SubTrigger>) {
  return (
    <DropdownMenu.SubTrigger
      className={cn(itemBase, "data-[state=open]:bg-surface-2", className)}
      {...props}
    />
  );
}

export function MenuSubContent({
  className,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenu.SubContent>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        sideOffset={6}
        collisionPadding={collisionPadding}
        className={cn(surface, className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}
