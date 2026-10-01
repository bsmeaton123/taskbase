// Development-only stand-in for the Redbooth API (v3) and its OAuth 2 endpoints, so the
// Redbooth importer can be run end to end without a Redbooth account.
//
//   npm run redbooth:mock                        # listens on :3998
//   REDBOOTH_API_URL=http://127.0.0.1:3998/api/3 \
//   REDBOOTH_OAUTH_URL=http://127.0.0.1:3998/oauth2 \
//   REDBOOTH_CLIENT_ID=mock REDBOOTH_CLIENT_SECRET=mock npm run dev
//
// It behaves like the documented API where the importer depends on it: bearer tokens
// that rotate on refresh, Unix-second timestamps, `page`/`per_page` paging capped at 20
// per page (with a PaginationTotalPages header on some lists and not others), task lists
// only under the documented "tasklists" path, and files fetched from
// files/:id/download/original/:name. The data includes the awkward cases: people whose
// emails do and don't match accounts, HTML-only text, deleted tasks, empty comments,
// comments on conversations, and a file too big to import.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 3998);
const PAGE_CAP = 20;
const t = (iso) => Math.floor(new Date(iso).getTime() / 1000);

let validTokens = new Set();
let refreshTokens = new Map(); // refresh -> generation
let generation = 0;
function issue() {
  generation++;
  const access = `mock-access-${generation}`;
  const refresh = `mock-refresh-${generation}`;
  validTokens = new Set([access]);
  refreshTokens = new Map([[refresh, generation]]);
  return { access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 7200 };
}

const users = [
  { id: 1, first_name: "Amara", last_name: "Okafor", username: "amara", email: "amara@digibooth.test" },
  { id: 2, first_name: "Priya", last_name: "Raman", username: "priya", email: "PRIYA@digibooth.test" },
  { id: 3, first_name: "Tomasz", last_name: "Wiśniewski", username: "tomasz", email: "tomasz@digibooth.test" },
  { id: 4, first_name: "Nadia", last_name: "Brooks", username: "nadia", email: "nadia@partner.example" },
  { id: 5, first_name: "Owen", last_name: "Marsh", username: "owen", email: "owen@partner.example" },
];
const organizations = [{ id: 1, name: "Studio" }];
const projects = [
  { id: 101, name: "Client work - Web Design & Dev", organization_id: 1, archived: false },
  { id: 102, name: "To be invoiced", organization_id: 1, archived: false },
];
const people = [
  { id: 901, user_id: 1, project_id: 101, role: "admin" },
  { id: 902, user_id: 2, project_id: 101, role: "participant" },
  { id: 903, user_id: 3, project_id: 101, role: "participant" },
  { id: 904, user_id: 4, project_id: 101, role: "admin" },
  { id: 905, user_id: 1, project_id: 102, role: "admin" },
  { id: 906, user_id: 5, project_id: 102, role: "participant" },
];
const tasklists = [
  { id: 201, name: "WEB TASKS", project_id: 101, position: 1, archived: false },
  { id: 202, name: "Done", project_id: 101, position: 2, archived: true },
  { id: 203, name: "Invoices", project_id: 102, position: 1, archived: false },
];
const base = { urgent: false, deleted: false, description: "", description_html: "" };
const tasks = [
  {
    ...base, id: 301, project_id: 101, task_list_id: 201, assigned_id: 4, user_id: 1, status: "open",
    name: "Riverside Window Cleaners - lots of spam enquiries coming through the contact form",
    due_on: "2026-10-02", watcher_ids: [1, 4, 2], position: 1, created_at: t("2026-09-28T15:20:00Z"),
  },
  {
    ...base, id: 302, project_id: 101, task_list_id: 201, assigned_id: 4, user_id: 4, status: "new",
    name: "Brightline Alarms website", due_on: "2026-10-07", watcher_ids: [4], position: 2,
    created_at: t("2026-09-20T09:00:00Z"),
  },
  {
    ...base, id: 303, project_id: 101, task_list_id: 201, assigned_id: 2, user_id: 2, status: "hold",
    name: "Harbour Cafe email campaign", due_on: null, urgent: true, watcher_ids: [2, 1], position: 3,
    description_html: "<p>Waiting on <b>copy</b> from the client.</p><ul><li>Hero</li><li>Footer</li></ul>",
    created_at: t("2026-09-15T12:00:00Z"),
  },
  {
    ...base, id: 304, project_id: 101, task_list_id: 202, assigned_id: 3, user_id: 1, status: "resolved",
    name: "Northgate Electrical - commercial services page", due_on: "2026-09-29", watcher_ids: [3],
    position: 1, description: "Launched. Monitor forms for a week.", created_at: t("2026-09-01T08:00:00Z"),
  },
  {
    ...base, id: 305, project_id: 101, task_list_id: 202, assigned_id: null, user_id: 1, status: "rejected",
    name: "Rebuild in WordPress", due_on: "1998-01-01", watcher_ids: [], position: 2,
    created_at: t("2026-08-01T08:00:00Z"),
  },
  {
    ...base, id: 306, project_id: 101, task_list_id: 201, assigned_id: 1, user_id: 1, status: "open",
    name: "Deleted in Redbooth (must not be imported)", deleted: true, watcher_ids: [], position: 4,
    created_at: t("2026-09-02T08:00:00Z"),
  },
  ...Array.from({ length: 19 }, (_, i) => ({
    ...base, id: 310 + i, project_id: 101, task_list_id: 201, assigned_id: [1, 2, 3, 5, null][i % 5],
    user_id: 1, status: ["new", "open", "hold", "resolved"][i % 4], name: `Website tweak ${i + 1}`,
    due_on: i % 3 === 0 ? `2026-10-${String(10 + i).padStart(2, "0")}` : null, watcher_ids: [1],
    position: 10 + i, created_at: t("2026-09-10T08:00:00Z") + i * 3600,
  })),
  {
    ...base, id: 401, project_id: 102, task_list_id: 203, assigned_id: null, user_id: 5, status: "open",
    name: "Set up a Google Business profile for Juniper Dental", due_on: null, watcher_ids: [5, 1],
    position: 1, created_at: t("2026-09-29T11:25:00Z"),
  },
];
const subtasks = [
  { id: 601, task_id: 301, name: "Add honeypot field", resolved: true, position: 1, created_at: t("2026-09-28T16:00:00Z") },
  { id: 602, task_id: 301, name: "Turn on reCAPTCHA", resolved: false, position: 2, created_at: t("2026-09-28T16:01:00Z") },
  { id: 603, task_id: 303, name: "Chase copy", resolved: false, position: 1, created_at: t("2026-09-16T10:00:00Z") },
  { id: 604, task_id: 306, name: "Belongs to a deleted task", resolved: false, position: 1, created_at: t("2026-09-02T09:00:00Z") },
];
const comments = [
  {
    id: 701, project_id: 101, target_type: "Task", target_id: 301, user_id: 4, upload_ids: [501, 502],
    body: "Asked the client for a few examples so we can tighten up the form",
    body_html: "", created_at: t("2026-09-30T15:06:00Z"),
  },
  { id: 702, project_id: 101, target_type: "Task", target_id: 301, user_id: 1, body: "Thanks, keep me posted.", body_html: "", created_at: t("2026-09-30T15:30:00Z") },
  { id: 703, project_id: 101, target_type: "Task", target_id: 303, user_id: 2, body: "", body_html: "<p>Client says <i>Friday</i> &amp; not before.</p>", created_at: t("2026-09-29T16:09:00Z") },
  { id: 704, project_id: 101, target_type: "Task", target_id: 302, user_id: 4, body: "", body_html: "", created_at: t("2026-09-29T12:50:00Z") },
  { id: 705, project_id: 101, target_type: "Conversation", target_id: 999, user_id: 1, body: "Not a task comment", body_html: "", created_at: t("2026-09-29T12:00:00Z") },
  { id: 706, project_id: 102, target_type: "Task", target_id: 401, user_id: 5, body: "All assignees removed, I'll pick this up next week.", body_html: "", created_at: t("2026-09-30T11:25:00Z") },
];
const files = [
  { id: 501, project_id: 101, name: "spam-examples.txt", mime_type: "text/plain", size: 64, is_dir: false, is_downloadable: true, user_id: 4, created_at: t("2026-09-30T15:05:00Z") },
  { id: 502, project_id: 101, name: "huge-video.mov", mime_type: "video/quicktime", size: 900 * 1024 * 1024, is_dir: false, is_downloadable: true, user_id: 4, created_at: t("2026-09-30T15:05:00Z") },
];
const fileBytes = { 501: "From: spam@example.com\nSubject: CHEAP SEO!!!\nRepeated 40 times a day.\n" };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function paged(res, url, rows, { withHeader }) {
  const perPage = Math.min(Number(url.searchParams.get("per_page")) || 20, PAGE_CAP);
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
  const pages = Math.max(Math.ceil(rows.length / perPage), 1);
  const slice = rows.slice((page - 1) * perPage, page * perPage);
  send(res, 200, slice, withHeader
    ? { PaginationTotalPages: String(pages), PaginationPerPage: String(perPage), PaginationCurrentPage: String(page) }
    : {});
}

const byProject = (rows, url) => {
  const p = url.searchParams.get("project_id");
  return p ? rows.filter((r) => String(r.project_id) === p) : rows;
};

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = url.pathname;
    console.log(`[redbooth-mock] ${req.method} ${path}${url.search}`);

    if (path === "/oauth2/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", "mock-code");
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: redirect.toString() });
      return res.end();
    }
    if (path === "/oauth2/token" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      if (!form.get("client_id") || !form.get("client_secret")) return send(res, 401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code" && form.get("code") === "mock-code")
        return send(res, 200, issue());
      if (form.get("grant_type") === "refresh_token" && refreshTokens.has(form.get("refresh_token")))
        return send(res, 200, issue());
      return send(res, 400, { error: "invalid_grant" });
    }

    if (!path.startsWith("/api/3/")) return send(res, 404, { errors: { type: "ObjectNotFound", message: "Not found" } });
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!validTokens.has(token)) return send(res, 401, { errors: { type: "AuthorizationFailed", message: "Invalid token" } });

    const route = path.slice("/api/3/".length);
    const download = /^files\/(\d+)\/download\/original\/.+$/.exec(route);
    if (download) {
      const bytes = fileBytes[download[1]];
      if (!bytes) return send(res, 404, { errors: { type: "ObjectNotFound", message: "No such file" } });
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": Buffer.byteLength(bytes) });
      return res.end(bytes);
    }
    switch (route) {
      case "me":
        return send(res, 200, users[0]);
      case "organizations":
        return paged(res, url, organizations, { withHeader: true });
      case "projects":
        return paged(res, url, projects, { withHeader: true });
      case "users":
        return paged(res, url, users, { withHeader: false });
      case "people":
        return paged(res, url, byProject(people, url), { withHeader: true });
      case "tasklists":
        return paged(res, url, byProject(tasklists, url), { withHeader: true });
      case "tasks":
        return paged(res, url, byProject(tasks, url), { withHeader: true });
      case "subtasks": {
        const ids = new Set(byProject(tasks, url).map((x) => x.id));
        return paged(res, url, subtasks.filter((s) => ids.has(s.task_id)), { withHeader: false });
      }
      case "comments": {
        let rows = byProject(comments, url);
        const type = url.searchParams.get("target_type");
        if (type) rows = rows.filter((c) => c.target_type.toLowerCase() === type.toLowerCase());
        return paged(res, url, rows, { withHeader: false });
      }
      case "files":
        return paged(res, url, byProject(files, url), { withHeader: true });
      default:
        return send(res, 404, { errors: { type: "ObjectNotFound", message: `No route ${route}` } });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[redbooth-mock] listening on http://127.0.0.1:${PORT}`));
