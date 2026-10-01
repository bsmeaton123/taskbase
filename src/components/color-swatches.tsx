"use client";

import { CheckIcon, EyedropperIcon } from "@phosphor-icons/react/ssr";
import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  HEX_COLOR,
  WORKSPACE_COLOR_KEYS,
  WORKSPACE_COLORS,
  workspaceSwatch,
} from "@/lib/colors";
import { cn } from "@/lib/utils";

const swatch =
  "inline-flex size-7 items-center justify-center rounded-md text-accent-fg ring-offset-2 ring-offset-surface transition-shadow";

/**
 * The nine palette colours, plus a "Custom" swatch that opens the browser's colour picker.
 * `value` is a palette key or a hex colour (#rrggbb). Arrow keys move between swatches;
 * Enter or Space picks one (picking can save straight away, so moving alone doesn't).
 */
export function ColorSwatches({
  value,
  onChange,
  label = "Colour",
}: {
  value: string;
  onChange: (c: string) => void;
  label?: string;
}) {
  const custom = HEX_COLOR.test(value);
  const picker = useRef<HTMLInputElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const hexId = useId();
  // Typed text is kept separately so a half-typed value doesn't change the colour yet.
  const [hexText, setHexText] = useState(custom ? value : "");
  const [hexError, setHexError] = useState(false);

  // One tab stop for the group: the chosen swatch, or the first.
  const checked = custom
    ? WORKSPACE_COLOR_KEYS.length
    : WORKSPACE_COLOR_KEYS.indexOf(value as (typeof WORKSPACE_COLOR_KEYS)[number]);
  const tabStop = checked >= 0 ? checked : 0;

  function commitHex(text: string) {
    const v = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
    const ok = HEX_COLOR.test(v);
    setHexError(!ok);
    if (ok) onChange(v.toLowerCase());
  }

  function openPicker() {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.click();
    }
  }

  function moveFocus(e: React.KeyboardEvent) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const radios = Array.from(
      group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
    );
    const i = radios.indexOf(document.activeElement as HTMLButtonElement);
    radios[(i + step + radios.length) % radios.length]?.focus();
  }

  return (
    <div className="grid gap-2">
      <div
        ref={group}
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label={label}
        onKeyDown={moveFocus}
      >
        {WORKSPACE_COLOR_KEYS.map((key, i) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            aria-label={WORKSPACE_COLORS[key].label}
            title={WORKSPACE_COLORS[key].label}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(key)}
            className={cn(swatch, value === key && "ring-2 ring-text/70")}
            style={{ background: WORKSPACE_COLORS[key].swatch }}
          >
            {value === key && <CheckIcon size={13} weight="bold" />}
          </button>
        ))}
        <span className="relative inline-flex">
          {/*
            The browser's colour input can't sit inside a button, so it lies under the swatch
            (where its picker opens) and the swatch opens it.
          */}
          <input
            ref={picker}
            type="color"
            tabIndex={-1}
            aria-hidden
            value={custom ? value : "#1f6fe8"}
            onChange={(e) => {
              onChange(e.target.value.toLowerCase());
              setHexText(e.target.value.toLowerCase());
              setHexError(false);
            }}
            className="pointer-events-none absolute inset-0 size-full opacity-0"
          />
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            aria-label={custom ? `Custom colour ${value}` : "Custom colour"}
            title="Pick your own colour"
            tabIndex={tabStop === WORKSPACE_COLOR_KEYS.length ? 0 : -1}
            onClick={openPicker}
            className={cn(
              swatch,
              "relative overflow-hidden border border-border",
              custom && "ring-2 ring-text/70",
            )}
            style={
              custom
                ? { background: workspaceSwatch(value) }
                : { background: "conic-gradient(from 0deg, #e8590c, #f5c400, #2fb344, #1f6fe8, #a855f7, #e8590c)" }
            }
          >
            {custom ? (
              <CheckIcon size={13} weight="bold" />
            ) : (
              <EyedropperIcon size={13} weight="fill" className="drop-shadow" />
            )}
          </button>
        </span>
      </div>
      {custom && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={hexId} className="text-[12.5px] text-muted">
            Hex
          </label>
          <Input
            id={hexId}
            value={hexText}
            onChange={(e) => {
              setHexText(e.target.value);
              setHexError(false);
            }}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitHex(e.currentTarget.value);
              }
            }}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-label="Custom colour hex value"
            aria-invalid={hexError || undefined}
            aria-describedby={hexError ? `${hexId}-error` : undefined}
            className="h-7 w-24 px-2 font-mono text-[12.5px]"
          />
          {hexError && (
            <span id={`${hexId}-error`} role="alert" className="text-[12px] text-danger-text">
              Use six hex digits, like #1f6fe8.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
