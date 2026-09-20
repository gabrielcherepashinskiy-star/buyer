import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { requireUser } from "~/lib/session.server";
import { Shell } from "~/components/Shell";
import { formatUSD, toCents } from "~/lib/money";
import {
  clearClosedSubmissions,
  deleteSubmission,
  listSubmissions,
  openSubmissionCount,
  sendQuote,
  setSubmissionStatus,
} from "~/lib/submission.server";

const VIEWS: Record<string, string[] | undefined> = {
  open: ["new", "reviewed", "quoted"],
  closed: ["accepted", "closed"],
  all: undefined,
};

export const meta: MetaFunction = () => [{ title: "Submissions · Buying Desk" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const view = ["open", "closed", "all"].includes(url.searchParams.get("view") || "")
    ? (url.searchParams.get("view") as "open" | "closed" | "all")
    : "open";

  let submissions: Awaited<ReturnType<typeof listSubmissions>> = [];
  let openCount = 0;
  try {
    submissions = await listSubmissions(VIEWS[view]);
    openCount = await openSubmissionCount();
  } catch (e) {
    console.error("Could not load submissions (redeploy to migrate?):", e);
  }
  return json({
    user,
    view,
    openCount,
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
        condition: it.condition,
        size: it.size,
        desiredPriceCents: it.desiredPriceCents,
        quantity: it.quantity,
        notes: it.notes,
      })),
      photos: s.photos.map((p) => ({ id: p.id, dataUrl: p.dataUrl })),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");

  if (intent === "quote") {
    const quoteCents = toCents(String(form.get("quoteAmount") || ""));
    const message = String(form.get("quoteMessage") || "").trim();
    const result = await sendQuote(id, quoteCents, message || undefined);
    return json({ result });
  }

  if (intent === "delete") {
    if (id) await deleteSubmission(id);
    return json({ result: { ok: true, message: "Submission deleted." } });
  }

  if (intent === "clearClosed") {
    const n = await clearClosedSubmissions();
    return json({ result: { ok: true, message: `Cleared ${n} closed submission${n === 1 ? "" : "s"}.` } });
  }

  const status = String(form.get("status") || "");
  if (id && status) await setSubmissionStatus(id, status);
  return json({ result: { ok: true, message: "" } });
}

const STATUSES = ["new", "reviewed", "quoted", "accepted", "closed"];
const STATUS_CLASS: Record<string, string> = {
  new: "pending",
  reviewed: "active",
  quoted: "active",
  accepted: "active",
  closed: "skipped",
};

export default function Submissions() {
  const { user, submissions, view, openCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const tab = (key: string, label: string) => (
    <Link
      to={`/admin/submissions?view=${key}`}
      className={`btn ${view === key ? "" : "ghost"} sm`}
    >
      {label}
    </Link>
  );

  return (
    <Shell user={user}>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Submissions</h1>
            <p className="muted" style={{ margin: 0 }}>
              {openCount} open · showing {view === "open" ? "open" : view === "closed" ? "closed" : "all"}
            </p>
          </div>
          <div className="actions">
            {tab("open", "Open")}
            {tab("closed", "Closed")}
            {tab("all", "All")}
            {view !== "open" ? (
              <Form method="post" onSubmit={(e) => { if (!confirm("Permanently delete ALL closed/accepted submissions?")) e.preventDefault(); }}>
                <input type="hidden" name="intent" value="clearClosed" />
                <button type="submit" className="btn danger sm" disabled={nav.state !== "idle"}>
                  Clear closed
                </button>
              </Form>
            ) : null}
          </div>
        </div>

        {actionData?.result?.message ? (
          <div className={`alert ${actionData.result.ok ? "ok" : "err"}`}>{actionData.result.message}</div>
        ) : null}

        {submissions.length === 0 ? (
          <div className="card">
            <div className="empty">
              {view === "open" ? "No open submissions right now." : "Nothing here."}
            </div>
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
                        <th>Condition</th>
                        <th>Size</th>
                        <th>Notes</th>
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
                          <td>{it.condition || "—"}</td>
                          <td>{it.size || "—"}</td>
                          <td className="muted">{it.notes || "—"}</td>
                          <td style={{ textAlign: "right" }}>{formatUSD(it.desiredPriceCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {s.photos.length > 0 ? (
                  <div className="photos" style={{ marginTop: 12 }}>
                    {s.photos.map((ph) => (
                      <a key={ph.id} href={ph.dataUrl} target="_blank" rel="noreferrer">
                        <img src={ph.dataUrl} alt="Submitted item" />
                      </a>
                    ))}
                  </div>
                ) : null}

                {s.note ? (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    <strong>Note:</strong> {s.note}
                  </p>
                ) : null}

                {/* Send a quote / counteroffer by email */}
                <div
                  style={{
                    marginTop: 16,
                    padding: 14,
                    background: "var(--bg-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                  }}
                >
                  <div className="section-label" style={{ marginTop: 0 }}>Send a quote / counteroffer</div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="quote" />
                    <input type="hidden" name="id" value={s.id} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div className="field" style={{ width: 160 }}>
                        <label>Your offer ($)</label>
                        <input name="quoteAmount" inputMode="decimal" placeholder="0.00" required />
                      </div>
                      <div className="field" style={{ flex: 1, minWidth: 220 }}>
                        <label>Message (optional)</label>
                        <input name="quoteMessage" placeholder="Add a note to the seller…" />
                      </div>
                      <button type="submit" className="btn" disabled={nav.state !== "idle"}>
                        {nav.state !== "idle" ? "Sending…" : "Send quote"}
                      </button>
                    </div>
                    <p className="hint" style={{ marginTop: 8 }}>
                      Emails the seller your offer and marks this submission “quoted.”
                    </p>
                  </Form>
                </div>

                <div className="actions" style={{ marginTop: 14, marginBottom: 12 }}>
                  <a className="btn" href={`/admin/buy?from=${s.id}`}>
                    Accept → add to purchases
                  </a>
                </div>

                <div className="actions">
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
                  <div style={{ flex: 1 }} />
                  {confirmId === s.id ? (
                    <>
                      <span style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }}>Delete?</span>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="btn danger sm" disabled={nav.state !== "idle"}>
                          Yes, delete
                        </button>
                      </Form>
                      <button type="button" className="btn ghost sm" onClick={() => setConfirmId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn danger sm" onClick={() => setConfirmId(s.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Shell>
  );
}
