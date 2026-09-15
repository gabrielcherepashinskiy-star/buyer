# Buying Desk — SHOP SELECT NYC

A private tool for buying products outright. Record what you bought, price it,
push a **draft** to Shopify, log every purchase to a **master Google Sheet**,
and **email a receipt** to the seller. Two master keys (you + your partner).
Installs as an app on your computer.

- **Stack:** Remix + Prisma + PostgreSQL (Neon), deploys on Vercel
- **Shopify:** custom app Admin API token (no embedded app needed)
- **Sheets:** Google service account (writes rows automatically)
- **Email:** Resend
- **Security:** seller ID numbers are AES-256-GCM encrypted at rest

---

## What happens when you record a purchase

1. Saved to your database (always).
2. A **draft** product is created in Shopify: title, resale price, SKU,
   condition, and the cost stored in Shopify's admin-only "cost per item" field
   (buyers never see it). You add photos and finish it on Shopify.
3. A row is appended to your master Google Sheet.
4. A PDF receipt is emailed to the seller (and a copy to you). The receipt shows
   what the seller was **paid** — never your resale price.

If any of steps 2–4 fail, the purchase is still saved and you can retry that one
step with a button on the purchase page.

---

## Full setup — from scratch

You'll set up five things: **GitHub**, **Neon (database)**, **Vercel
(hosting)**, **Shopify (token)**, **Google (sheet)**, and **Resend (email)**.
Take them in order. Copy each value into a notepad as you go — you'll paste them
all into Vercel at the end.

### 1. Put the code on GitHub
1. Create a new **private** repo on GitHub (e.g. `select-buy`).
2. Upload this project (drag the folder contents into GitHub's web uploader, or
   push with git). Don't upload a `.env` file.

### 2. Database — Vercel Postgres (Neon)
Provision this from Vercel (do this right after you import the project in step 7,
or now if the project already exists):
1. In your Vercel project → **Storage → Create Database → Postgres (Neon)**.
2. Accept the defaults (region: Washington D.C. / iad1 is fine) and create it,
   connected to this project.
3. That's it — Vercel automatically adds **`POSTGRES_PRISMA_URL`** and
   **`POSTGRES_URL_NON_POOLING`** to your project's environment variables. You do
   not paste any database URL by hand. (The app uses the pooled one; migrations
   use the direct one.)
4. For local development only, run `vercel env pull .env` to copy them down.

### 3. Shopify — custom app token
1. In Shopify admin: **Settings → Apps and sales channels → Develop apps**.
   (If it's off, click "Allow custom app development".)
2. **Create an app** → name it "Buying Desk".
3. **Configuration → Admin API integration → Configure**, enable these scopes:
   `write_products`, `read_products`, `write_inventory`. Save.
4. **API credentials → Install app**, then **Reveal token once** and copy the
   **Admin API access token** (starts with `shpat_`). Save it as
   **`SHOPIFY_ADMIN_TOKEN`** — you can only see it once.
5. Your store domain (e.g. `shopselectnyc.myshopify.com`) is
   **`SHOPIFY_STORE_DOMAIN`**.

### 4. Google Sheet — dedicated account + service account
Do this from the **new dedicated Google account** you're creating.
1. Create the master spreadsheet in Google Sheets. From its URL, copy the ID:
   `https://docs.google.com/spreadsheets/d/`**`THIS_LONG_ID`**`/edit`. Save it as
   **`GOOGLE_SHEET_ID`**. (Leave the first tab named "Sheet1" or rename it to
   "Purchases" — set `GOOGLE_SHEET_TAB` to whatever you name it.)
2. Go to **console.cloud.google.com** (signed in as the dedicated account) and
   create a new project ("Buying Desk").
3. **APIs & Services → Library → Google Sheets API → Enable.**
4. **APIs & Services → Credentials → Create credentials → Service account.**
   Name it, click through, and create it.
5. Open the new service account → **Keys → Add key → Create new key → JSON.**
   A JSON file downloads. Inside it:
   - `client_email` → **`GOOGLE_SERVICE_ACCOUNT_EMAIL`**
   - `private_key` → **`GOOGLE_PRIVATE_KEY`** (copy the whole thing including the
     `-----BEGIN/END-----` lines; keep the `\n` characters as-is)
6. **Share the spreadsheet with the service account email** (the
   `...iam.gserviceaccount.com` address) as **Editor** — same as sharing a sheet
   with a coworker. This is the step that lets the app write rows.

### 5. Email — Resend
1. Go to **resend.com**, sign up.
2. **Domains → Add domain** for `shopselectnyc.com` and add the DNS records it
   shows you (at your domain registrar). Wait for it to verify.
3. **API Keys → Create** → copy it. Save as **`RESEND_API_KEY`**.
4. Set **`RESEND_FROM`** to something like
   `SHOP SELECT NYC <receipts@shopselectnyc.com>` (must be on the verified
   domain). Set **`OWNER_EMAIL`** to your address (you'll get a copy of every
   receipt).

### 6. Secrets — generate three keys
On a Mac/Linux terminal run each line and save the output:
```
openssl rand -hex 32       # SESSION_SECRET
openssl rand -base64 32    # ENCRYPTION_KEY
openssl rand -base64 24    # USER1_KEY (yours)
openssl rand -base64 24    # USER2_KEY (partner's)
```
(No terminal? Use any password generator for long random strings.)
Set `USER1_NAME` / `USER2_NAME` to your names.

> ⚠️ **Never change `ENCRYPTION_KEY` after go-live** — stored ID numbers can't be
> decrypted with a different key.

### 7. Deploy on Vercel
1. Go to **vercel.com**, **Add New → Project**, import your GitHub repo.
2. Framework is auto-detected (Remix). Leave build settings default.
3. **Environment Variables** — add every value from `.env.example` EXCEPT the two
   database URLs (those were added automatically in step 2): the `USER`/master
   keys, `ENCRYPTION_KEY`, `SESSION_SECRET`, all `SHOPIFY_*`, all `GOOGLE_*`,
   `RESEND_*`, `OWNER_EMAIL`, and the `BUSINESS_*` fields. Add them to
   **Production, Preview, and Development**.
4. Click **Deploy**. The build runs `prisma db push`, which creates the database
   tables automatically the first time.
5. When it finishes you'll get a URL like `select-buy.vercel.app`. (Optional: add
   a custom domain like `buy.shopselectnyc.com` in Vercel → Domains.)

### 8. Install it as an app on your computer
1. Open your Vercel URL in **Chrome or Edge** (desktop).
2. Sign in with your master key.
3. Click the **install icon** in the address bar (a small monitor/⊕ icon), or
   **⋮ menu → Cast, save and share → Install page as app**. It opens in its own
   window with its own dock/taskbar icon.
4. Have your partner do the same with their master key. On iPhone/iPad: open in
   Safari → Share → **Add to Home Screen**.

You're live. Record your first purchase from **New Purchase**.

---

## Local development (optional)
```
cp .env.example .env      # fill in the values
npm install
npm run prisma:push       # create tables
npm run dev               # http://localhost:3000
```

## Notes
- **Two master keys:** whichever key someone enters identifies them, and every
  purchase is tagged with who logged it (shown in the list and on the sheet).
- **Seller ID privacy:** the full ID is encrypted; the app and receipts only ever
  show the last 4 digits.
- **Nothing sensitive goes to Shopify:** buyers can't see the seller, the cost,
  or the ID — only the draft product you finish yourself.
