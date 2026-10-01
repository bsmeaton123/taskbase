"use client";

import { PaperclipIcon, PaperPlaneRightIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { perform, useApp } from "@/components/app-context";
import type { UploadedAttachment } from "@/app/api/attachments/route";
import { FileDropZone, KindIcon, useTaskUploads } from "@/components/attachments";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AutoTextarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { fileKind } from "@/lib/files";
import { encodeMentions } from "@/lib/mentions";
import { useIsMac } from "@/lib/use-is-mac";
import { cn } from "@/lib/utils";
import { deleteAttachment } from "@/server/actions/attachments";

export type Person = { id: string; name: string; image: string | null; email?: string };

const TRIGGER_RE = /(?:^|\s)@([^\s@]{0,40})$/;
/**
 * Textarea with @mention autocomplete. Shows plain `@Name` while typing and
 * encodes chosen people as mention tokens on submit.
 */
export function MentionTextarea({
  value,
  onChange,
  people,
  onSubmit,
  onCancel,
  placeholder,
  autoFocus,
  onMention,
  minRows = 1,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  people: Person[];
  onSubmit: () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  onMention: (p: Person) => void;
  minRows?: number;
  className?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people
      .filter(
        (p) =>
          p.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) ||
          p.name.toLowerCase().startsWith(q) ||
          p.email?.toLowerCase().startsWith(q),
      )
      .slice(0, 6);
  }, [people, query]);

  function detect(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = TRIGGER_RE.exec(before);
    setQuery(m ? m[1] : null);
    setCursor(0);
  }

  function choose(p: Person) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]{0,40})$/, `@${p.name} `);
    const next = before + value.slice(caret);
    onChange(next);
    onMention(p);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }

  const open = query !== null && matches.length > 0;

  return (
    <div className="relative">
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-0 z-20 mb-1.5 w-64 max-w-full rounded-[10px] border border-border bg-surface p-1 shadow-pop animate-pop-in"
        >
          {matches.map((p, i) => (
            <button
              key={p.id}
              id={`${listId}-${p.id}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={i === cursor}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
                i === cursor && "bg-surface-2",
              )}
            >
              <Avatar person={p} size="xs" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      <AutoTextarea
        ref={ref}
        bare
        minRows={minRows}
        value={value}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        // The textarea keeps focus while the list is open; these point readers at it.
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${matches[cursor]?.id}` : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target);
        }}
        onClick={(e) => detect(e.currentTarget)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => (c + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => (c - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(matches[cursor]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === "Escape" && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        className={cn("max-h-72 overflow-y-auto text-[14px] leading-relaxed", className)}
      />
    </div>
  );
}

export function CommentComposer({
  taskId,
  people,
  onSubmit,
}: {
  taskId: string;
  people: Person[];
  onSubmit: (body: string, attachmentIds: string[]) => Promise<boolean>;
}) {
  const { viewer } = useApp();
  const [value, setValue] = useState("");
  const [mentioned, setMentioned] = useState<Person[]>([]);
  const [files, setFiles] = useState<UploadedAttachment[]>([]);
  const [pending, startTransition] = useTransition();
  const { upload, pending: uploading } = useTaskUploads(taskId, { draft: true });
  const fileInput = useRef<HTMLInputElement>(null);
  const isMac = useIsMac();

  async function addFiles(list: FileList | File[]) {
    const done = await upload(list);
    if (done.length) setFiles((f) => [...f, ...done]);
  }

  const canSend = (value.trim() || files.length > 0) && uploading.length === 0 && !pending;

  function submit() {
    const text = value.trim();
    if (!canSend) return;
    const body = encodeMentions(text, mentioned);
    const attached = files;
    setValue("");
    setFiles([]);
    startTransition(async () => {
      const ok = await onSubmit(body, attached.map((f) => f.id));
      if (!ok) {
        setValue(text);
        setFiles(attached);
      } else setMentioned([]);
    });
  }

  return (
    <div className="border-t border-border bg-surface px-4 py-3 sm:px-6">
      <div className="flex gap-3">
        <Avatar person={viewer} size="md" className="mt-1 hidden sm:inline-flex" />
        <FileDropZone
          onFiles={addFiles}
          label="Drop to attach to your comment"
          className="min-w-0 flex-1"
        >
          <div
            className="rounded-[10px] border border-border bg-surface px-3 py-2 transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15"
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
          >
            <MentionTextarea
              value={value}
              onChange={setValue}
              people={people.filter((p) => p.id !== viewer.id)}
              onMention={(p) =>
                setMentioned((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]))
              }
              onSubmit={submit}
              placeholder="Write a comment. Type @ to mention someone."
              ariaLabel="Write a comment"
              minRows={2}
            />
            {(files.length > 0 || uploading.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <span
                    key={f.id}
                    className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-surface-2 pl-2 pr-1 text-[12.5px]"
                  >
                    <KindIcon
                      kind={fileKind(f.contentType, f.name)}
                      size={14}
                      className="shrink-0 text-muted"
                    />
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles((list) => list.filter((x) => x.id !== f.id));
                        void perform(deleteAttachment(f.id));
                      }}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-3 hover:text-text"
                      aria-label={`Remove ${f.name}`}
                    >
                      <XIcon size={11} weight="bold" />
                    </button>
                  </span>
                ))}
                {uploading.map((u) => (
                  <span
                    key={u.key}
                    className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 text-[12.5px] text-muted"
                    aria-busy="true"
                  >
                    <span className="size-2 shrink-0 rounded-full bg-subtle motion-safe:animate-pulse" />
                    <span className="truncate">Uploading {u.name}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <Tooltip content="Attach files (you can also paste or drop them)">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="-ml-1 inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
                  aria-label="Attach files"
                >
                  <PaperclipIcon size={16} />
                </button>
              </Tooltip>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <span className="hidden text-[12px] text-subtle sm:inline">
                {isMac ? "⌘" : "Ctrl"}+Enter to send
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={submit}
                disabled={!canSend}
                className="ml-auto"
              >
                <PaperPlaneRightIcon size={13} weight="fill" />
                {pending ? "Sending…" : "Comment"}
              </Button>
            </div>
          </div>
        </FileDropZone>
      </div>
    </div>
  );
}
