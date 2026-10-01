export function allowedEmailDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function isEmailDomainAllowed(email: unknown): boolean {
  const domains = allowedEmailDomains();
  if (domains.length === 0) return true;
  if (typeof email !== "string") return false;
  const domain = email.split("@").pop()?.toLowerCase();
  return Boolean(domain && domains.includes(domain));
}
