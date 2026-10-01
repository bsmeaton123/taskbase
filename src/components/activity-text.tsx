import {
  ArrowCounterClockwiseIcon,
  ArrowsLeftRightIcon,
  CalendarBlankIcon,
  CalendarDotsIcon,
  CheckSquareIcon,
  FlagIcon,
  LinkSimpleBreakIcon,
  LinkSimpleIcon,
  PaperclipIcon,
  PlusCircleIcon,
  RepeatIcon,
  SparkleIcon,
  TagIcon,
  TextTIcon,
  UserIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { StatusIcon } from "@/components/task-bits";
import type { ActivityData, ActivityKind, TaskStatus } from "@/db/schema";
import { formatDue } from "@/lib/dates";
import { STATUS_META } from "@/lib/status";

export type ActivityContext = {
  today: string;
  viewerId: string;
  /** Who made the change. */
  actorId: string | null | undefined;
  /** Link task numbers ("#142"). Off where the text already sits inside a link. */
  linkTasks?: boolean;
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function TaskLink({ number }: { number: string | number | boolean }) {
  return (
    <Link href={`/t/${number}`} className="font-medium text-text hover:underline">
      #{String(number)}
    </Link>
  );
}

/**
 * The icon and wording for one activity, without the person: "changed the status to
 * Resolved". Shared by the task panel's history and My tasks > Updates.
 */
export function describeActivity(
  kind: ActivityKind,
  d: ActivityData,
  ctx: ActivityContext,
): { icon: React.ReactNode; text: React.ReactNode } {
  const { today, viewerId } = ctx;
  const strong = (s: React.ReactNode) => <span className="font-medium text-text">{s}</span>;
  const taskRef = (number: string | number | boolean) =>
    ctx.linkTasks === false ? strong(`#${String(number)}`) : <TaskLink number={number} />;

  let icon: React.ReactNode = <SparkleIcon size={13} />;
  let text: React.ReactNode = null;

  switch (kind) {
    case "task_created":
      icon = <PlusCircleIcon size={13} />;
      text = d.source ? <>created this task in {String(d.source)}</> : <>created this task</>;
      break;
    case "renamed":
      icon = <TextTIcon size={13} />;
      text = <>renamed this from {strong(`“${d.from}”`)}</>;
      break;
    case "status_changed":
      icon = <StatusIcon status={d.to as TaskStatus} size={13} />;
      text = <>changed the status to {strong(STATUS_META[d.to as TaskStatus]?.label ?? d.to)}</>;
      break;
    case "assigned":
      icon = <UserIcon size={13} />;
      text =
        d.userId && d.userId === ctx.actorId ? (
          <>joined this task</>
        ) : (
          <>assigned this to {strong(d.userId && d.userId === viewerId ? "you" : (d.name ?? "someone"))}</>
        );
      break;
    case "unassigned":
      icon = <UserIcon size={13} />;
      // Older entries (from when a task had one assignee) don't say who was removed.
      text = !d.userId && !d.name ? (
        <>removed the assignee</>
      ) : d.userId && d.userId === ctx.actorId ? (
        <>left this task</>
      ) : (
        <>unassigned {strong(d.userId && d.userId === viewerId ? "you" : (d.name ?? "someone"))}</>
      );
      break;
    case "due_changed":
      icon = <CalendarBlankIcon size={13} />;
      text = d.to ? (
        <>set the due date to {strong(formatDue(String(d.to), today))}</>
      ) : (
        <>removed the due date</>
      );
      break;
    case "urgent_changed":
      icon = <FlagIcon size={13} />;
      text = d.urgent ? <>marked this as urgent</> : <>removed the urgent flag</>;
      break;
    case "moved":
      icon = <ArrowsLeftRightIcon size={13} />;
      text = d.workspace ? (
        <>
          moved this to {strong(d.list)} in {strong(d.workspace)}
        </>
      ) : (
        <>moved this to {strong(d.list)}</>
      );
      break;
    case "subtask_added":
      icon = <CheckSquareIcon size={13} />;
      text = <>added the subtask {strong(`“${d.title}”`)}</>;
      break;
    case "subtask_completed":
      icon = <CheckSquareIcon size={13} weight="fill" />;
      text = <>completed {strong(`“${d.title}”`)}</>;
      break;
    case "subtask_reopened":
      icon = <CheckSquareIcon size={13} />;
      text = <>reopened {strong(`“${d.title}”`)}</>;
      break;
    case "file_added":
      icon = <PaperclipIcon size={13} />;
      text = <>attached {strong(String(d.name))}</>;
      break;
    case "start_changed":
      icon = <CalendarDotsIcon size={13} />;
      text = d.to ? (
        <>set the start date to {strong(formatDue(String(d.to), today))}</>
      ) : (
        <>removed the start date</>
      );
      break;
    case "recurrence_changed":
      icon = <RepeatIcon size={13} />;
      text = d.rule ? (
        <>set this to repeat {strong(lowerFirst(String(d.rule)))}</>
      ) : (
        <>stopped this repeating</>
      );
      break;
    case "recurred":
      icon = <RepeatIcon size={13} />;
      text = d.fromNumber ? (
        <>
          completed {taskRef(d.fromNumber)}, so this next one was created
          {d.rule ? <> ({lowerFirst(String(d.rule))})</> : null}
        </>
      ) : d.nextNumber ? (
        <>
          completed this, so the next one was created: {taskRef(d.nextNumber)}
          {d.due ? <>, due {strong(formatDue(String(d.due), today))}</> : null}
        </>
      ) : (
        <>completed the last one in this repeating series</>
      );
      break;
    case "blocker_added":
      icon = <LinkSimpleIcon size={13} />;
      text = (
        <>
          marked this as waiting for {taskRef(d.number ?? "")}{" "}
          {d.title ? strong(`“${d.title}”`) : null}
        </>
      );
      break;
    case "tag_added":
      icon = <TagIcon size={13} />;
      text = <>tagged this {strong(String(d.name))}</>;
      break;
    case "tag_removed":
      icon = <TagIcon size={13} />;
      text = <>removed the tag {strong(String(d.name))}</>;
      break;
    case "restored":
      icon = <ArrowCounterClockwiseIcon size={13} />;
      text = <>restored this from the trash</>;
      break;
    case "blocker_removed":
      icon = <LinkSimpleBreakIcon size={13} />;
      text = d.number ? (
        <>
          stopped this waiting for {taskRef(d.number)}
        </>
      ) : (
        <>removed a task this was waiting for</>
      );
      break;
  }

  return { icon, text };
}
