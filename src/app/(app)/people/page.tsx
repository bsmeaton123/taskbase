import { ArrowSquareInIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InviteButton, PendingInvites } from "@/components/invites";
import { PageHeader } from "@/components/page-header";
import { PeopleTable } from "@/components/people-table";
import { Button } from "@/components/ui/button";
import { authConfig } from "@/lib/auth";
import { allowedEmailDomains } from "@/lib/email-domains";
import { openSignupEnabled } from "@/lib/invites";
import { requireUser } from "@/lib/session";
import { getAllPeople, getPendingInvites } from "@/server/queries";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const viewer = await requireUser();
  if (!viewer.isAdmin) notFound();
  const [people, invites] = await Promise.all([getAllPeople(), getPendingInvites()]);
  const domains = allowedEmailDomains().map((d) => `@${d}`).join(" or ");

  const howToJoin = openSignupEnabled()
    ? `Anyone with a ${domains} email can sign up at /sign-up.`
    : authConfig.googleEnabled && domains
      ? `People can join with an invite link, or by signing in with their ${domains} Google account.`
      : "New people join with an invite link.";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="People">
        <Button variant="ghost" asChild>
          <Link href="/import">
            <ArrowSquareInIcon size={16} />
            <span className="hidden sm:inline">Import from Redbooth</span>
            <span className="sr-only sm:hidden">Import from Redbooth</span>
          </Link>
        </Button>
        <InviteButton />
      </PageHeader>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-4xl gap-6 px-4 py-6 sm:px-6">
          <p className="max-w-[70ch] text-[13px] text-muted">
            {howToJoin} Admins can manage people and see every workspace. Deactivated
            people are signed out and can&apos;t sign back in.
          </p>
          <PendingInvites invites={invites} />
          <PeopleTable
            people={people.map((p) => ({
              ...p,
              role: p.role ?? "user",
              banned: Boolean(p.banned),
            }))}
          />
        </div>
      </div>
    </div>
  );
}
