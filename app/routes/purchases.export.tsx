import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { requireUser } from "~/lib/session.server";
import { marginPct } from "~/lib/money";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { brand: { contains: q, mode: "insensitive" as const } },
          { sku: { contains: q, mode: "insensitive" as const } },
          { sellerName: { contains: q, mode: "insensitive" as const } },
          { receiptNumber: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const rows = await prisma.purchase.findMany({ where, orderBy: { createdAt: "desc" } });

  const header = [
    "Date",
    "Receipt #",
    "SKU",
    "Item",
    "Brand",
    "Category",
    "Condition",
    "Qty",
    "Cost",
    "Price",
    "Profit",
    "Margin %",
    "Seller Name",
    "Seller Email",
    "Seller ID (last4)",
    "Recorded By",
    "Shopify Status",
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const p of rows) {
    const profit = p.priceCents - p.costCents;
    lines.push(
      [
        p.createdAt.toISOString().slice(0, 10),
        p.receiptNumber,
        p.sku,
        p.title,
        p.brand || "",
        p.category || "",
        p.condition,
        p.quantity,
        (p.costCents / 100).toFixed(2),
        (p.priceCents / 100).toFixed(2),
        (profit / 100).toFixed(2),
        marginPct(p.costCents, p.priceCents).toFixed(1),
        p.sellerName,
        p.sellerEmail,
        p.sellerIdLast4 || "",
        p.recordedBy || "",
        p.shopifyStatus,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="purchases-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
