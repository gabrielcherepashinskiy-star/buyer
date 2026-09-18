// Live Google Sheets sync via a service account (server-to-server, no user login).
// The dedicated Google account creates a service account + JSON key, enables the
// Sheets API, and shares the master sheet with the service account email (Editor).

import { JWT } from "google-auth-library";

const HEADERS = [
  "Date",
  "Receipt #",
  "SKU",
  "Item",
  "Brand",
  "Category",
  "Size",
  "Condition",
  "Qty",
  "Cost",
  "Price",
  "Profit",
  "Margin %",
  "Seller Name",
  "Seller Email",
  "Seller ID (last 4)",
  "Recorded By",
  "Shopify Status",
  "Shopify Product",
];

function tab(): string {
  return process.env.GOOGLE_SHEET_TAB || "Purchases";
}

export function sheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_SHEET_ID
  );
}

function getClient(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY || "";
  // Env-stored keys usually have escaped newlines.
  key = key.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google Sheets is not configured.");
  return new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function accessToken(client: JWT): Promise<string> {
  const res = await client.getAccessToken();
  const token = typeof res === "string" ? res : res?.token;
  if (!token) throw new Error("Could not obtain Google access token.");
  return token;
}

function sheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not set.");
  return id;
}

async function sheetsFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sheets HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Ensure the tab exists and has a header row. Safe to call repeatedly. */
async function ensureHeader(token: string): Promise<void> {
  const id = sheetId();
  const range = encodeURIComponent(`${tab()}!A1:S1`);
  const data = (await sheetsFetch(`${id}/values/${range}`, token)) as {
    values?: string[][];
  };
  const hasHeader = data.values && data.values.length > 0 && data.values[0].length > 0;
  if (!hasHeader) {
    await sheetsFetch(
      `${id}/values/${encodeURIComponent(`${tab()}!A1`)}?valueInputOption=RAW`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({ values: [HEADERS] }),
      }
    );
  }
}

export type SheetRow = {
  date: string;
  receiptNumber: string;
  sku: string;
  title: string;
  brand: string;
  category: string;
  size: string;
  condition: string;
  quantity: number;
  costDollars: number;
  priceDollars: number;
  profitDollars: number;
  marginPct: number;
  sellerName: string;
  sellerEmail: string;
  sellerIdLast4: string;
  recordedBy: string;
  shopifyStatus: string;
  shopifyUrl: string;
};

/** Append one purchase as a new row. Throws with a readable message on failure. */
export async function appendPurchaseRow(row: SheetRow): Promise<void> {
  const client = getClient();
  const token = await accessToken(client);
  await ensureHeader(token);

  const id = sheetId();
  const range = encodeURIComponent(`${tab()}!A1`);
  const values = [
    [
      row.date,
      row.receiptNumber,
      row.sku,
      row.title,
      row.brand,
      row.category,
      row.size,
      row.condition,
      row.quantity,
      row.costDollars,
      row.priceDollars,
      row.profitDollars,
      Number(row.marginPct.toFixed(1)),
      row.sellerName,
      row.sellerEmail,
      row.sellerIdLast4,
      row.recordedBy,
      row.shopifyStatus,
      row.shopifyUrl,
    ],
  ];

  await sheetsFetch(
    `${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ values }),
    }
  );
}

/** Quick connectivity check used by the setup/health screen. */
export async function testSheetsConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    if (!sheetsConfigured()) return { ok: false, message: "Not configured" };
    const client = getClient();
    const token = await accessToken(client);
    await ensureHeader(token);
    return { ok: true, message: "Connected" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unknown error" };
  }
}
