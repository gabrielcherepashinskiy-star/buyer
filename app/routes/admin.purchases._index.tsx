import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { prisma } from "~/db.server";
import { requireUser } from "~/lib/session.server";
import { Shell } from "~/components/Shell";
import { formatUSD } from "~/lib/money";

export const meta: MetaFunction = () => [{ title: "Purchases · Buying Desk" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { brand: { contains: q, mode: "insensitive" as const } },
          { sku: { contains: q, mode: "insensitive" as const } },
          { sellerName: { contains: q, mode: "insensitive" as const } },
          { sellerEmail: { contains: q, mode: "insensitive" as const } },
          { receiptNumber: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const purchases = await prisma.purchase.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return json({
    user,
    q,
    purchases: purchases.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      title: p.title,
      brand: p.brand,
      sku: p.sku,
      condition: p.condition,
      costCents: p.costCents,
      priceCents: p.priceCents,
      sellerName: p.sellerName,
      recordedBy: p.recordedBy,
      shopifyStatus: p.shopifyStatus,
    })),
  });
}

export default function Purchases() {
  const { user, q, purchases } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const created = parseInt(params.get("created") || "", 10);
  const deleted = params.get("deleted") === "1";

  return (
    <Shell user={user}>
      <div className="container">
        {created > 0 ? (
          <div className="alert ok">
            Recorded {created} purchase{created === 1 ? "" : "s"}. Each item was pushed to Shopify as a
            draft and added to your sheet, and the seller's receipt was emailed. Check any row's status
            below.
          </div>
        ) : null}
        {deleted ? <div className="alert ok">Purchase deleted.</div> : null}
        <div className="page-head">
          <div>
            <h1>Purchases</h1>
            <p className="muted" style={{ margin: 0 }}>
              {purchases.length} {purchases.length === 1 ? "record" : "records"}
              {q ? ` matching “${q}”` : ""}
            </p>
          </div>
          <div className="actions">
            <a className="btn ghost" href={`/admin/purchases/export${q ? `?q=${encodeURIComponent(q)}` : ""}`}>
              Export CSV
            </a>
            <Link className="btn" to="/admin/buy">
              + New Purchase
            </Link>
          </div>
        </div>

        <Form method="get" className="search-bar">
          <input
            name="q"
            defaultValue={params.get("q") || ""}
            placeholder="Search item, brand, SKU, seller, receipt #…"
          />
          <button className="btn ghost" type="submit">
            Search
          </button>
          {q ? (
            <Link className="btn ghost" to="/admin/purchases">
              Clear
            </Link>
          ) : null}
        </Form>

        {purchases.length === 0 ? (
          <div className="card">
            <div className="empty">
              {q ? "No matches." : "No purchases yet."}{" "}
              <Link to="/admin/buy" style={{ color: "var(--violet-2)" }}>
                Record one →
              </Link>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>Cond.</th>
                  <th>Cost</th>
                  <th>Price</th>
                  <th>Profit</th>
                  <th>Seller</th>
                  <th>By</th>
                  <th>Shopify</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => {
                  const profit = p.priceCents - p.costCents;
                  return (
                    <tr
                      key={p.id}
                      className="row-link"
                      onClick={() => navigate(`/admin/purchases/${p.id}`)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {p.brand ? `${p.brand} — ` : ""}
                        {p.title}
                      </td>
                      <td className="mono muted">{p.sku}</td>
                      <td>{p.condition}</td>
                      <td>{formatUSD(p.costCents)}</td>
                      <td>{formatUSD(p.priceCents)}</td>
                      <td className={profit >= 0 ? "profit-pos" : "profit-neg"}>{formatUSD(profit)}</td>
                      <td>{p.sellerName}</td>
                      <td className="muted">{p.recordedBy || "—"}</td>
                      <td>
                        <StatusBadge status={p.shopifyStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { active: "active", pending: "pending", error: "error", skipped: "skipped" };
  const label: Record<string, string> = {
    active: "Draft",
    pending: "Pending",
    error: "Error",
    skipped: "—",
  };
  return <span className={`badge ${map[status] || "skipped"}`}>{label[status] || status}</span>;
}
