import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { createUserSession, getUser, verifyCredentials } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Sign in · Buying Desk" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (user) throw redirect("/admin");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const redirectTo = String(form.get("redirectTo") || "/admin");
  const name = verifyCredentials(username, password);
  if (!name) {
    return json({ error: "Incorrect username or password." }, { status: 401 });
  }
  const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/admin";
  return createUserSession(name, safeRedirect);
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const busy = nav.state !== "idle";
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <img src="/logo.png" alt="SHOP SELECT NYC" style={{ width: 150, maxWidth: "70%", height: "auto" }} />
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 13, textAlign: "center" }}>
          Buying Desk · sign in
        </p>
        {actionData?.error ? <div className="alert err">{actionData.error}</div> : null}
        <Form method="post">
          <input type="hidden" name="redirectTo" value={params.get("redirectTo") || "/admin"} />
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              required
              placeholder="Username"
            />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••••••"
            />
          </div>
          <button className="btn" type="submit" style={{ width: "100%", marginTop: 16 }} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </Form>
      </div>
    </div>
  );
}
