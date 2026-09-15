import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/session.server";
import { receiptPdfFor } from "~/lib/purchase.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUser(request);
  const { bytes, receiptNumber } = await receiptPdfFor(params.id!);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${receiptNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
