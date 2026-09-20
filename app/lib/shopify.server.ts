// Shopify Admin API (custom app token). Pushes a bare-bones DRAFT product:
// title, resale price, SKU, condition note, and admin-only cost-per-item.
// Images and the rest are finished on Shopify.

type GqlResult<T> = { data?: T; errors?: Array<{ message: string }> };

function config() {
  const domainRaw = process.env.SHOPIFY_STORE_DOMAIN || "";
  const domain = domainRaw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const token = process.env.SHOPIFY_ADMIN_TOKEN || ""; // legacy static token (shpat_)
  const clientId = process.env.SHOPIFY_API_KEY || ""; // dev-dashboard Client ID
  const clientSecret = process.env.SHOPIFY_API_SECRET || ""; // dev-dashboard Client Secret
  const version = process.env.SHOPIFY_API_VERSION || "2025-07";
  return { domain, token, clientId, clientSecret, version };
}

export function shopifyConfigured(): boolean {
  const { domain, token, clientId, clientSecret } = config();
  return Boolean(domain && (token || (clientId && clientSecret)));
}

export function shopifyAdminBase(): string {
  const { domain } = config();
  return `https://${domain}`;
}

// Cache the client-credentials token in memory (valid ~24h); refresh early.
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Returns an Admin API access token. Prefers a static SHOPIFY_ADMIN_TOKEN
 * (legacy custom apps). Otherwise exchanges the dev-dashboard Client ID +
 * Secret for a short-lived token via the client-credentials grant.
 */
async function getAccessToken(): Promise<string> {
  const { domain, token, clientId, clientSecret } = config();
  if (token) return token;
  if (!clientId || !clientSecret) {
    throw new Error("Shopify is not configured (need SHOPIFY_ADMIN_TOKEN, or SHOPIFY_API_KEY + SHOPIFY_API_SECRET).");
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify token exchange HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Shopify token exchange returned no access_token.");
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 3600_000),
  };
  return cachedToken.value;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { domain, version } = config();
  if (!domain) throw new Error("Shopify is not configured (missing store domain).");
  const accessToken = await getAccessToken();

  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as GqlResult<T>;
  if (json.errors && json.errors.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Shopify returned no data.");
  return json.data;
}

export type ShopifyPushInput = {
  title: string;
  condition: string;
  brand?: string | null;
  category?: string | null;
  size?: string | null;
  description?: string | null;
  sku: string;
  priceCents: number;
  costCents: number;
};

export type ShopifyPushResult = {
  productId: string;
  variantId: string;
  handle: string;
  adminUrl: string;
};

const CREATE = `#graphql
mutation CreateProduct($input: ProductInput!) {
  productCreate(input: $input) {
    product {
      id
      handle
      variants(first: 1) { nodes { id inventoryItem { id } } }
    }
    userErrors { field message }
  }
}`;

const UPDATE_VARIANT = `#graphql
mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Create the DRAFT product in Shopify. Throws with a readable message on failure. */
export async function pushDraftProduct(input: ShopifyPushInput): Promise<ShopifyPushResult> {
  const status = (process.env.SHOPIFY_DEFAULT_STATUS || "DRAFT").toUpperCase() === "ACTIVE"
    ? "ACTIVE"
    : "DRAFT";

  const bodyLines: string[] = [];
  if (input.description) bodyLines.push(input.description);
  bodyLines.push(`<p><strong>Condition:</strong> ${escapeHtml(input.condition)}</p>`);
  if (input.size) bodyLines.push(`<p><strong>Size:</strong> ${escapeHtml(input.size)}</p>`);
  const descriptionHtml = bodyLines.join("\n");

  const productTitle = input.size ? `${input.title} (Size ${input.size})` : input.title;

  const tags = ["buying-desk", `condition:${input.condition}`];
  if (input.size) tags.push(`size:${input.size}`);

  // 1) Create the product (a default variant is created automatically).
  const created = await graphql<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        variants: { nodes: Array<{ id: string; inventoryItem: { id: string } }> };
      } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(CREATE, {
    input: {
      title: productTitle,
      descriptionHtml,
      vendor: input.brand || undefined,
      productType: input.category || undefined,
      status,
      tags,
    },
  });

  const errs = created.productCreate.userErrors;
  if (errs && errs.length) {
    throw new Error(`productCreate: ${errs.map((e) => e.message).join("; ")}`);
  }
  const product = created.productCreate.product;
  if (!product) throw new Error("productCreate returned no product.");

  const variant = product.variants.nodes[0];
  if (!variant) throw new Error("Created product has no default variant.");

  // 2) Set price, SKU, tracking, and admin-only cost-per-item on the variant.
  const upd = await graphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string }>;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(UPDATE_VARIANT, {
    productId: product.id,
    variants: [
      {
        id: variant.id,
        price: dollars(input.priceCents),
        inventoryItem: {
          sku: input.sku,
          cost: dollars(input.costCents),
          tracked: true,
        },
      },
    ],
  });

  const uerrs = upd.productVariantsBulkUpdate.userErrors;
  if (uerrs && uerrs.length) {
    // Product exists but variant update failed — surface it, product still created.
    throw new Error(`variant update: ${uerrs.map((e) => e.message).join("; ")}`);
  }

  const numericId = product.id.split("/").pop();
  return {
    productId: product.id,
    variantId: variant.id,
    handle: product.handle,
    adminUrl: `${shopifyAdminBase()}/admin/products/${numericId}`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
