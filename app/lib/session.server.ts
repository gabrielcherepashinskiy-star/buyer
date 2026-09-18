import { createCookieSessionStorage, redirect } from "@remix-run/node";
import crypto from "node:crypto";

// ── Username + password login ──────────────────────────────────
// Two accounts, each with a username and password set via environment
// variables. Every purchase is tagged with the username that recorded it.
//   USER1_NAME / USER1_PASSWORD   (e.g. Gabriel)
//   USER2_NAME / USER2_PASSWORD   (partner)
// (USER1_KEY / USER2_KEY are still accepted as the password, for backward
// compatibility with an earlier setup.)

export type AppUser = { name: string };

function configuredUsers(): { name: string; password: string }[] {
  const users: { name: string; password: string }[] = [];
  const p1 = process.env.USER1_PASSWORD || process.env.USER1_KEY;
  if (p1) users.push({ name: process.env.USER1_NAME || "User 1", password: p1 });
  const p2 = process.env.USER2_PASSWORD || process.env.USER2_KEY;
  if (p2) users.push({ name: process.env.USER2_NAME || "User 2", password: p2 });
  // Legacy single-password fallback.
  if (users.length === 0 && process.env.ADMIN_PASSWORD) {
    users.push({ name: process.env.USER1_NAME || "Admin", password: process.env.ADMIN_PASSWORD });
  }
  return users;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Returns the matching user's display name, or null if the username/password
 * pair is invalid. Username match is case-insensitive; password is exact.
 */
export function verifyCredentials(username: string, password: string): string | null {
  const u = (username || "").trim();
  const p = password || "";
  if (!u || !p) return null;
  for (const acc of configuredUsers()) {
    if (acc.name.toLowerCase() === u.toLowerCase() && safeEqual(p, acc.password)) {
      return acc.name;
    }
  }
  return null;
}

const sessionSecret = process.env.SESSION_SECRET || "dev-insecure-secret-change-me";

const storage = createCookieSessionStorage({
  cookie: {
    name: "__ssb_session",
    secure: process.env.NODE_ENV === "production",
    secrets: [sessionSecret],
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14, // 14 days
    httpOnly: true,
  },
});

export async function createUserSession(userName: string, redirectTo: string) {
  const session = await storage.getSession();
  session.set("user", userName);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function getUser(request: Request): Promise<AppUser | null> {
  const session = await storage.getSession(request.headers.get("Cookie"));
  const name = session.get("user");
  if (!name || typeof name !== "string") return null;
  return { name };
}

export async function requireUser(request: Request): Promise<AppUser> {
  const user = await getUser(request);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return user;
}

export async function logout(request: Request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/login", {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}
