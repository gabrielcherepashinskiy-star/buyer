import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { requireUser } from "~/lib/session.server";
import { Shell } from "~/components/Shell";
import { formatUSD } from "~/lib/money";
import { listSubmissions, setSubmissionStatus } from "~/lib/submission.server";

export const meta: MetaFunction = () => [{ title: "Submissions · Buying Desk" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const submissions = await listSubmissions();
  return json({
    user,
    submissions: submissions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      status: s.status,
      contactName: s.contactName,
      contactPhone: s.contactPhone,
      contactEmail: s.contactEmail,
      method: s.method,
      note: s.note,
      items: s.items.map((it) => ({
        id: it.id,
        name: it.name,
        desiredPriceCents: it.desiredPriceCents,
        quantity: it.quantity,
        notes: it.notes,
      })),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const id = String(form.get("id") || "");
  const status = String(form.get("status") || "");
  if (id && status) await setSubmissionStatus(id, status);
  return json({ ok: true });
}

const STATUSES = ["new", "reviewed", "quoted", "closed"];
const STATUS_CLASS: Record<string, string> = {
  new: "pending",
  reviewed: "active",
  quoted: "active",
  closed: "skipped",
};

export default function Submissions() {
  const { user, submissions } = useLoaderData<typeof loader>();
  const nav = useNavigation();

  return (
    <Shell user={user}>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Submissions</h1>
            <p className="muted" style={{ margin: 0 }}>
              Sell requests from your public page. {submissions.filter((s) => s.status === "new").length} new.
            </p>
          </div>
        </div>

        {submissions.length === 0 ? (
          <div className="card">
            <div className="empty">No submissions yet. They'll appear here as sellers submit.</div>
          </div>
        ) : (
          submissions.map((s) => {
            const total = s.items.reduce((sum, it) => sum + it.desiredPriceCents * (it.quantity || 1), 0);
            return (
              <div className="card" key={s.id}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>
                      {s.contactName}{" "}
                      <span className={`badge ${STATUS_CLASS[s.status] || "skipped"}`} style={{ marginLeft: 6 }}>
                        {s.status}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                      {new Date(s.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                    <div className="sync-line" style={{ marginTop: 6 }}>
                      <a className="badge" href={`tel:${s.contactPhone}`}>{s.contactPhone}</a>
                      <a className="badge" href={`mailto:${s.contactEmail}`}>{s.contactEmail}</a>
                      <span className="badge">
                        {s.method === "ship" ? "Ship — PUA" : "In-store drop-off"}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Total asking
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "var(--violet-2)" }}>{formatUSD(total)}</div>
                  </div>
                </div>

                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Details</th>
                        <th style={{ textAlign: "right" }}>Asking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.items.map((it) => (
                        <tr key={it.id}>
                          <td style={{ fontWeight: 600 }}>
                            {it.name}
                            {it.quantity > 1 ? <span className="muted"> ×{it.quantity}</span> : null}
                          </td>
                          <td className="muted">{it.notes || "—"}</td>
                          <td style={{ textAlign: "right" }}>{formatUSD(it.desiredPriceCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {s.note ? (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    <strong>Note:</strong> {s.note}
                  </p>
                ) : null}

                <div className="actions" style={{ marginTop: 14 }}>
                  <span className="muted" style={{ fontSize: 13 }}>Set status:</span>
                  {STATUSES.map((st) => (
                    <Form method="post" key={st}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="status" value={st} />
                      <button
                        type="submit"
                        className={`btn ${s.status === st ? "" : "ghost"} sm`}
                        disabled={nav.state !== "idle"}
                        style={{ textTransform: "capitalize" }}
                      >
                        {st}
                      </button>
                    </Form>
                  ))}
                  <a className="btn ghost sm" href={`mailto:${s.contactEmail}?subject=Your%20SHOP%20SELECT%20NYC%20quote`}>
                    Email quote
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Shell>
  );
}
