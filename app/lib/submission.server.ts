import { prisma } from "~/db.server";
import {
  emailConfigured,
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

export async function listSubmissions() {
  return prisma.submission.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true, photos: true },
    take: 300,
  });
}

export async function setSubmissionStatus(id: string, status: string) {
  const allowed = ["new", "reviewed", "quoted", "closed"];
  if (!allowed.includes(status)) return;
  await prisma.submission.update({ where: { id }, data: { status } });
}

export async function newSubmissionCount() {
  return prisma.submission.count({ where: { status: "new" } });
}
