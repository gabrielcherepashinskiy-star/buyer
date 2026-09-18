import { prisma } from "~/db.server";
import { emailConfigured, sendSellerSubmissionEmail } from "~/lib/email.server";

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
};

export async function createSubmission(input: CreateSubmissionInput) {
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
    },
    include: { items: true },
  });

  // Notify the owner (best-effort; never blocks the submission).
  if (emailConfigured()) {
    try {
      await sendSellerSubmissionEmail({
        ownerEmail: process.env.OWNER_EMAIL || process.env.BUSINESS_EMAIL || "",
        businessName: process.env.BUSINESS_NAME || "SHOP SELECT NYC",
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
      });
    } catch {
      // ignore — submission is already saved and visible in /admin
    }
  }

  return submission;
}

export async function listSubmissions() {
  return prisma.submission.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true },
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
