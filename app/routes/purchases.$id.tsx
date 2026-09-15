import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { prisma } from "~/db.server";
import { requireUser } from "~/lib/session.server";
import { Shell } from "~/components/Shell";
import { formatUSD, marginPct, markupPct } from "~/lib/money";
import { repushShopify, resendReceipt, resyncSheet } from "~/lib/purchase.server";
import { shopifyAdminBase } from "~/lib/shopify.server";

export const meta: MetaFunction = () => [{ title: "Purchase · Buying Desk" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const p = await prisma.purchase.findUnique({ where: { id: params.id } });
  if (!p) throw new Response("Purchase not found", { status: 404 });

  const numericProductId = p.shopifyProductId ? p.shopifyProductId.split("/").pop() : null;
  return json({
    user,
    p: {
      ...p,
      createdAt: p.createdAt.toISOString(),
      shopifySyncedAt: p.shopifySyncedAt?.toISOString() || null,
      sheetSyncedAt: p.sheetSyncedAt?.toISOString() || null,
      receiptSentAt: p.receiptSentAt?.toISOString() || null,
      updatedAt: p.updatedAt.toISOString(),
    },
    shopifyProductUrl: numericProductId ? `${shopifyAdminBase()}/admin/products/${numericProductId}` : null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireUser(request);
  const id = params.id!;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  let result: { ok: boolean; message: string };
  if (intent === "repush") result = await repushShopify(id);
  else if (intent === "resend") result = await resendReceipt(id);
  else if (intent === "resync") result = await resyncSheet(id);
  else result = { ok: false, message: "Unknown action" };

  return json({ intent, ...result });
}

export default function PurchaseDetail() {
  const { user, p, shopifyProductUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const isNew = params.get("new") === "1";
  const submittingIntent =
    nav.state === "submitting" ? String(nav.formData?.get("intent") || "") : "";

  const profit = p.priceCents - p.costCents;

  return (
    <Shell user={user}>
      <div className="container narrow">
        <div className="page-head">
          <div>
            <Link to="/purchases" className="muted" style={{ fontSize: 14 }}>
              ← All purchases
            </Link>
            <h1 style={{ marginTop: 8 }}>
              {p.brand ? `${p.brand} — ` : ""}
              {p.title}
            </h1>
            <p className="muted mono" style={{ margin: 0 }}>
              {p.sku} · {p.receiptNumber}
            </p>
          </div>
          <a className="btn ghost" href={`/purchases/${p.id}/receipt`} target="_blank" rel="noreferrer">
            Download receipt PDF
          </a>
        </div>

        {isNew ? (
          <div className="alert ok">
            Purchase recorded. See the sync status below — anything that didn't go through can be
            retried with one click.
          </div>
        ) : null}

        {actionData ? (
          <div className={`alert ${actionData.ok ? "ok" : "err"}`}>{actionData.message}</div>
        ) : null}

        <div className="card">
          <h2>Item & pricing</h2>
          <dl className="kv">
            <dt>Condition</dt>
            <dd>{p.condition}</dd>
            {p.category ? (
              <>
                <dt>Category</dt>
                <dd>{p.category}</dd>
              </>
            ) : null}
            <dt>Quantity</dt>
            <dd>{p.quantity}</dd>
            <dt>Cost paid</dt>
            <dd>{formatUSD(p.costCents)}</dd>
            <dt>Resale price</dt>
            <dd style={{ color: "var(--violet-2)", fontWeight: 700 }}>{formatUSD(p.priceCents)}</dd>
            <dt>Profit</dt>
            <dd className={profit >= 0 ? "profit-pos" : "profit-neg"}>
              {formatUSD(profit)}{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                ({marginPct(p.costCents, p.priceCents).toFixed(1)}% margin ·{" "}
                {markupPct(p.costCents, p.priceCents).toFixed(0)}% markup)
              </span>
            </dd>
            {p.description ? (
              <>
                <dt>Notes</dt>
                <dd>{p.description}</dd>
              </>
            ) : null}
            <dt>Recorded by</dt>
            <dd>
              {p.recordedBy || "—"} ·{" "}
              {new Date(p.createdAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
          </dl>
        </div>

        <div className="card">
          <h2>Seller</h2>
          <dl className="kv">
            <dt>Name</dt>
            <dd>{p.sellerName}</dd>
            <dt>Email</dt>
            <dd>{p.sellerEmail}</dd>
            <dt>Government ID</dt>
            <dd>
              {p.sellerIdLast4 ? (
                <span className="mono">•••• {p.sellerIdLast4}</span>
              ) : (
                <span className="muted">Not recorded</span>
              )}{" "}
              <span className="muted" style={{ fontSize: 12 }}>
                (encrypted at rest)
              </span>
            </dd>
          </dl>
        </div>

        <div className="card">
          <h2>Sync status</h2>

          <SyncRow
            title="Shopify draft"
            ok={p.shopifyStatus === "active"}
            status={p.shopifyStatus}
            when={p.shopifySyncedAt}
            error={p.shopifyError}
            extra={
              shopifyProductUrl ? (
                <a className="btn ghost sm" href={shopifyProductUrl} target="_blank" rel="noreferrer">
                  Open in Shopify
                </a>
              ) : null
            }
            action={
              <Form method="post">
                <button
                  className="btn ghost sm"
                  name="intent"
                  value="repush"
                  disabled={submittingIntent === "repush"}
                >
                  {submittingIntent === "repush" ? "Pushing…" : p.shopifyStatus === "active" ? "Re-push" : "Push now"}
                </button>
              </Form>
            }
          />

          <SyncRow
            title="Master sheet"
            ok={Boolean(p.sheetSyncedAt) && !p.sheetError}
            status={p.sheetSyncedAt && !p.sheetError ? "synced" : "not synced"}
            when={p.sheetSyncedAt}
            error={p.sheetError}
            action={
              <Form method="post">
                <button
                  className="btn ghost sm"
                  name="intent"
                  value="resync"
                  disabled={submittingIntent === "resync"}
                >
                  {submittingIntent === "resync" ? "Syncing…" : p.sheetSyncedAt ? "Re-sync" : "Sync now"}
                </button>
              </Form>
            }
          />

          <SyncRow
            title="Receipt email"
            ok={Boolean(p.receiptSentAt) && !p.receiptError}
            status={p.receiptSentAt && !p.receiptError ? `sent to ${p.sellerEmail}` : "not sent"}
            when={p.receiptSentAt}
            error={p.receiptError}
            action={
              <Form method="post">
                <button
                  className="btn ghost sm"
                  name="intent"
                  value="resend"
                  disabled={submittingIntent === "resend"}
                >
                  {submittingIntent === "resend" ? "Sending…" : p.receiptSentAt ? "Resend" : "Send now"}
                </button>
              </Form>
            }
          />
        </div>
      </div>
    </Shell>
  );
}

function SyncRow({
  title,
  ok,
  status,
  when,
  error,
  action,
  extra,
}: {
  title: string;
  ok: boolean;
  status: string;
  when: string | null;
  error: string | null;
  action: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 0",
        borderTop: "1px solid var(--line)",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          {title}
          <span className={`badge ${ok ? "active" : error ? "error" : "skipped"}`}>
            {ok ? "OK" : error ? "Failed" : status}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
          {when ? new Date(when).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : status}
        </div>
        {error ? (
          <div className="hint" style={{ color: "var(--red)", marginTop: 4, maxWidth: 460 }}>
            {error}
          </div>
        ) : null}
      </div>
      <div className="actions">
        {extra}
        {action}
      </div>
    </div>
  );
}
