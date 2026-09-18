import { prisma } from "~/db.server";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function randomBlock(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** SKU like SSB-7K2P9Q (SSB = Select Select Buy). Guaranteed unique. */
export async function generateSku(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const sku = `SSB-${randomBlock(6)}`;
    const existing = await prisma.purchase.findUnique({ where: { sku } });
    if (!existing) return sku;
  }
  return `SSB-${randomBlock(8)}`;
}

/** Batch receipt number like B-20260915-4821 (for a multi-item purchase). */
export function generateBatchNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `B-${ymd}-${randomBlock(4)}`;
}

/** Receipt number like SSB-20260915-4821 (date + random). Guaranteed unique. */
export async function generateReceiptNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const n = String(Math.floor(1000 + Math.random() * 9000));
    const receiptNumber = `R-${ymd}-${n}`;
    const existing = await prisma.purchase.findUnique({ where: { receiptNumber } });
    if (!existing) return receiptNumber;
  }
  return `R-${ymd}-${randomBlock(4)}`;
}
