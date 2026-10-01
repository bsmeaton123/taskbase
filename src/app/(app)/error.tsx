"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The header keeps the navigation button on phones, so there's always a way out. */}
      <PageHeader title="Something went wrong" />
      <div className="mx-auto flex max-w-sm flex-1 flex-col items-start justify-center gap-3 px-6 py-16">
        <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-danger-soft text-danger-text">
          <WarningCircleIcon size={20} />
        </span>
        <p className="text-muted">
          This page hit an unexpected error. Try again, and if it keeps happening let an admin
          know{error.digest ? ` (reference ${error.digest})` : ""}.
        </p>
        <Button variant="primary" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
