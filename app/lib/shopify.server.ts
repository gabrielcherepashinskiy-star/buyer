// Shopify Admin API (custom app token). Pushes a bare-bones DRAFT product:
// title, resale price, SKU, condition note, and admin-only cost-per-item.
// Images and the rest are finished on Shopify.

type GqlResult<T> = { data?: T; errors?: Array<{ message: string }> };

function config() {
  const domainRaw = process.env.SHOPIFY_STORE_DOMAIN || "";
  const domain = domainRaw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const token = process.env.SHOPIFY_ADMIN_TOKEN || "";
  const version = process.env.SHOPIFY_API_VERSION || "2025-07";
  return { domain, token, version };
}

export function shopifyConfigured(): boolean {
  const { domain, token } = config();
  return Boolean(domain && token);
}

export function shopifyAdminBase(): string {
  const { domain } = config();
  return `https://${domain}`;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { domain, token, version } = config();
  if (!domain || !token) throw new Error("Shopify is not configured (missing domain or token).");

  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
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
  const descriptionHtml = bodyLines.join("\n");

  const tags = ["buying-desk", `condition:${input.condition}`];

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
      title: input.title,
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
