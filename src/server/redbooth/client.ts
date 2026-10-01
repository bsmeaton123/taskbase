import "server-only";
import { z } from "zod";

/**
 * A small Redbooth API v3 client for the importer: reads everything a project holds.
 *
 * - Auth: OAuth 2 bearer tokens, which last two hours; each refresh returns a new refresh
 *   token, handed to `onTokens` so the caller can store it.
 * - Lists are paged (`page`, `per_page`); Redbooth reports the page count in a
 *   PaginationTotalPages header. Without it we read until an empty page, never trusting
 *   a short page to be the last (the server may cap per_page lower than we ask).
 * - Rate limits and server errors are retried with backoff.
 *
 * REDBOOTH_API_URL / REDBOOTH_OAUTH_URL point it elsewhere (scripts/mock-redbooth.mjs).
 */
export const redboothApiUrl = () =>
  (process.env.REDBOOTH_API_URL || "https://redbooth.com/api/3").replace(/\/$/, "");
export const redboothOAuthUrl = () =>
  (process.env.REDBOOTH_OAUTH_URL || "https://redbooth.com/oauth2").replace(/\/$/, "");

export class RedboothError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type RedboothTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

const id = z.union([z.number(), z.string()]).transform(String);
const optId = z.union([z.number(), z.string()]).transform(String).nullish();

export const rbUser = z.looseObject({
  id,
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  username: z.string().nullish(),
  email: z.string().nullish(),
});
export const rbOrganization = z.looseObject({ id, name: z.string().nullish() });
export const rbProject = z.looseObject({
  id,
  name: z.string().nullish(),
  organization_id: optId,
  archived: z.boolean().nullish(),
  description: z.string().nullish(),
});
export const rbTaskList = z.looseObject({
  id,
  name: z.string().nullish(),
  project_id: optId,
  position: z.number().nullish(),
  archived: z.boolean().nullish(),
  deleted: z.boolean().nullish(),
});
export const rbTask = z.looseObject({
  id,
  name: z.string().nullish(),
  task_list_id: optId,
  project_id: optId,
  assigned_id: optId,
  user_id: optId,
  status: z.string().nullish(),
  due_on: z.unknown().optional(),
  urgent: z.boolean().nullish(),
  position: z.number().nullish(),
  description: z.string().nullish(),
  description_html: z.string().nullish(),
  watcher_ids: z.array(id).nullish(),
  deleted: z.boolean().nullish(),
  created_at: z.unknown().optional(),
  updated_at: z.unknown().optional(),
});
export const rbSubtask = z.looseObject({
  id,
  name: z.string().nullish(),
  task_id: optId,
  resolved: z.boolean().nullish(),
  position: z.number().nullish(),
  created_at: z.unknown().optional(),
});
export const rbComment = z.looseObject({
  id,
  body: z.string().nullish(),
  body_html: z.string().nullish(),
  user_id: optId,
  target_type: z.string().nullish(),
  target_id: optId,
  upload_ids: z.array(id).nullish(),
  created_at: z.unknown().optional(),
});
export const rbPerson = z.looseObject({
  id,
  user_id: optId,
  project_id: optId,
  role: z.string().nullish(),
});
export const rbFile = z.looseObject({
  id,
  name: z.string().nullish(),
  project_id: optId,
  mime_type: z.string().nullish(),
  size: z.number().nullish(),
  is_dir: z.boolean().nullish(),
  is_downloadable: z.boolean().nullish(),
  created_at: z.unknown().optional(),
  user_id: optId,
});

export type RbUser = z.infer<typeof rbUser>;
export type RbProject = z.infer<typeof rbProject>;
export type RbTaskList = z.infer<typeof rbTaskList>;
export type RbTask = z.infer<typeof rbTask>;
export type RbSubtask = z.infer<typeof rbSubtask>;
export type RbComment = z.infer<typeof rbComment>;
export type RbPerson = z.infer<typeof rbPerson>;
export type RbFile = z.infer<typeof rbFile>;

const tokenReply = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().nullish(),
  expires_in: z.number().nullish(),
});

/** Swaps an authorization code or refresh token for tokens. */
export async function exchangeRedboothToken(
  grant:
    | { grant_type: "authorization_code"; code: string; redirect_uri: string }
    | { grant_type: "refresh_token"; refresh_token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<RedboothTokens> {
  const clientId = process.env.REDBOOTH_CLIENT_ID;
  const clientSecret = process.env.REDBOOTH_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new RedboothError("Redbooth isn't set up: add REDBOOTH_CLIENT_ID and REDBOOTH_CLIENT_SECRET.", 500);
  const res = await fetchImpl(`${redboothOAuthUrl()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...grant }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new RedboothError(
      res.status === 400 || res.status === 401
        ? "Redbooth didn't accept the sign-in. Connect again."
        : `Redbooth sign-in failed (${res.status}).`,
      res.status,
    );
  const t = tokenReply.parse(await res.json());
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
  };
}

export function redboothAuthorizeUrl(state: string, redirectUri: string) {
  const url = new URL(`${redboothOAuthUrl()}/authorize`);
  url.searchParams.set("client_id", process.env.REDBOOTH_CLIENT_ID ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

const PER_PAGE = 100;
const MAX_PAGES = 2000;

export function redboothClient(opts: {
  tokens: RedboothTokens;
  onTokens?: (tokens: RedboothTokens) => Promise<void>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}) {
  let tokens = opts.tokens;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let taskListPath: "task_lists" | "tasklists" | null = null;

  async function refresh() {
    if (!tokens.refreshToken)
      throw new RedboothError("The Redbooth sign-in has expired. Connect again to carry on.", 401);
    tokens = await exchangeRedboothToken(
      { grant_type: "refresh_token", refresh_token: tokens.refreshToken },
      fetchImpl,
    );
    await opts.onTokens?.(tokens);
  }

  async function request(
    path: string,
    params: Record<string, string | number> = {},
    attempt = 0,
  ): Promise<Response> {
    if (tokens.refreshToken && tokens.expiresAt && tokens.expiresAt.getTime() - Date.now() < 120_000)
      await refresh();
    const url = new URL(`${redboothApiUrl()}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (attempt >= 4) throw new RedboothError(`Couldn't reach Redbooth (${String(error)}).`, 503);
      await sleep(1000 * 2 ** attempt);
      return request(path, params, attempt + 1);
    }
    if (res.status === 401 && attempt === 0 && tokens.refreshToken) {
      await refresh();
      return request(path, params, attempt + 1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120) * 1000 : 1000 * 2 ** attempt);
      return request(path, params, attempt + 1);
    }
    if (!res.ok) {
      const detail = await res
        .json()
        .then((b: { errors?: { message?: string } }) => b?.errors?.message)
        .catch(() => undefined);
      const message =
        res.status === 401
          ? "Redbooth didn't accept the sign-in. Connect again."
          : res.status === 403
            ? "That Redbooth account can't see this. Use an account with access to it."
            : `Redbooth replied ${res.status}${detail ? `: ${detail}` : ""}.`;
      throw new RedboothError(message, res.status);
    }
    return res;
  }

  async function list<T extends z.ZodType>(
    schema: T,
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<z.infer<T>[]> {
    const out: z.infer<T>[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await request(path, { ...params, page, per_page: PER_PAGE });
      const body: unknown = await res.json();
      if (!Array.isArray(body))
        throw new RedboothError(`Redbooth sent something unexpected for ${path}.`, 502);
      let fresh = 0;
      for (const raw of body) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) continue;
        const key = String((parsed.data as { id: string }).id);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(parsed.data);
        fresh++;
      }
      const total = Number(res.headers.get("PaginationTotalPages"));
      if (Number.isFinite(total) && total > 0) {
        if (page >= total) break;
      } else if (body.length === 0 || fresh === 0) {
        // No page count: stop at an empty page, or if the server ignores `page`.
        break;
      }
    }
    return out;
  }

  return {
    get tokens() {
      return tokens;
    },
    async me() {
      return rbUser.parse(await (await request("me")).json());
    },
    organizations: () => list(rbOrganization, "organizations"),
    projects: () => list(rbProject, "projects"),
    users: () => list(rbUser, "users"),
    async people(projectId: string) {
      const rows = await list(rbPerson, "people", { project_id: projectId });
      return rows.filter((p) => !p.project_id || p.project_id === projectId);
    },
    async taskLists(projectId: string) {
      // The docs name this "tasklists"; the Ruby client "task_lists". Use whichever answers.
      const paths = taskListPath ? [taskListPath] : (["task_lists", "tasklists"] as const);
      for (const path of paths) {
        try {
          const rows = await list(rbTaskList, path, { project_id: projectId });
          taskListPath = path;
          return rows.filter((l) => !l.project_id || l.project_id === projectId);
        } catch (error) {
          if (!(error instanceof RedboothError && error.status === 404) || path === paths.at(-1))
            throw error;
        }
      }
      return [];
    },
    async tasks(projectId: string) {
      const rows = await list(rbTask, "tasks", { project_id: projectId });
      return rows.filter((t) => !t.project_id || t.project_id === projectId);
    },
    subtasks: (projectId: string) => list(rbSubtask, "subtasks", { project_id: projectId }),
    async comments(projectId: string) {
      const rows = await list(rbComment, "comments", { project_id: projectId, target_type: "Task" });
      return rows.filter((c) => !c.target_type || c.target_type.toLowerCase() === "task");
    },
    files: (projectId: string) => list(rbFile, "files", { project_id: projectId }),
    /** A file's bytes, or null if it's bigger than `maxBytes` or can't be fetched. */
    async download(file: RbFile, maxBytes: number): Promise<Buffer | null> {
      if (file.is_dir || file.is_downloadable === false) return null;
      if (file.size && file.size > maxBytes) return null;
      const name = encodeURIComponent(file.name || "file");
      try {
        const res = await request(`files/${file.id}/download/original/${name}`);
        const length = Number(res.headers.get("content-length"));
        if (Number.isFinite(length) && length > maxBytes) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        return bytes.length > maxBytes ? null : bytes;
      } catch (error) {
        if (error instanceof RedboothError && error.status === 401) throw error;
        return null;
      }
    },
  };
}

export type RedboothClient = ReturnType<typeof redboothClient>;
