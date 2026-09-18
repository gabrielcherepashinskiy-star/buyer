import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { prisma } from "~/db.server";
import { requireUser } from "~/lib/session.server";
import { Shell } from "~/components/Shell";
import { formatUSD } from "~/lib/money";
import { shopifyConfigured } from "~/lib/shopify.server";
import { sheetsConfigured } from "~/lib/sheets.server";
import { emailConfigured } from "~/lib/email.server";

export const meta: MetaFunction = () => [{ title: "Dashboard · Buying Desk" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [agg, monthAgg, recent, count, newSubs] = await Promise.all([
    prisma.purchase.aggregate({ _sum: { costCents: true, priceCents: true } }),
    prisma.purchase.aggregate({
      _sum: { costCents: true },
      _count: true,
      where: { createdAt: { gte: monthStart } },
    }),
    prisma.purchase.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.purchase.count(),
    prisma.submission.count({ where: { status: "new" } }),
  ]);

  const totalCost = agg._sum.costCents || 0;
  const totalValue = agg._sum.priceCents || 0;

  return json({
    user,
    stats: {
      count,
      totalCost,
      totalValue,
      potentialProfit: totalValue - totalCost,
      monthCount: monthAgg._count || 0,
      monthSpend: monthAgg._sum.costCents || 0,
      newSubmissions: newSubs,
    },
    recent: recent.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      title: p.title,
      brand: p.brand,
      sku: p.sku,
      costCents: p.costCents,
      priceCents: p.priceCents,
      shopifyStatus: p.shopifyStatus,
    })),
    config: {
      shopify: shopifyConfigured(),
      sheets: sheetsConfigured(),
      email: emailConfigured(),
    },
  });
}

export default function Dashboard() {
  const { user, stats, recent, config } = useLoaderData<typeof loader>();
  const notConfigured = !config.shopify || !config.sheets || !config.email;

  return (
    <Shell user={user}>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Dashboard</h1>
            <p className="muted" style={{ margin: 0 }}>
              Welcome back, {user.name}.
            </p>
          </div>
          <Link className="btn" to="/admin/buy">
            + New Purchase
          </Link>
        </div>

        {stats.newSubmissions > 0 ? (
          <div className="alert ok">
            You have {stats.newSubmissions} new seller submission{stats.newSubmissions === 1 ? "" : "s"} waiting.{" "}
            <Link to="/admin/submissions" style={{ color: "var(--violet-2)", fontWeight: 700 }}>
              Review them →
            </Link>
          </div>
        ) : null}

        {notConfigured ? (
          <div className="alert warn">
            Setup incomplete —{" "}
            {[
              !config.shopify && "Shopify",
              !config.sheets && "Google Sheets",
              !config.email && "Email receipts",
            ]
              .filter(Boolean)
              .join(", ")}{" "}
            not connected yet. Purchases still save here; connect the rest in your environment
            variables to enable auto-sync.
          </div>
        ) : null}

        <div className="stats">
          <div className="stat">
            <div className="label">Total Purchases</div>
            <div className="value">{stats.count}</div>
          </div>
          <div className="stat">
            <div className="label">Total Spent</div>
            <div className="value">{formatUSD(stats.totalCost)}</div>
          </div>
          <div className="stat">
            <div className="label">Resale Value</div>
            <div className="value violet">{formatUSD(stats.totalValue)}</div>
          </div>
          <div className="stat">
            <div className="label">Potential Profit</div>
            <div className="value green">{formatUSD(stats.potentialProfit)}</div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Recent purchases</h2>
            <Link className="muted" to="/admin/purchases" style={{ fontSize: 14 }}>
              View all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="empty">
              No purchases yet. <Link to="/admin/buy" style={{ color: "var(--violet-2)" }}>Record your first one →</Link>
            </div>
          ) : (
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Cost</th>
                    <th>Price</th>
                    <th>Shopify</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id} className="row-link">
                      <td>
                        <Link to={`/admin/purchases/${p.id}`}>
                          {new Date(p.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </Link>
                      </td>
                      <td>
                        <Link to={`/admin/purchases/${p.id}`}>
                          {p.brand ? `${p.brand} — ` : ""}
                          {p.title}
                        </Link>
                      </td>
                      <td className="mono muted">{p.sku}</td>
                      <td>{formatUSD(p.costCents)}</td>
                      <td>{formatUSD(p.priceCents)}</td>
                      <td>
                        <StatusBadge status={p.shopifyStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "active",
    pending: "pending",
    error: "error",
    skipped: "skipped",
  };
  const label: Record<string, string> = {
    active: "Draft synced",
    pending: "Pending",
    error: "Error",
    skipped: "Not synced",
  };
  return <span className={`badge ${map[status] || "skipped"}`}>{label[status] || status}</span>;
}
