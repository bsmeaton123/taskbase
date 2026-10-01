export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };
