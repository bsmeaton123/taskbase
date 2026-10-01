"use client";

import {
  DownloadSimpleIcon,
  FileArchiveIcon,
  FileDocIcon,
  FileIcon,
  FilePdfIcon,
  FilePptIcon,
  FileTextIcon,
  FileXlsIcon,
  ImageIcon,
  PaperclipIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AttachmentInsightsButton, canSummarise } from "@/components/ai/task-ai";
import { perform, useApp } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { UploadedAttachment } from "@/app/api/attachments/route";
import { timeAgo } from "@/lib/dates";
import {
  attachmentUrl,
  fileKind,
  formatBytes,
  isPreviewableImage,
  type FileKind,
} from "@/lib/files";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { deleteAttachment } from "@/server/actions/attachments";
import type { AttachmentInfo } from "@/server/queries";

async function uploadFile(
  taskId: string,
  file: File,
  opts: { draft?: boolean } = {},
): Promise<UploadedAttachment | null> {
  const form = new FormData();
  form.set("taskId", taskId);
  form.set("file", file);
  if (opts.draft) form.set("draft", "1");
  try {
    const res = await fetch("/api/attachments", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? `Couldn't upload ${file.name}.`);
      return null;
    }
    return data as UploadedAttachment;
  } catch {
    toast.error(`Couldn't upload ${file.name}. Check your connection.`);
    return null;
  }
}

export function KindIcon({
  kind,
  size = 18,
  className,
}: {
  kind: FileKind;
  size?: number;
  className?: string;
}) {
  const props = { size, className };
  switch (kind) {
    case "image":
      return <ImageIcon {...props} />;
    case "pdf":
      return <FilePdfIcon {...props} />;
    case "doc":
      return <FileDocIcon {...props} />;
    case "sheet":
      return <FileXlsIcon {...props} />;
    case "slides":
      return <FilePptIcon {...props} />;
    case "archive":
      return <FileArchiveIcon {...props} />;
    case "text":
      return <FileTextIcon {...props} />;
    default:
      return <FileIcon {...props} />;
  }
}

/** Hook: upload dropped/picked files to a task, with a pending list for the UI. */
export function useTaskUploads(taskId: string, opts: { draft?: boolean } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ key: string; name: string }[]>([]);

  async function upload(files: FileList | File[]): Promise<UploadedAttachment[]> {
    const list = Array.from(files);
    if (list.length === 0) return [];
    const items = list.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, file: f }));
    setPending((p) => [...p, ...items.map(({ key, name }) => ({ key, name }))]);
    const done: UploadedAttachment[] = [];
    for (const item of items) {
      const res = await uploadFile(taskId, item.file, opts);
      if (res) done.push(res);
      setPending((p) => p.filter((x) => x.key !== item.key));
    }
    if (!opts.draft && done.length) router.refresh();
    return done;
  }

  return { upload, pending };
}

export function TaskFiles({
  taskId,
  files,
  canManage,
}: {
  taskId: string;
  files: AttachmentInfo[];
  canManage: boolean;
}) {
  const { upload, pending } = useTaskUploads(taskId);
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 id={headingId} className="text-[13px] font-semibold">
          Files
        </h3>
        {files.length > 0 && (
          <span className="tabular text-[12.5px] text-subtle">{files.length}</span>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
          <UploadSimpleIcon size={14} />
          Upload
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length === 0 && pending.length === 0 ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-border-strong px-3 py-3 text-left text-[13px] text-subtle hover:border-accent hover:text-text"
        >
          <PaperclipIcon size={15} />
          Drop files anywhere on this task, or click to upload.
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <FileCard key={f.id} file={f} taskId={taskId} canDelete={canManage} />
          ))}
          {pending.map((p) => (
            <li
              key={p.key}
              className="flex h-14 items-center gap-3 rounded-[10px] border border-border bg-surface px-2.5 text-[13px] text-muted"
              aria-busy="true"
            >
              <span className="size-9 shrink-0 rounded-md bg-surface-2 motion-safe:animate-pulse" />
              <span className="min-w-0 flex-1 truncate">Uploading {p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FileCard({
  file,
  taskId,
  canDelete,
}: {
  file: AttachmentInfo;
  taskId: string;
  canDelete: boolean;
}) {
  const { viewer } = useApp();
  const [confirming, setConfirming] = useState(false);
  const kind = fileKind(file.contentType, file.name);
  const mayDelete = canDelete || file.uploader?.id === viewer.id;
  return (
    <li className="group/file relative flex h-14 items-center gap-3 rounded-[10px] border border-border bg-surface px-2.5 hover:border-border-strong">
      <a
        href={attachmentUrl(file.id)}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-center gap-3"
        title={file.name}
      >
        {isPreviewableImage(file.contentType) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachmentUrl(file.id)}
            alt=""
            loading="lazy"
            className="size-9 shrink-0 rounded-md border border-border object-cover"
          />
        ) : (
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
            <KindIcon kind={kind} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{file.name}</span>
          <span className="tabular block truncate text-[12px] text-muted" suppressHydrationWarning>
            {formatBytes(file.size)}
            {file.uploader ? `, ${file.uploader.name}` : ""}, {timeAgo(file.createdAt)}
          </span>
        </span>
      </a>
      <span className="flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover/file:opacity-100 pointer-coarse:opacity-100">
        {canSummarise(file.contentType, file.name) && (
          <AttachmentInsightsButton attachmentId={file.id} taskId={taskId} name={file.name} />
        )}
        <Tooltip content="Download">
          <a
            href={attachmentUrl(file.id, true)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
            aria-label={`Download ${file.name}`}
          >
            <DownloadSimpleIcon size={15} />
          </a>
        </Tooltip>
        {mayDelete && (
          <Tooltip content="Delete file">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger-text"
              aria-label={`Delete ${file.name}`}
            >
              <TrashIcon size={15} />
            </button>
          </Tooltip>
        )}
      </span>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${file.name}?`}
        description="The file is removed from this task for everyone. This can't be undone."
        confirmLabel="Delete file"
        onConfirm={() => perform(deleteAttachment(file.id), { success: "File deleted" })}
      />
    </li>
  );
}

/** Files attached to a comment: image thumbnails plus chips for everything else. */
export function CommentFiles({ files }: { files: AttachmentInfo[] }) {
  if (files.length === 0) return null;
  const images = files.filter((f) => isPreviewableImage(f.contentType));
  const others = files.filter((f) => !isPreviewableImage(f.contentType));
  return (
    <div className="mt-2 grid gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => (
            <a
              key={f.id}
              href={attachmentUrl(f.id)}
              target="_blank"
              rel="noreferrer"
              title={f.name}
              className="block overflow-hidden rounded-md border border-border hover:border-border-strong"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachmentUrl(f.id)}
                alt={f.name}
                loading="lazy"
                className="max-h-40 max-w-[240px] object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((f) => (
            <a
              key={f.id}
              href={attachmentUrl(f.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[12.5px] hover:border-border-strong"
            >
              <KindIcon kind={fileKind(f.contentType, f.name)} size={15} className="shrink-0 text-muted" />
              <span className="truncate">{f.name}</span>
              <span className="tabular shrink-0 text-subtle">{formatBytes(f.size)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wraps a region so dropping files onto it uploads them. */
export function FileDropZone({
  onFiles,
  children,
  className,
  label = "Drop to attach to this task",
}: {
  onFiles: (files: FileList) => void;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const [over, setOver] = useState(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver((n) => n + 1);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (hasFiles(e)) setOver((n) => Math.max(0, n - 1));
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(0);
        onFiles(e.dataTransfer.files);
      }}
    >
      {children}
      {over > 0 && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-[10px] border-2 border-dashed border-accent bg-accent-soft/80 text-[14px] font-medium text-accent-text">
          <UploadSimpleIcon size={18} className="mr-2" />
          {label}
        </div>
      )}
    </div>
  );
}
