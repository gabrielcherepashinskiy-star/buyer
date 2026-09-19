// Email receipts via the Resend HTTP API.

type Attachment = { filename: string; content: string }; // content = base64

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  attachments?: Attachment[];
  replyTo?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) throw new Error("Email is not configured (RESEND_API_KEY / RESEND_FROM).");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      reply_to: opts.replyTo,
      attachments: opts.attachments,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

function usd(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(
    cents / 100
  );
}

export type ReceiptEmailInput = {
  businessName: string;
  businessEmail: string;
  sellerName: string;
  sellerEmail: string;
  ownerEmail?: string | null;
  receiptNumber: string;
  date: Date;
  title: string;
  brand?: string | null;
  size?: string | null;
  condition: string;
  sku: string;
  quantity: number;
  amountPaidCents: number;
  currency: string;
  pdfBase64: string;
};

/** Send the buying receipt to the seller, cc the owner, with the PDF attached. */
export async function sendReceiptEmail(input: ReceiptEmailInput): Promise<void> {
  let itemName = input.brand ? `${input.brand} — ${input.title}` : input.title;
  if (input.size) itemName += ` (Size ${input.size})`;
  const dateStr = input.date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#17171b">
    <div style="border-bottom:3px solid #3b82f6;padding-bottom:14px;margin-bottom:20px">
      <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em">${escapeHtml(
        input.businessName
      )}</div>
      <div style="font-size:12px;color:#7a7a85;letter-spacing:0.08em;font-weight:600">PURCHASE RECEIPT</div>
    </div>
    <p style="font-size:15px">Hi ${escapeHtml(input.sellerName.split(" ")[0] || input.sellerName)},</p>
    <p style="font-size:15px;line-height:1.5">
      Thank you — this confirms that <strong>${escapeHtml(
        input.businessName
      )}</strong> has purchased the following from you.
      A PDF copy is attached for your records.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
      <tr><td style="padding:8px 0;color:#7a7a85">Receipt #</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(
        input.receiptNumber
      )}</td></tr>
      <tr><td style="padding:8px 0;color:#7a7a85">Date</td><td style="padding:8px 0;text-align:right">${dateStr}</td></tr>
      <tr><td style="padding:8px 0;color:#7a7a85">Item</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(
        itemName
      )}</td></tr>
      <tr><td style="padding:8px 0;color:#7a7a85">Condition</td><td style="padding:8px 0;text-align:right">${escapeHtml(
        input.condition
      )}</td></tr>
      ${
        input.quantity > 1
          ? `<tr><td style="padding:8px 0;color:#7a7a85">Quantity</td><td style="padding:8px 0;text-align:right">${input.quantity}</td></tr>`
          : ""
      }
      <tr><td style="padding:14px 0 0;color:#7a7a85;border-top:1px solid #eee">Amount paid</td><td style="padding:14px 0 0;text-align:right;font-weight:800;font-size:18px;color:#3b82f6;border-top:1px solid #eee">${usd(
        input.amountPaidCents,
        input.currency
      )}</td></tr>
    </table>
    <p style="font-size:13px;line-height:1.5;color:#7a7a85">
      By completing this sale you confirmed you are the lawful owner of the item(s) with the right to
      sell, and that the sale is final. Questions? Just reply to this email.
    </p>
    <p style="font-size:13px;color:#7a7a85;margin-top:22px">— ${escapeHtml(input.businessName)}</p>
  </div>`;

  const to = [input.sellerEmail];
  if (input.ownerEmail && input.ownerEmail !== input.sellerEmail) to.push(input.ownerEmail);

  await sendEmail({
    to,
    subject: `Your ${input.businessName} purchase receipt — ${input.receiptNumber}`,
    html,
    replyTo: input.businessEmail || input.ownerEmail || undefined,
    attachments: [{ filename: `receipt-${input.receiptNumber}.pdf`, content: input.pdfBase64 }],
  });
}

export type BatchReceiptEmailInput = {
  businessName: string;
  businessEmail: string;
  sellerName: string;
  sellerEmail: string;
  ownerEmail?: string | null;
  receiptNumber: string;
  date: Date;
  items: Array<{
    title: string;
    brand?: string | null;
    size?: string | null;
    condition: string;
    amountPaidCents: number;
    quantity: number;
  }>;
  currency: string;
  pdfBase64: string;
};

/** Send one combined receipt for a multi-item purchase to the seller (cc owner). */
export async function sendBatchReceiptEmail(input: BatchReceiptEmailInput): Promise<void> {
  const dateStr = input.date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const total = input.items.reduce((s, it) => s + it.amountPaidCents, 0);

  const rows = input.items
    .map((it) => {
      let name = it.brand ? `${it.brand} — ${it.title}` : it.title;
      if (it.size) name += ` (Size ${it.size})`;
      return `<tr>
        <td style="padding:8px 0;border-top:1px solid #eee">${escapeHtml(name)}<br><span style="color:#7a7a85;font-size:12px">${escapeHtml(
        it.condition
      )}${it.quantity > 1 ? ` · qty ${it.quantity}` : ""}</span></td>
        <td style="padding:8px 0;border-top:1px solid #eee;text-align:right;font-weight:700;white-space:nowrap">${usd(
          it.amountPaidCents,
          input.currency
        )}</td>
      </tr>`;
    })
    .join("");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#17171b">
    <div style="border-bottom:3px solid #3b82f6;padding-bottom:14px;margin-bottom:20px">
      <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em">${escapeHtml(input.businessName)}</div>
      <div style="font-size:12px;color:#7a7a85;letter-spacing:0.08em;font-weight:600">PURCHASE RECEIPT</div>
    </div>
    <p style="font-size:15px">Hi ${escapeHtml(input.sellerName.split(" ")[0] || input.sellerName)},</p>
    <p style="font-size:15px;line-height:1.5">
      Thank you — this confirms that <strong>${escapeHtml(
        input.businessName
      )}</strong> purchased the following ${input.items.length} item(s) from you. A PDF copy is attached.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:8px 0 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#7a7a85">Receipt #</td><td style="padding:6px 0;text-align:right;font-weight:700">${escapeHtml(
        input.receiptNumber
      )}</td></tr>
      <tr><td style="padding:6px 0;color:#7a7a85">Date</td><td style="padding:6px 0;text-align:right">${dateStr}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:14px">
      ${rows}
      <tr><td style="padding:14px 0 0;border-top:2px solid #17171b;font-weight:800">Total paid</td>
      <td style="padding:14px 0 0;border-top:2px solid #17171b;text-align:right;font-weight:800;font-size:18px;color:#3b82f6">${usd(
        total,
        input.currency
      )}</td></tr>
    </table>
    <p style="font-size:13px;line-height:1.5;color:#7a7a85">
      By completing this sale you confirmed you are the lawful owner of the item(s) with the right to
      sell, and that the sale is final. Questions? Just reply to this email.
    </p>
    <p style="font-size:13px;color:#7a7a85;margin-top:22px">— ${escapeHtml(input.businessName)}</p>
  </div>`;

  const to = [input.sellerEmail];
  if (input.ownerEmail && input.ownerEmail !== input.sellerEmail) to.push(input.ownerEmail);

  await sendEmail({
    to,
    subject: `Your ${input.businessName} purchase receipt — ${input.receiptNumber}`,
    html,
    replyTo: input.businessEmail || input.ownerEmail || undefined,
    attachments: [{ filename: `receipt-${input.receiptNumber}.pdf`, content: input.pdfBase64 }],
  });
}

export type SellerSubmissionEmailInput = {
  ownerEmail: string;
  businessName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  method: "instore" | "ship";
  note?: string | null;
  items: Array<{ name: string; desiredPriceCents: number; quantity: number; notes?: string | null }>;
  photos?: string[]; // JPEG data URLs
};

// Turn ["data:image/jpeg;base64,XXXX", …] into Resend attachments.
function photoAttachments(photos?: string[]): Attachment[] {
  if (!photos || photos.length === 0) return [];
  const out: Attachment[] = [];
  photos.slice(0, 8).forEach((p, i) => {
    const comma = p.indexOf(",");
    const content = comma >= 0 ? p.slice(comma + 1) : p;
    if (content) out.push({ filename: `photo-${i + 1}.jpg`, content });
  });
  return out;
}

/** Notify the owner that a seller submitted items for a quote. */
export async function sendSellerSubmissionEmail(input: SellerSubmissionEmailInput): Promise<void> {
  if (!input.ownerEmail) throw new Error("No owner email configured");
  const methodLabel = input.method === "ship" ? "Ship to us (Payment Upon Arrival)" : "In-store drop-off";
  const total = input.items.reduce((s, it) => s + it.desiredPriceCents * (it.quantity || 1), 0);

  const rows = input.items
    .map(
      (it) => `<tr>
        <td style="padding:7px 0;border-top:1px solid #eee">${escapeHtml(it.name)}${
        it.quantity > 1 ? ` <span style="color:#7a7a85">×${it.quantity}</span>` : ""
      }${it.notes ? `<br><span style="color:#7a7a85;font-size:12px">${escapeHtml(it.notes)}</span>` : ""}</td>
        <td style="padding:7px 0;border-top:1px solid #eee;text-align:right;white-space:nowrap">${usd(
          it.desiredPriceCents,
          "USD"
        )}</td>
      </tr>`
    )
    .join("");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#17171b">
    <div style="border-bottom:3px solid #3b82f6;padding-bottom:12px;margin-bottom:18px">
      <div style="font-size:16px;font-weight:800">${escapeHtml(input.businessName)}</div>
      <div style="font-size:12px;color:#7a7a85;letter-spacing:0.08em;font-weight:600">NEW SELL REQUEST</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px">
      <tr><td style="padding:4px 0;color:#7a7a85;width:120px">Seller</td><td style="padding:4px 0;font-weight:700">${escapeHtml(
        input.contactName
      )}</td></tr>
      <tr><td style="padding:4px 0;color:#7a7a85">Phone</td><td style="padding:4px 0">${escapeHtml(
        input.contactPhone
      )}</td></tr>
      <tr><td style="padding:4px 0;color:#7a7a85">Email</td><td style="padding:4px 0">${escapeHtml(
        input.contactEmail
      )}</td></tr>
      <tr><td style="padding:4px 0;color:#7a7a85">Method</td><td style="padding:4px 0;font-weight:700">${escapeHtml(
        methodLabel
      )}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="text-align:left;padding-bottom:6px;color:#7a7a85;font-size:12px">ITEM</th><th style="text-align:right;padding-bottom:6px;color:#7a7a85;font-size:12px">ASKING</th></tr>
      ${rows}
      <tr><td style="padding-top:12px;border-top:2px solid #17171b;font-weight:800">Total asking</td>
      <td style="padding-top:12px;border-top:2px solid #17171b;text-align:right;font-weight:800;color:#3b82f6">${usd(
        total,
        "USD"
      )}</td></tr>
    </table>
    ${input.note ? `<p style="font-size:13px;color:#7a7a85;margin-top:14px">Note: ${escapeHtml(input.note)}</p>` : ""}
    <p style="font-size:13px;color:#7a7a85;margin-top:18px">Review and send a quote from your admin → Submissions.</p>
  </div>`;

  await sendEmail({
    to: [input.ownerEmail],
    subject: `New sell request — ${input.contactName} (${input.items.length} item${
      input.items.length === 1 ? "" : "s"
    })`,
    html,
    replyTo: input.contactEmail,
    attachments: photoAttachments(input.photos),
  });
}

export type SellerConfirmationEmailInput = {
  businessName: string;
  businessEmail: string;
  contactName: string;
  contactEmail: string;
  method: "instore" | "ship";
  items: Array<{ name: string; desiredPriceCents: number; quantity: number; notes?: string | null }>;
};

/** Confirmation receipt to the SELLER of everything they submitted, with pricing. */
export async function sendSellerConfirmationEmail(input: SellerConfirmationEmailInput): Promise<void> {
  const methodLabel = input.method === "ship" ? "Ship to us (Payment Upon Arrival)" : "In-store drop-off";
  const total = input.items.reduce((s, it) => s + it.desiredPriceCents * (it.quantity || 1), 0);

  const rows = input.items
    .map(
      (it) => `<tr>
        <td style="padding:8px 0;border-top:1px solid #eee">${escapeHtml(it.name)}${
        it.quantity > 1 ? ` <span style="color:#7a7a85">×${it.quantity}</span>` : ""
      }${it.notes ? `<br><span style="color:#7a7a85;font-size:12px">${escapeHtml(it.notes)}</span>` : ""}</td>
        <td style="padding:8px 0;border-top:1px solid #eee;text-align:right;white-space:nowrap;font-weight:700">${usd(
          it.desiredPriceCents,
          "USD"
        )}</td>
      </tr>`
    )
    .join("");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#17171b">
    <div style="border-bottom:3px solid #3b82f6;padding-bottom:12px;margin-bottom:18px">
      <div style="font-size:16px;font-weight:800">${escapeHtml(input.businessName)}</div>
      <div style="font-size:12px;color:#7a7a85;letter-spacing:0.08em;font-weight:600">SUBMISSION RECEIVED</div>
    </div>
    <p style="font-size:15px">Hi ${escapeHtml(input.contactName.split(" ")[0] || input.contactName)},</p>
    <p style="font-size:15px;line-height:1.5">
      Thanks for submitting your items to <strong>${escapeHtml(
        input.businessName
      )}</strong>. Here's a copy of what you sent. A sales associate will review it and follow up with a quote.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:10px 0">
      <tr><th style="text-align:left;padding-bottom:6px;color:#7a7a85;font-size:12px">ITEM</th><th style="text-align:right;padding-bottom:6px;color:#7a7a85;font-size:12px">YOUR ASKING PRICE</th></tr>
      ${rows}
      <tr><td style="padding-top:12px;border-top:2px solid #17171b;font-weight:800">Total</td>
      <td style="padding-top:12px;border-top:2px solid #17171b;text-align:right;font-weight:800;color:#3b82f6">${usd(
        total,
        "USD"
      )}</td></tr>
    </table>
    <p style="font-size:14px;margin:6px 0"><strong>How you're selling:</strong> ${escapeHtml(methodLabel)}</p>
    <div style="margin-top:16px;padding:12px 14px;border:1px dashed #ddd;border-radius:8px;font-size:12px;color:#7a7a85;line-height:1.5">
      Submitting your items does not guarantee that a deal has been agreed to, and your desired prices
      are not guaranteed. A sales associate will review your submission and get back to you with a quote.
    </div>
    <p style="font-size:13px;color:#7a7a85;margin-top:18px">— ${escapeHtml(input.businessName)}</p>
  </div>`;

  await sendEmail({
    to: [input.contactEmail],
    subject: `We received your items — ${input.businessName}`,
    html,
    replyTo: input.businessEmail || undefined,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
