import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redboothClient } from "../redbooth/client";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A fake Redbooth: `route` answers each request; every URL asked for is recorded. */
function fakeFetch(route: (url: URL, init?: RequestInit) => Reply) {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    const r = route(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...r.headers },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const tokens = { accessToken: "a1", refreshToken: "r1", expiresAt: null };
const noSleep = async () => {};
const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

beforeEach(() => {
  vi.stubEnv("REDBOOTH_API_URL", "https://rb.test/api/3");
  vi.stubEnv("REDBOOTH_OAUTH_URL", "https://rb.test/oauth2");
  vi.stubEnv("REDBOOTH_CLIENT_ID", "cid");
  vi.stubEnv("REDBOOTH_CLIENT_SECRET", "secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("redboothClient paging", () => {
  it("follows the PaginationTotalPages header", async () => {
    const { fn, calls } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page"));
      return { body: ids(2, page * 10), headers: { PaginationTotalPages: "3" } };
    });
    const rb = redboothClient({ tokens, fetchImpl: fn, sleep: noSleep });
    expect(await rb.users()).toHaveLength(6);
    expect(calls.map((c) => c.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(calls[0].searchParams.get("per_page")).toBe("100");
    expect(calls[0].pathname).toBe("/api/3/users");
  });

  it("without the header, keeps going past short pages until an empty one", async () => {
    // The server caps pages at 20 even though we ask for 100.
    const { fn } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page"));
      return { body: page <= 3 ? ids(20, page * 100) : [] };
    });
    const rb = redboothClient({ tokens, fetchImpl: fn, sleep: noSleep });
    expect(await rb.users()).toHaveLength(60);
  });

  it("stops if the server ignores the page number", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: ids(5) }));
    const rb = redboothClient({ tokens, fetchImpl: fn, sleep: noSleep });
    expect(await rb.users()).toHaveLength(5);
    expect(calls).toHaveLength(2);
  });

  it("skips malformed rows instead of failing", async () => {
    const { fn } = fakeFetch((url) =>
      url.searchParams.get("page") === "1" ? { body: [{ id: 1 }, { nope: true }, { id: "2" }] } : { body: [] },
    );
    const rb = redboothClient({ tokens, fetchImpl: fn, sleep: noSleep });
    expect((await rb.users()).map((u) => u.id)).toEqual(["1", "2"]);
  });
});

describe("redboothClient resilience", () => {
  it("waits and retries when rate limited", async () => {
    let n = 0;
    const waits: number[] = [];
    const { fn } = fakeFetch(() => {
      n++;
      if (n === 1) return { status: 429, headers: { "retry-after": "3" } };
      return { body: { id: 7, email: "me@x.co" } };
    });
    const rb = redboothClient({ tokens, fetchImpl: fn, sleep: async (ms) => void waits.push(ms) });
    expect((await rb.me()).id).toBe("7");
    expect(waits).toEqual([3000]);
  });

  it("refreshes an expired token once and hands the new tokens back", async () => {
    const saved: string[] = [];
    const { fn, calls } = fakeFetch((url, init) => {
      if (url.pathname === "/oauth2/token") {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("refresh_token")).toBe("r1");
        return { body: { access_token: "a2", refresh_token: "r2", expires_in: 7200 } };
      }
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer a2" ? { body: { id: 1 } } : { status: 401 };
    });
    const rb = redboothClient({
      tokens,
      fetchImpl: fn,
      sleep: noSleep,
      onTokens: async (t) => void saved.push(`${t.accessToken}/${t.refreshToken}`),
    });
    expect((await rb.me()).id).toBe("1");
    expect(saved).toEqual(["a2/r2"]);
    expect(rb.tokens.refreshToken).toBe("r2");
    expect(calls.filter((c) => c.pathname === "/oauth2/token")).toHaveLength(1);
  });

  it("gives a clear error when there's no way to refresh", async () => {
    const { fn } = fakeFetch(() => ({ status: 401 }));
    const rb = redboothClient({ tokens: { ...tokens, refreshToken: null }, fetchImpl: fn, sleep: noSleep });
    await expect(rb.me()).rejects.toThrow(/sign-in/);
  });

  it("finds the task list endpoint under either name", async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.pathname.endsWith("/task_lists")) return { status: 404 };
      return url.searchParams.get("page") === "1"
        ? { body: [{ id: 1, project_id: 9 }, { id: 2, project_id: 8 }] }
        : { body: [] };
    });
    const rb = redboothClient({ tokens, fetchImpl: fn, sleep: noSleep });
    expect((await rb.taskLists("9")).map((l) => l.id)).toEqual(["1"]);
    await rb.taskLists("9");
    // The working path is remembered: only one 404 in total.
    expect(calls.filter((c) => c.pathname.endsWith("/task_lists"))).toHaveLength(1);
  });
});
