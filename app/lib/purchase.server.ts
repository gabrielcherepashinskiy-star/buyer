import { prisma } from "~/db.server";
import { encrypt, last4 } from "~/lib/crypto.server";
import { generateReceiptNumber, generateSku } from "~/lib/sku.server";
import { pushDraftProduct, shopifyConfigured } from "~/lib/shopify.server";
import { appendPurchaseRow, sheetsConfigured } from "~/lib/sheets.server";
import { emailConfigured, sendReceiptEmail } from "~/lib/email.server";
import { renderReceiptPdf } from "~/lib/receipt-pdf.server";
import { marginPct } from "~/lib/money";
import type { Purchase } from "@prisma/client";

function biz() {
  return {
    name: process.env.BUSINESS_NAME || "SHOP SELECT NYC",
    address: process.env.BUSINESS_ADDRESS || "New York, NY",
    email: process.env.BUSINESS_EMAIL || process.env.OWNER_EMAIL || "",
    owner: process.env.OWNER_EMAIL || "",
  };
}

export type CreatePurchaseInput = {
  title: string;
  brand?: string;
  category?: string;
  condition: string;
  description?: string;
  quantity: number;
  costCents: number;
  priceCents: number;
  currency: string;
  sellerName: string;
  sellerEmail: string;
  sellerId: string; // plaintext; encrypted before storage
  recordedBy: string;
};

export type SideEffectStatus = {
  shopify: { ok: boolean; message: string };
  sheet: { ok: boolean; message: string };
  receipt: { ok: boolean; message: string };
};

export async function createPurchase(
  input: CreatePurchaseInput
): Promise<{ purchase: Purchase; status: SideEffectStatus }> {
  const sku = await generateSku();
  const receiptNumber = await generateReceiptNumber();

  const sellerIdTrimmed = input.sellerId.trim();
  const sellerIdEnc = sellerIdTrimmed ? encrypt(sellerIdTrimmed) : null;
  const sellerIdLast4 = sellerIdTrimmed ? last4(sellerIdTrimmed) : null;

  let purchase = await prisma.purchase.create({
    data: {
      sku,
      receiptNumber,
      title: input.title,
      brand: input.brand || null,
      category: input.category || null,
      condition: input.condition,
      description: input.description || null,
      quantity: input.quantity,
      costCents: input.costCents,
      priceCents: input.priceCents,
      currency: input.currency,
      sellerName: input.sellerName,
      sellerEmail: input.sellerEmail,
      sellerIdEnc,
      sellerIdLast4,
      recordedBy: input.recordedBy,
    },
  });

  const status: SideEffectStatus = {
    shopify: { ok: false, message: "skipped" },
    sheet: { ok: false, message: "skipped" },
    receipt: { ok: false, message: "skipped" },
  };

  // 1) Shopify (draft)
  status.shopify = await runShopify(purchase);
  purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });

  // 2) Google Sheets
  status.sheet = await runSheet(purchase);
  purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });

  // 3) Receipt email
  status.receipt = await runReceipt(purchase);
  purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });

  return { purchase, status };
}

async function runShopify(p: Purchase): Promise<{ ok: boolean; message: string }> {
  if (!shopifyConfigured()) {
    await prisma.purchase.update({
      where: { id: p.id },
      data: { shopifyStatus: "skipped", shopifyError: "Shopify not configured" },
    });
    return { ok: false, message: "Shopify not configured" };
  }
  try {
    const result = await pushDraftProduct({
      title: p.title,
      condition: p.condition,
      brand: p.brand,
      category: p.category,
      description: p.description,
      sku: p.sku,
      priceCents: p.priceCents,
      costCents: p.costCents,
    });
    await prisma.purchase.update({
      where: { id: p.id },
      data: {
        shopifyProductId: result.productId,
        shopifyVariantId: result.variantId,
        shopifyHandle: result.handle,
        shopifyStatus: "active",
        shopifyError: null,
        shopifySyncedAt: new Date(),
      },
    });
    return { ok: true, message: "Draft created in Shopify" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown Shopify error";
    await prisma.purchase.update({
      where: { id: p.id },
      data: { shopifyStatus: "error", shopifyError: message },
    });
    return { ok: false, message };
  }
}

async function runSheet(p: Purchase): Promise<{ ok: boolean; message: string }> {
  if (!sheetsConfigured()) {
    await prisma.purchase.update({
      where: { id: p.id },
      data: { sheetError: "Google Sheets not configured" },
    });
    return { ok: false, message: "Google Sheets not configured" };
  }
  try {
    const profit = p.priceCents - p.costCents;
    await appendPurchaseRow({
      date: p.createdAt.toISOString().slice(0, 10),
      receiptNumber: p.receiptNumber,
      sku: p.sku,
      title: p.title,
      brand: p.brand || "",
      category: p.category || "",
      condition: p.condition,
      quantity: p.quantity,
      costDollars: p.costCents / 100,
      priceDollars: p.priceCents / 100,
      profitDollars: profit / 100,
      marginPct: marginPct(p.costCents, p.priceCents),
      sellerName: p.sellerName,
      sellerEmail: p.sellerEmail,
      sellerIdLast4: p.sellerIdLast4 || "",
      recordedBy: p.recordedBy || "",
      shopifyStatus: p.shopifyStatus,
      shopifyUrl: p.shopifyProductId
        ? `https://${(process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/products/${p.shopifyProductId.split("/").pop()}`
        : "",
    });
    await prisma.purchase.update({
      where: { id: p.id },
      data: { sheetSyncedAt: new Date(), sheetError: null },
    });
    return { ok: true, message: "Row added to master sheet" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown Sheets error";
    await prisma.purchase.update({ where: { id: p.id }, data: { sheetError: message } });
    return { ok: false, message };
  }
}

async function runReceipt(p: Purchase): Promise<{ ok: boolean; message: string }> {
  if (!emailConfigured()) {
    await prisma.purchase.update({
      where: { id: p.id },
      data: { receiptError: "Email not configured" },
    });
    return { ok: false, message: "Email not configured" };
  }
  const b = biz();
  try {
    const pdf = await renderReceiptPdf({
      businessName: b.name,
      businessAddress: b.address,
      businessEmail: b.email,
      receiptNumber: p.receiptNumber,
      date: p.createdAt,
      sellerName: p.sellerName,
      sellerEmail: p.sellerEmail,
      sellerIdLast4: p.sellerIdLast4,
      title: p.title,
      brand: p.brand,
      condition: p.condition,
      sku: p.sku,
      quantity: p.quantity,
      amountPaidCents: p.costCents,
      currency: p.currency,
    });
    const pdfBase64 = Buffer.from(pdf).toString("base64");
    await sendReceiptEmail({
      businessName: b.name,
      businessEmail: b.email,
      sellerName: p.sellerName,
      sellerEmail: p.sellerEmail,
      ownerEmail: b.owner,
      receiptNumber: p.receiptNumber,
      date: p.createdAt,
      title: p.title,
      brand: p.brand,
      condition: p.condition,
      sku: p.sku,
      quantity: p.quantity,
      amountPaidCents: p.costCents,
      currency: p.currency,
      pdfBase64,
    });
    await prisma.purchase.update({
      where: { id: p.id },
      data: { receiptSentAt: new Date(), receiptError: null },
    });
    return { ok: true, message: `Receipt emailed to ${p.sellerEmail}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown email error";
    await prisma.purchase.update({ where: { id: p.id }, data: { receiptError: message } });
    return { ok: false, message };
  }
}

/** Re-run the Shopify push for an existing purchase. */
export async function repushShopify(id: string): Promise<{ ok: boolean; message: string }> {
  const p = await prisma.purchase.findUniqueOrThrow({ where: { id } });
  return runShopify(p);
}

/** Re-send the receipt email for an existing purchase. */
export async function resendReceipt(id: string): Promise<{ ok: boolean; message: string }> {
  const p = await prisma.purchase.findUniqueOrThrow({ where: { id } });
  return runReceipt(p);
}

/** Re-sync a purchase row to the master sheet. */
export async function resyncSheet(id: string): Promise<{ ok: boolean; message: string }> {
  const p = await prisma.purchase.findUniqueOrThrow({ where: { id } });
  return runSheet(p);
}

/** Render the receipt PDF for download. */
export async function receiptPdfFor(id: string): Promise<{ bytes: Uint8Array; receiptNumber: string }> {
  const p = await prisma.purchase.findUniqueOrThrow({ where: { id } });
  const b = biz();
  const bytes = await renderReceiptPdf({
    businessName: b.name,
    businessAddress: b.address,
    businessEmail: b.email,
    receiptNumber: p.receiptNumber,
    date: p.createdAt,
    sellerName: p.sellerName,
    sellerEmail: p.sellerEmail,
    sellerIdLast4: p.sellerIdLast4,
    title: p.title,
    brand: p.brand,
    condition: p.condition,
    sku: p.sku,
    quantity: p.quantity,
    amountPaidCents: p.costCents,
    currency: p.currency,
  });
  return { bytes, receiptNumber: p.receiptNumber };
}
