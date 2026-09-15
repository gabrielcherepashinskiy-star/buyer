import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { createUserSession, getUser, verifyKey } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Sign in · Buying Desk" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (user) throw redirect("/");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const key = String(form.get("key") || "");
  const redirectTo = String(form.get("redirectTo") || "/");
  const name = verifyKey(key);
  if (!name) {
    return json({ error: "That master key wasn't recognized." }, { status: 401 });
  }
  const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/";
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
        <div className="brand" style={{ marginBottom: 6 }}>
          <span className="dot" />
          <span style={{ fontSize: 18 }}>Buying Desk</span>
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          SHOP SELECT NYC · enter your master key
        </p>
        {actionData?.error ? <div className="alert err">{actionData.error}</div> : null}
        <Form method="post">
          <input type="hidden" name="redirectTo" value={params.get("redirectTo") || "/"} />
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="key">Master key</label>
            <input
              id="key"
              name="key"
              type="password"
              autoComplete="current-password"
              autoFocus
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
