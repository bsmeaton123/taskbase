import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmailPreferenceForm, PasswordForm, ProfileForm } from "@/components/profile-forms";
import { db } from "@/db";
import { user } from "@/db/schema";
import { emailEnabled } from "@/lib/email";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Your profile" };

export default async function SettingsPage() {
  const viewer = await requireUser();
  const [row] = await db
    .select({ emailNotifications: user.emailNotifications, dailyReminder: user.dailyReminder })
    .from(user)
    .where(eq(user.id, viewer.id));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Your profile" />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-2xl gap-10 px-4 py-8 sm:px-6">
          <ProfileForm name={viewer.name} email={viewer.email} />
          <EmailPreferenceForm
            value={(row?.emailNotifications ?? "important") as "all" | "important" | "none"}
            dailyReminder={row?.dailyReminder ?? true}
            configured={emailEnabled()}
          />
          <PasswordForm email={viewer.email} />
        </div>
      </div>
    </div>
  );
}
