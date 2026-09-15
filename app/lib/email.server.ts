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
  condition: string;
  sku: string;
  quantity: number;
  amountPaidCents: number;
  currency: string;
  pdfBase64: string;
};

/** Send the buying receipt to the seller, cc the owner, with the PDF attached. */
export async function sendReceiptEmail(input: ReceiptEmailInput): Promise<void> {
  const itemName = input.brand ? `${input.brand} — ${input.title}` : input.title;
  const dateStr = input.date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#17171b">
    <div style="border-bottom:3px solid #a855f7;padding-bottom:14px;margin-bottom:20px">
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
      <tr><td style="padding:14px 0 0;color:#7a7a85;border-top:1px solid #eee">Amount paid</td><td style="padding:14px 0 0;text-align:right;font-weight:800;font-size:18px;color:#a855f7;border-top:1px solid #eee">${usd(
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
