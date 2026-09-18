import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/session.server";
import { receiptPdfFor } from "~/lib/purchase.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUser(request);
  try {
    const { bytes, receiptNumber } = await receiptPdfFor(params.id!);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="receipt-${receiptNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Receipt PDF failed:", e);
    return new Response("Could not generate this receipt. Please try again.", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
