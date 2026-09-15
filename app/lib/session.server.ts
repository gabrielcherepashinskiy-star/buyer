import { createCookieSessionStorage, redirect } from "@remix-run/node";
import crypto from "node:crypto";

// ── Two master keys ────────────────────────────────────────────
// Each partner has their own key. Whichever key is entered identifies
// that person, so every purchase can be tagged with who logged it.

export type AppUser = { name: string };

function configuredUsers(): { name: string; key: string }[] {
  const users: { name: string; key: string }[] = [];
  if (process.env.USER1_KEY) {
    users.push({ name: process.env.USER1_NAME || "User 1", key: process.env.USER1_KEY });
  }
  if (process.env.USER2_KEY) {
    users.push({ name: process.env.USER2_NAME || "User 2", key: process.env.USER2_KEY });
  }
  // Legacy single-key fallback.
  if (users.length === 0 && process.env.ADMIN_PASSWORD) {
    users.push({ name: process.env.USER1_NAME || "Admin", key: process.env.ADMIN_PASSWORD });
  }
  return users;
}

/** Returns the matching user's name, or null if the key is invalid. */
export function verifyKey(key: string): string | null {
  const input = (key || "").trim();
  if (!input) return null;
  for (const u of configuredUsers()) {
    // Constant-time compare to avoid timing leaks.
    const a = Buffer.from(input);
    const b = Buffer.from(u.key);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return u.name;
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
