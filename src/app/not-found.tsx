import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col px-4 py-6 sm:px-8">
      <Brand />
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center gap-3 py-12">
        <h1 className="text-[22px] font-semibold tracking-tight">We couldn&apos;t find that page</h1>
        <p className="text-muted">
          It may have been deleted, or it&apos;s in a workspace you&apos;re not a member of.
        </p>
        <Link href="/my-tasks" className="font-medium text-accent-text hover:underline">
          Go to My tasks
        </Link>
      </main>
    </div>
  );
}
