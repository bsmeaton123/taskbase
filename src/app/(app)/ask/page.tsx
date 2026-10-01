import { SparkleIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { AskChat } from "@/components/ai/ask-chat";
import { EmptyState, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { aiEnabled } from "@/server/ai/client";

export const metadata: Metadata = { title: "Ask" };

export default async function AskPage() {
  const viewer = await requireUser();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Ask" />
      {aiEnabled() ? (
        <AskChat />
      ) : (
        <EmptyState icon={<SparkleIcon size={20} />} title="AI isn't set up yet">
          {viewer.isAdmin
            ? "Add an Anthropic API key (ANTHROPIC_API_KEY) to the server's environment to turn on Ask and the other AI features."
            : "Ask an admin to connect an Anthropic API key to turn on Ask and the other AI features."}
        </EmptyState>
      )}
    </div>
  );
}
