import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// A "buying receipt": confirmation of what we purchased from a seller and the
// amount paid to them. It intentionally does NOT show the resale price.

export type ReceiptData = {
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  receiptNumber: string;
  date: Date;
  sellerName: string;
  sellerEmail: string;
  sellerIdLast4?: string | null;
  title: string;
  brand?: string | null;
  condition: string;
  sku: string;
  quantity: number;
  amountPaidCents: number;
  currency: string;
};

const VIOLET = rgb(0.66, 0.33, 0.97);
const DARK = rgb(0.09, 0.09, 0.1);
const GRAY = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.85, 0.85, 0.88);

function usd(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(
    cents / 100
  );
}

export async function renderReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  let y = height - margin;

  const text = (
    s: string,
    x: number,
    yy: number,
    opts: { size?: number; font?: typeof font; color?: typeof DARK } = {}
  ) => {
    page.drawText(sanitize(s), {
      x,
      y: yy,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? DARK,
    });
  };

  // Header
  page.drawRectangle({ x: margin, y: y - 6, width: 10, height: 10, color: VIOLET });
  text(data.businessName.toUpperCase(), margin + 18, y - 4, { size: 15, font: bold });
  text("PURCHASE RECEIPT", width - margin - 130, y - 4, { size: 12, font: bold, color: VIOLET });
  y -= 26;
  text(data.businessAddress, margin + 18, y, { size: 9, color: GRAY });
  text(data.businessEmail, margin + 18, y - 12, { size: 9, color: GRAY });
  y -= 34;

  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: LINE,
  });
  y -= 24;

  // Receipt meta (right) + seller (left)
  const metaX = width - margin - 200;
  text("Receipt #", metaX, y, { size: 9, color: GRAY });
  text(data.receiptNumber, metaX + 70, y, { size: 9, font: bold });
  text("Date", metaX, y - 14, { size: 9, color: GRAY });
  text(
    data.date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
    metaX + 70,
    y - 14,
    { size: 9, font: bold }
  );

  text("SELLER", margin, y, { size: 9, font: bold, color: VIOLET });
  text(data.sellerName, margin, y - 15, { size: 11, font: bold });
  text(data.sellerEmail, margin, y - 29, { size: 9, color: GRAY });
  if (data.sellerIdLast4) {
    text(`Gov. ID on file (ending ${data.sellerIdLast4})`, margin, y - 42, {
      size: 9,
      color: GRAY,
    });
  }
  y -= 72;

  // Item table
  page.drawRectangle({ x: margin, y: y - 6, width: width - margin * 2, height: 22, color: rgb(0.96, 0.94, 0.99) });
  text("ITEM", margin + 8, y, { size: 9, font: bold, color: GRAY });
  text("CONDITION", margin + 250, y, { size: 9, font: bold, color: GRAY });
  text("SKU", margin + 350, y, { size: 9, font: bold, color: GRAY });
  text("AMOUNT PAID", width - margin - 90, y, { size: 9, font: bold, color: GRAY });
  y -= 26;

  const itemName = data.brand ? `${data.brand} — ${data.title}` : data.title;
  text(truncate(itemName, 40), margin + 8, y, { size: 10, font: bold });
  if (data.quantity > 1) text(`Qty: ${data.quantity}`, margin + 8, y - 13, { size: 8, color: GRAY });
  text(data.condition, margin + 250, y, { size: 10 });
  text(data.sku, margin + 350, y, { size: 10, font: bold });
  text(usd(data.amountPaidCents, data.currency), width - margin - 90, y, { size: 10, font: bold });
  y -= 24;

  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: LINE,
  });
  y -= 22;

  // Total
  text("TOTAL PAID TO SELLER", width - margin - 220, y, { size: 10, font: bold, color: GRAY });
  text(usd(data.amountPaidCents, data.currency), width - margin - 90, y, {
    size: 13,
    font: bold,
    color: VIOLET,
  });
  y -= 46;

  // Acknowledgment
  const ack = [
    `This receipt confirms that ${data.businessName} purchased the item(s) listed above from`,
    `${data.sellerName} for the total amount shown, on ${data.date.toLocaleDateString("en-US")}.`,
    `The seller confirms they are the lawful owner with the right to sell, and that the sale is`,
    `final. Both parties retain a copy of this receipt as confirmation of the transaction.`,
  ];
  ack.forEach((ln, i) => text(ln, margin, y - i * 14, { size: 9, color: GRAY }));
  y -= ack.length * 14 + 40;

  // Signature lines
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 200, y }, thickness: 1, color: LINE });
  page.drawLine({
    start: { x: width - margin - 200, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: LINE,
  });
  text("Seller signature", margin, y - 14, { size: 8, color: GRAY });
  text(`${data.businessName}`, width - margin - 200, y - 14, { size: 8, color: GRAY });

  // Footer
  text(
    `Generated ${new Date().toLocaleString("en-US")} · ${data.receiptNumber}`,
    margin,
    margin - 12,
    { size: 8, color: GRAY }
  );

  return doc.save();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// The standard Helvetica font uses WinAnsi encoding and cannot draw characters
// outside it (emoji, CJK, some symbols). Map common smart punctuation to ASCII
// and drop anything else that WinAnsi can't represent so the PDF never throws.
function sanitize(input: string): string {
  const mapped = (input || "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    .replace(/−/g, "-")
    .replace(/ /g, " ");
  // Keep printable Latin-1 + the WinAnsi high range; replace the rest.
  let out = "";
  for (const ch of mapped) {
    const code = ch.codePointAt(0) || 0;
    out += code <= 0x2c6 && code >= 0x20 ? ch : code === 0x0a || code === 0x09 ? ch : "?";
  }
  return out;
}
