import { prisma } from "~/db.server";
import {
  emailConfigured,
  sendQuoteEmail,
  sendSellerConfirmationEmail,
  sendSellerSubmissionEmail,
} from "~/lib/email.server";

export type SubmissionItemInput = {
  name: string;
  desiredPriceCents: number;
  quantity: number;
  notes?: string;
};

export type CreateSubmissionInput = {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  method: "instore" | "ship";
  note?: string;
  items: SubmissionItemInput[];
  photos?: string[]; // compressed JPEG data URLs
};

export async function createSubmission(input: CreateSubmissionInput) {
  const photos = (input.photos || []).filter((p) => p && p.startsWith("data:")).slice(0, 8);

  const submission = await prisma.submission.create({
    data: {
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      method: input.method,
      note: input.note || null,
      items: {
        create: input.items.map((it) => ({
          name: it.name,
          desiredPriceCents: it.desiredPriceCents,
          quantity: it.quantity,
          notes: it.notes || null,
        })),
      },
      photos: photos.length ? { create: photos.map((dataUrl) => ({ dataUrl })) } : undefined,
    },
    include: { items: true },
  });

  const businessName = process.env.BUSINESS_NAME || "SHOP SELECT NYC";
  const businessEmail = process.env.BUSINESS_EMAIL || process.env.OWNER_EMAIL || "";

  if (emailConfigured()) {
    // 1) Notify the owner (with photos attached). Best-effort.
    try {
      await sendSellerSubmissionEmail({
        ownerEmail: process.env.OWNER_EMAIL || process.env.BUSINESS_EMAIL || "",
        businessName,
        contactName: submission.contactName,
        contactPhone: submission.contactPhone,
        contactEmail: submission.contactEmail,
        method: submission.method as "instore" | "ship",
        note: submission.note,
        items: submission.items.map((it) => ({
          name: it.name,
          desiredPriceCents: it.desiredPriceCents,
          quantity: it.quantity,
          notes: it.notes,
        })),
        photos,
      });
    } catch (e) {
      console.error("Owner notification email failed:", e);
    }

    // 2) Confirmation receipt to the seller.
    try {
      await sendSellerConfirmationEmail({
        businessName,
        businessEmail,
        contactName: submission.contactName,
        contactEmail: submission.contactEmail,
        method: submission.method as "instore" | "ship",
        items: submission.items.map((it) => ({
          name: it.name,
          desiredPriceCents: it.desiredPriceCents,
          quantity: it.quantity,
          notes: it.notes,
        })),
      });
    } catch (e) {
      console.error("Seller confirmation email failed:", e);
    }
  }

  return submission;
}

export async function listSubmissions(statuses?: string[]) {
  return prisma.submission.findMany({
    where: statuses && statuses.length ? { status: { in: statuses } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { items: true, photos: true },
    take: 300,
  });
}

/** Permanently delete a single submission (and its items/photos via cascade). */
export async function deleteSubmission(id: string) {
  await prisma.submission.delete({ where: { id } });
}

/** Bulk-delete all closed/accepted submissions. Returns how many were removed. */
export async function clearClosedSubmissions(): Promise<number> {
  const res = await prisma.submission.deleteMany({
    where: { status: { in: ["accepted", "closed"] } },
  });
  return res.count;
}

export async function getSubmission(id: string) {
  return prisma.submission.findUnique({ where: { id }, include: { items: true, photos: true } });
}

export async function setSubmissionStatus(id: string, status: string) {
  const allowed = ["new", "reviewed", "quoted", "accepted", "closed"];
  if (!allowed.includes(status)) return;
  await prisma.submission.update({ where: { id }, data: { status } });
}

export async function newSubmissionCount() {
  return prisma.submission.count({ where: { status: "new" } });
}

export async function openSubmissionCount() {
  return prisma.submission.count({ where: { status: { in: ["new", "reviewed", "quoted"] } } });
}

/** Email a counteroffer/quote to the seller and mark the submission "quoted". */
export async function sendQuote(
  id: string,
  quoteCents: number,
  message?: string
): Promise<{ ok: boolean; message: string }> {
  const sub = await prisma.submission.findUnique({ where: { id } });
  if (!sub) return { ok: false, message: "Submission not found." };
  if (!emailConfigured()) return { ok: false, message: "Email isn't configured (set RESEND_API_KEY / RESEND_FROM)." };
  if (!quoteCents || quoteCents <= 0) return { ok: false, message: "Enter a quote amount." };
  try {
    await sendQuoteEmail({
      businessName: process.env.BUSINESS_NAME || "SHOP SELECT NYC",
      businessEmail: process.env.BUSINESS_EMAIL || process.env.OWNER_EMAIL || "",
      contactName: sub.contactName,
      contactEmail: sub.contactEmail,
      quoteCents,
      message,
    });
    await prisma.submission.update({ where: { id }, data: { status: "quoted" } });
    return { ok: true, message: `Quote of $${(quoteCents / 100).toFixed(2)} emailed to ${sub.contactEmail}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not send the quote." };
  }
}
