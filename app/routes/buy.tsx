import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import { requireUser } from "~/lib/session.server";
import { Shell } from "~/components/Shell";
import { createPurchase } from "~/lib/purchase.server";
import { toCents } from "~/lib/money";

export const meta: MetaFunction = () => [{ title: "New Purchase · Buying Desk" }];

const CONDITIONS = ["New", "Like New", "Excellent", "Very Good", "Good", "Fair"];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return json({ user });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();

  const title = String(form.get("title") || "").trim();
  const brand = String(form.get("brand") || "").trim();
  const category = String(form.get("category") || "").trim();
  const condition = String(form.get("condition") || "").trim();
  const description = String(form.get("description") || "").trim();
  const quantity = Math.max(1, parseInt(String(form.get("quantity") || "1"), 10) || 1);
  const costCents = toCents(String(form.get("cost") || ""));
  const priceCents = toCents(String(form.get("price") || ""));
  const sellerName = String(form.get("sellerName") || "").trim();
  const sellerEmail = String(form.get("sellerEmail") || "").trim();
  const sellerId = String(form.get("sellerId") || "").trim();

  const errors: Record<string, string> = {};
  if (!title) errors.title = "Item name is required.";
  if (!condition) errors.condition = "Select a condition.";
  if (costCents <= 0) errors.cost = "Enter what you paid.";
  if (priceCents <= 0) errors.price = "Enter a resale price.";
  if (!sellerName) errors.sellerName = "Seller name is required.";
  if (!sellerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sellerEmail))
    errors.sellerEmail = "A valid seller email is required.";
  if (!sellerId) errors.sellerId = "Government ID number is required.";

  if (Object.keys(errors).length > 0) {
    return json({ errors, values: Object.fromEntries(form) }, { status: 400 });
  }

  const { purchase } = await createPurchase({
    title,
    brand,
    category,
    condition,
    description,
    quantity,
    costCents,
    priceCents,
    currency: "USD",
    sellerName,
    sellerEmail,
    sellerId,
    recordedBy: user.name,
  });

  return redirect(`/purchases/${purchase.id}?new=1`);
}

export default function Buy() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const errors = actionData?.errors || {};

  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");

  const calc = useMemo(() => {
    const c = parseFloat(cost) || 0;
    const p = parseFloat(price) || 0;
    const profit = p - c;
    const margin = p > 0 ? (profit / p) * 100 : 0;
    const markup = c > 0 ? (profit / c) * 100 : 0;
    const multiple = c > 0 ? p / c : 0;
    return { c, p, profit, margin, markup, multiple };
  }, [cost, price]);

  const applyMultiple = (m: number) => {
    const c = parseFloat(cost) || 0;
    if (c > 0) setPrice((c * m).toFixed(2));
  };
  const applyMargin = (marginTarget: number) => {
    const c = parseFloat(cost) || 0;
    if (c > 0) setPrice((c / (1 - marginTarget / 100)).toFixed(2));
  };

  return (
    <Shell user={user}>
      <div className="container narrow">
        <div className="page-head">
          <div>
            <h1>New Purchase</h1>
            <p className="muted" style={{ margin: 0 }}>
              Record what you bought, price it, and push a draft to Shopify.
            </p>
          </div>
        </div>

        <Form method="post">
          <div className="card">
            <h2>Item</h2>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="title">
                  Item name <span className="req">*</span>
                </label>
                <input id="title" name="title" placeholder="e.g. Louis Vuitton Neverfull MM" required />
                {errors.title ? <span className="hint" style={{ color: "var(--red)" }}>{errors.title}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="brand">Brand</label>
                <input id="brand" name="brand" placeholder="Louis Vuitton" />
              </div>
              <div className="field">
                <label htmlFor="category">Category</label>
                <input id="category" name="category" placeholder="Handbags" />
              </div>
              <div className="field">
                <label htmlFor="condition">
                  Condition <span className="req">*</span>
                </label>
                <select id="condition" name="condition" defaultValue="" required>
                  <option value="" disabled>
                    Select…
                  </option>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {errors.condition ? <span className="hint" style={{ color: "var(--red)" }}>{errors.condition}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="quantity">Quantity</label>
                <input id="quantity" name="quantity" type="number" min="1" defaultValue="1" />
              </div>
              <div className="field full">
                <label htmlFor="description">Notes / description (optional)</label>
                <textarea id="description" name="description" placeholder="Any details worth recording…" />
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Pricing</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="cost">
                  Cost — what you paid <span className="req">*</span>
                </label>
                <input
                  id="cost"
                  name="cost"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  required
                />
                {errors.cost ? <span className="hint" style={{ color: "var(--red)" }}>{errors.cost}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="price">
                  Resale price <span className="req">*</span>
                </label>
                <input
                  id="price"
                  name="price"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />
                {errors.price ? <span className="hint" style={{ color: "var(--red)" }}>{errors.price}</span> : null}
              </div>
            </div>

            <div className="section-label">Quick price</div>
            <div className="actions" style={{ marginBottom: 14 }}>
              <button type="button" className="btn ghost sm" onClick={() => applyMultiple(2)}>
                2× cost
              </button>
              <button type="button" className="btn ghost sm" onClick={() => applyMultiple(2.5)}>
                2.5× cost
              </button>
              <button type="button" className="btn ghost sm" onClick={() => applyMultiple(3)}>
                3× cost
              </button>
              <button type="button" className="btn ghost sm" onClick={() => applyMargin(50)}>
                50% margin
              </button>
              <button type="button" className="btn ghost sm" onClick={() => applyMargin(60)}>
                60% margin
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
                background: "var(--bg-2)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div>
                <div className="label" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                  Profit / unit
                </div>
                <div
                  className={calc.profit >= 0 ? "profit-pos" : "profit-neg"}
                  style={{ fontSize: 22, marginTop: 4 }}
                >
                  {calc.profit >= 0 ? "" : "−"}${Math.abs(calc.profit).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="label" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                  Margin
                </div>
                <div style={{ fontSize: 22, marginTop: 4, color: "var(--violet-2)", fontWeight: 700 }}>
                  {calc.margin.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="label" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                  Markup / multiple
                </div>
                <div style={{ fontSize: 22, marginTop: 4, fontWeight: 700 }}>
                  {calc.markup.toFixed(0)}%{" "}
                  <span className="muted" style={{ fontSize: 14 }}>
                    ({calc.multiple ? calc.multiple.toFixed(2) : "0.00"}×)
                  </span>
                </div>
              </div>
            </div>
          </div>

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
                <input id="sellerName" name="sellerName" placeholder="As shown on their ID" required />
                {errors.sellerName ? <span className="hint" style={{ color: "var(--red)" }}>{errors.sellerName}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="sellerEmail">
                  Email <span className="req">*</span>
                </label>
                <input id="sellerEmail" name="sellerEmail" type="email" placeholder="seller@email.com" required />
                {errors.sellerEmail ? <span className="hint" style={{ color: "var(--red)" }}>{errors.sellerEmail}</span> : null}
              </div>
              <div className="field full">
                <label htmlFor="sellerId">
                  Government ID number <span className="req">*</span>
                </label>
                <input id="sellerId" name="sellerId" placeholder="Driver's license / passport #" required autoComplete="off" />
                {errors.sellerId ? <span className="hint" style={{ color: "var(--red)" }}>{errors.sellerId}</span> : null}
              </div>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 20 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Recording…" : "Record purchase & push draft"}
            </button>
            <span className="hint">Creates a Shopify draft, adds a sheet row, and emails the receipt.</span>
          </div>
        </Form>
      </div>
    </Shell>
  );
}
