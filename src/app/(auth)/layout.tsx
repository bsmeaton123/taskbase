import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/lib/session";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="flex min-h-[100dvh] flex-col px-4 py-6 sm:px-8">
      <Brand />
      <main className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center py-12">
        {children}
      </main>
    </div>
  );
}
