import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import { requireUser } from "~/lib/session.server";
import { Shell } from "~/components/Shell";
import { createBulkPurchase, type BulkRowInput } from "~/lib/purchase.server";
import { toCents } from "~/lib/money";

export const meta: MetaFunction = () => [{ title: "New Purchase · Buying Desk" }];

const CONDITIONS = ["New", "Like New", "Excellent", "Very Good", "Good", "Fair"];

type Row = {
  title: string;
  brand: string;
  category: string;
  size: string;
  condition: string;
  quantity: string;
  cost: string;
  price: string;
};

const emptyRow = (): Row => ({
  title: "",
  brand: "",
  category: "",
  size: "",
  condition: "",
  quantity: "1",
  cost: "",
  price: "",
});

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return json({ user });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();

  const sellerName = String(form.get("sellerName") || "").trim();
  const sellerEmail = String(form.get("sellerEmail") || "").trim();
  const sellerId = String(form.get("sellerId") || "").trim();

  let parsed: Row[] = [];
  try {
    parsed = JSON.parse(String(form.get("rowsJson") || "[]"));
  } catch {
    parsed = [];
  }

  // Keep only rows that have at least an item name.
  const filled = parsed.filter((r) => (r.title || "").trim());

  const errors: string[] = [];
  if (!sellerName) errors.push("Seller full name is required.");
  if (!sellerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sellerEmail))
    errors.push("A valid seller email is required.");
  if (!sellerId) errors.push("Seller government ID number is required.");
  if (filled.length === 0) errors.push("Add at least one item (with an item name).");

  const rows: BulkRowInput[] = [];
  filled.forEach((r, i) => {
    const costCents = toCents(r.cost);
    const priceCents = toCents(r.price);
    const n = i + 1;
    if (!r.condition) errors.push(`Row ${n}: choose a condition.`);
    if (costCents <= 0) errors.push(`Row ${n}: enter the cost.`);
    if (priceCents <= 0) errors.push(`Row ${n}: enter the resale price.`);
    rows.push({
      title: r.title.trim(),
      brand: (r.brand || "").trim(),
      category: (r.category || "").trim(),
      size: (r.size || "").trim(),
      condition: r.condition,
      quantity: Math.max(1, parseInt(r.quantity || "1", 10) || 1),
      costCents,
      priceCents,
    });
  });

  if (errors.length > 0) {
    return json({ errors, values: { sellerName, sellerEmail } }, { status: 400 });
  }

  const { purchases } = await createBulkPurchase({
    sellerName,
    sellerEmail,
    sellerId,
    currency: "USD",
    recordedBy: user.name,
    rows,
  });

  return redirect(`/purchases?created=${purchases.length}`);
}

export default function Buy() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const errors = actionData?.errors || [];

  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), emptyRow(), emptyRow(), emptyRow(), emptyRow()]);

  const update = (i: number, key: keyof Row, val: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  };
  const addRows = (n: number) => setRows((prev) => [...prev, ...Array.from({ length: n }, emptyRow)]);
  const removeRow = (i: number) => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  // Clone a row right below it — handy for the same product in multiple sizes.
  const duplicateRow = (i: number) =>
    setRows((prev) => {
      const copy = { ...prev[i], size: "" };
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });

  const applyMultiple = (i: number, m: number) => {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const c = parseFloat(r.cost) || 0;
        return c > 0 ? { ...r, price: (c * m).toFixed(2) } : r;
      })
    );
  };

  const totals = useMemo(() => {
    let cost = 0,
      price = 0,
      count = 0;
    for (const r of rows) {
      if (!(r.title || "").trim()) continue;
      count++;
      cost += (parseFloat(r.cost) || 0) * 100;
      price += (parseFloat(r.price) || 0) * 100;
    }
    return { cost, price, profit: price - cost, count };
  }, [rows]);

  const rowProfit = (r: Row) => {
    const c = parseFloat(r.cost) || 0;
    const p = parseFloat(r.price) || 0;
    return p - c;
  };

  const cell: React.CSSProperties = { padding: "4px 6px" };
  const inp: React.CSSProperties = { padding: "8px 9px", fontSize: 14, borderRadius: 8 };

  return (
    <Shell user={user}>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>New Purchase</h1>
            <p className="muted" style={{ margin: 0 }}>
              Enter the seller once, then line up every item they're selling. Each row becomes its own
              Shopify draft and sheet row; the seller gets one combined receipt.
            </p>
          </div>
        </div>

        {errors.length > 0 ? (
          <div className="alert err">
            <strong>Please fix:</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Form method="post">
          <input type="hidden" name="rowsJson" value={JSON.stringify(rows)} readOnly />

          <div className="card">
            <h2>Seller</h2>
            <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
              The ID number is encrypted before it's stored. Only the last 4 digits are ever shown.
            </p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="sellerName">
                  Full name <span className="req">*</span>
                </label>
                <input id="sellerName" name="sellerName" placeholder="As shown on their ID" defaultValue={actionData?.values?.sellerName || ""} required />
              </div>
              <div className="field">
                <label htmlFor="sellerEmail">
                  Email <span className="req">*</span>
                </label>
                <input id="sellerEmail" name="sellerEmail" type="email" placeholder="seller@email.com" defaultValue={actionData?.values?.sellerEmail || ""} required />
              </div>
              <div className="field full">
                <label htmlFor="sellerId">
                  Government ID number <span className="req">*</span>
                </label>
                <input id="sellerId" name="sellerId" placeholder="Driver's license / passport #" autoComplete="off" required />
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Items</h2>
              <div className="actions">
                <button type="button" className="btn ghost sm" onClick={() => addRows(1)}>
                  + Add row
                </button>
                <button type="button" className="btn ghost sm" onClick={() => addRows(5)}>
                  + Add 5
                </button>
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table className="bulk-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th style={{ minWidth: 190 }}>Item *</th>
                    <th style={{ minWidth: 120 }}>Brand</th>
                    <th style={{ minWidth: 110 }}>Category</th>
                    <th style={{ width: 80 }}>Size</th>
                    <th style={{ minWidth: 130 }}>Condition *</th>
                    <th style={{ width: 60 }}>Qty</th>
                    <th style={{ width: 96 }}>Cost *</th>
                    <th style={{ width: 96 }}>Price *</th>
                    <th style={{ width: 150 }}>Profit</th>
                    <th style={{ width: 64 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const profit = rowProfit(r);
                    const active = (r.title || "").trim().length > 0;
                    return (
                      <tr key={i}>
                        <td className="rownum muted" style={{ ...cell, textAlign: "center" }}>{i + 1}</td>
                        <td style={cell} data-label="Item">
                          <input style={inp} value={r.title} onChange={(e) => update(i, "title", e.target.value)} placeholder="e.g. LV Neverfull MM" />
                        </td>
                        <td style={cell} data-label="Brand">
                          <input style={inp} value={r.brand} onChange={(e) => update(i, "brand", e.target.value)} placeholder="Louis Vuitton" />
                        </td>
                        <td style={cell} data-label="Category">
                          <input style={inp} value={r.category} onChange={(e) => update(i, "category", e.target.value)} placeholder="Handbags" />
                        </td>
                        <td style={cell} data-label="Size">
                          <input style={{ ...inp, textAlign: "center" }} value={r.size} onChange={(e) => update(i, "size", e.target.value)} placeholder="—" />
                        </td>
                        <td style={cell} data-label="Condition">
                          <select style={inp} value={r.condition} onChange={(e) => update(i, "condition", e.target.value)}>
                            <option value="">—</option>
                            {CONDITIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={cell} data-label="Qty">
                          <input style={{ ...inp, textAlign: "center" }} type="number" min="1" value={r.quantity} onChange={(e) => update(i, "quantity", e.target.value)} />
                        </td>
                        <td style={cell} data-label="Cost">
                          <input style={{ ...inp, textAlign: "right" }} inputMode="decimal" value={r.cost} onChange={(e) => update(i, "cost", e.target.value)} placeholder="0.00" />
                        </td>
                        <td style={cell} data-label="Resale price">
                          <input style={{ ...inp, textAlign: "right" }} inputMode="decimal" value={r.price} onChange={(e) => update(i, "price", e.target.value)} placeholder="0.00" />
                        </td>
                        <td style={cell} data-label="Profit">
                          {active && (r.cost || r.price) ? (
                            <span className={profit >= 0 ? "profit-pos" : "profit-neg"} style={{ fontSize: 13 }}>
                              {profit >= 0 ? "" : "−"}${Math.abs(profit).toFixed(2)}
                            </span>
                          ) : (
                            <span className="muted" style={{ fontSize: 13 }}>—</span>
                          )}
                          {active ? (
                            <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                              <button type="button" className="btn ghost sm" style={{ padding: "2px 7px", fontSize: 11 }} onClick={() => applyMultiple(i, 2)}>
                                2×
                              </button>
                              <button type="button" className="btn ghost sm" style={{ padding: "2px 7px", fontSize: 11 }} onClick={() => applyMultiple(i, 2.5)}>
                                2.5×
                              </button>
                              <button type="button" className="btn ghost sm" style={{ padding: "2px 7px", fontSize: 11 }} onClick={() => applyMultiple(i, 3)}>
                                3×
                              </button>
                            </div>
                          ) : null}
                        </td>
                        <td className="rowremove" style={{ ...cell, textAlign: "center", whiteSpace: "nowrap" }}>
                          <button type="button" className="btn ghost sm" style={{ padding: "4px 8px" }} onClick={() => duplicateRow(i)} title="Duplicate row (same product, another size)">
                            ⧉
                          </button>
                          <button type="button" className="btn ghost sm" style={{ padding: "4px 8px", marginLeft: 4 }} onClick={() => removeRow(i)} title="Remove row">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat">
              <div className="label">Items</div>
              <div className="value">{totals.count}</div>
            </div>
            <div className="stat">
              <div className="label">Total Cost</div>
              <div className="value">${(totals.cost / 100).toFixed(2)}</div>
            </div>
            <div className="stat">
              <div className="label">Total Resale</div>
              <div className="value violet">${(totals.price / 100).toFixed(2)}</div>
            </div>
            <div className="stat">
              <div className="label">Total Profit</div>
              <div className="value green">${(totals.profit / 100).toFixed(2)}</div>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 4 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Recording…" : `Record ${totals.count || ""} purchase${totals.count === 1 ? "" : "s"} & push drafts`}
            </button>
            <span className="hint">Each item → a Shopify draft + a sheet row. One combined receipt to the seller.</span>
          </div>
        </Form>
      </div>
    </Shell>
  );
}
