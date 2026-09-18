import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import { createSubmission } from "~/lib/submission.server";
import { toCents } from "~/lib/money";

export const meta: MetaFunction = () => [
  { title: "Sell to SHOP SELECT NYC" },
  { name: "description", content: "Submit your items for a quote from SHOP SELECT NYC." },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return json({
    submitted: url.searchParams.get("submitted") === "1",
    businessName: process.env.BUSINESS_NAME || "SHOP SELECT NYC",
  });
}

type ItemInput = { name: string; price: string; notes: string };

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const contactName = String(form.get("contactName") || "").trim();
  const contactPhone = String(form.get("contactPhone") || "").trim();
  const contactEmail = String(form.get("contactEmail") || "").trim();
  const method = String(form.get("method") || "").trim();
  const note = String(form.get("note") || "").trim();

  let items: ItemInput[] = [];
  try {
    items = JSON.parse(String(form.get("itemsJson") || "[]"));
  } catch {
    items = [];
  }
  const filled = items.filter((i) => (i.name || "").trim());

  const errors: string[] = [];
  if (!contactName) errors.push("Please enter your name.");
  if (!contactPhone) errors.push("Please enter your phone number.");
  if (!contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail))
    errors.push("Please enter a valid email.");
  if (filled.length === 0) errors.push("Please list at least one item.");
  if (method !== "instore" && method !== "ship") errors.push("Please choose how you'll get items to us.");

  if (errors.length > 0) return json({ errors }, { status: 400 });

  let photos: string[] = [];
  try {
    photos = JSON.parse(String(form.get("photosJson") || "[]"));
  } catch {
    photos = [];
  }

  try {
    await createSubmission({
      contactName,
      contactPhone,
      contactEmail,
      method: method as "instore" | "ship",
      note,
      items: filled.map((i) => ({
        name: i.name.trim(),
        desiredPriceCents: toCents(i.price),
        quantity: 1,
        notes: (i.notes || "").trim() || undefined,
      })),
      photos: Array.isArray(photos) ? photos : [],
    });
  } catch (e) {
    console.error("Submission failed:", e);
    return json(
      { errors: ["Sorry — something went wrong submitting your items. Please try again in a moment."] },
      { status: 500 }
    );
  }

  return redirect("/?submitted=1");
}

export default function Sell() {
  const { submitted, businessName } = useLoaderData<typeof loader>();
  if (submitted) return <ThankYou businessName={businessName} />;
  return <Wizard businessName={businessName} />;
}

function ThankYou({ businessName }: { businessName: string }) {
  const [, setParams] = useSearchParams();
  return (
    <div className="sell-wrap">
      <div className="sell-card" style={{ textAlign: "center" }}>
        <div className="brand" style={{ justifyContent: "center", marginBottom: 18 }}>
          <span className="dot" />
          <span style={{ fontSize: 18 }}>{businessName}</span>
        </div>
        <div style={{ fontSize: 44, marginBottom: 8 }}>✓</div>
        <h1 style={{ fontSize: 24 }}>Submitted — thank you!</h1>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
          Your items are in. A sales associate will review them and get back to you with a quote by
          email. Keep an eye on your inbox.
        </p>
        <button className="btn ghost" style={{ marginTop: 18 }} onClick={() => setParams({})}>
          Submit more items
        </button>
      </div>
    </div>
  );
}

const emptyItem = (): ItemInput => ({ name: "", price: "", notes: "" });

// Shrink a phone photo in the browser to a small JPEG data URL before upload.
function compressImage(file: File, maxDim = 1200, quality = 0.65): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

function Wizard({ businessName }: { businessName: string }) {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [step, setStep] = useState(1);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [items, setItems] = useState<ItemInput[]>(() => [emptyItem(), emptyItem(), emptyItem()]);
  const [method, setMethod] = useState<"" | "instore" | "ship">("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [stepError, setStepError] = useState("");

  const MAX_PHOTOS = 6;
  const onPhotos = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setPhotoBusy(true);
    const room = MAX_PHOTOS - photos.length;
    const files = Array.from(fileList).slice(0, Math.max(0, room));
    const compressed: string[] = [];
    for (const file of files) {
      try {
        compressed.push(await compressImage(file));
      } catch {
        /* skip unreadable file */
      }
    }
    setPhotos((prev) => [...prev, ...compressed].slice(0, MAX_PHOTOS));
    setPhotoBusy(false);
  };
  const removePhoto = (i: number) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));

  const updateItem = (i: number, key: keyof ItemInput, val: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const filledItems = useMemo(() => items.filter((i) => i.name.trim()), [items]);

  const next = () => {
    setStepError("");
    if (step === 1) {
      if (!contact.name.trim() || !contact.phone.trim() || !contact.email.trim()) {
        setStepError("Please fill in your name, phone, and email.");
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim())) {
        setStepError("That email doesn't look right.");
        return;
      }
    }
    if (step === 2 && filledItems.length === 0) {
      setStepError("Add at least one item you'd like to sell.");
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  };
  const back = () => {
    setStepError("");
    setStep((s) => Math.max(1, s - 1));
  };

  return (
    <div className="sell-wrap">
      <div className="sell-card">
        <div className="brand" style={{ justifyContent: "center", marginBottom: 6 }}>
          <span className="dot" />
          <span style={{ fontSize: 18 }}>{businessName}</span>
        </div>
        <p className="muted" style={{ textAlign: "center", marginTop: 0, fontSize: 14 }}>
          Sell your items to us — get a quote
        </p>

        <div className="steps">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`step-dot ${step === n ? "active" : ""} ${step > n ? "done" : ""}`}>
              {step > n ? "✓" : n}
            </div>
          ))}
        </div>

        {actionData?.errors?.length ? (
          <div className="alert err">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {actionData.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {stepError ? <div className="alert warn">{stepError}</div> : null}

        <Form method="post">
          <input type="hidden" name="itemsJson" value={JSON.stringify(items)} readOnly />
          <input type="hidden" name="photosJson" value={JSON.stringify(photos)} readOnly />
          <input type="hidden" name="method" value={method} readOnly />
          <input type="hidden" name="note" value={note} readOnly />
          <input type="hidden" name="contactName" value={contact.name} readOnly />
          <input type="hidden" name="contactPhone" value={contact.phone} readOnly />
          <input type="hidden" name="contactEmail" value={contact.email} readOnly />

          {/* WINDOW 1 — contact */}
          {step === 1 ? (
            <div>
              <h2 style={{ textAlign: "center" }}>Your contact info</h2>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Full name</label>
                <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Your name" autoFocus />
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Phone number</label>
                <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} inputMode="tel" placeholder="(555) 555-5555" />
              </div>
              <div className="field">
                <label>Email</label>
                <input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} type="email" inputMode="email" placeholder="you@email.com" />
              </div>
            </div>
          ) : null}

          {/* WINDOW 2 — items */}
          {step === 2 ? (
            <div>
              <h2 style={{ textAlign: "center" }}>What are you selling?</h2>
              <p className="muted" style={{ textAlign: "center", marginTop: -6, fontSize: 13 }}>
                List each item and how much you'd like to get for it.
              </p>
              {items.map((it, i) => (
                <div key={i} className="sell-item">
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <input value={it.name} onChange={(e) => updateItem(i, "name", e.target.value)} placeholder={`Item ${i + 1} — e.g. Louis Vuitton Neverfull`} />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <input style={{ flex: 1 }} value={it.price} onChange={(e) => updateItem(i, "price", e.target.value)} inputMode="decimal" placeholder="Desired price $" />
                        <input style={{ flex: 1.4 }} value={it.notes} onChange={(e) => updateItem(i, "notes", e.target.value)} placeholder="Size / condition (optional)" />
                      </div>
                    </div>
                    {items.length > 1 ? (
                      <button type="button" className="btn ghost sm" style={{ padding: "8px 10px" }} onClick={() => removeItem(i)} title="Remove">
                        ✕
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              <button type="button" className="btn ghost sm" onClick={addItem} style={{ marginTop: 4 }}>
                + Add another item
              </button>

              <div className="section-label" style={{ marginTop: 22 }}>Photos (optional)</div>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Add clear photos of your items — it helps us quote faster and more accurately.
              </p>
              {photos.length > 0 ? (
                <div className="photos">
                  {photos.map((src, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={src} alt={`Item photo ${i + 1}`} />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        title="Remove photo"
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          border: "none",
                          background: "var(--red)",
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: 12,
                          lineHeight: "22px",
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {photos.length < MAX_PHOTOS ? (
                <label className="btn ghost sm" style={{ marginTop: 10, cursor: "pointer", display: "inline-flex" }}>
                  {photoBusy ? "Adding…" : photos.length ? "+ Add more photos" : "+ Add photos"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      onPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : (
                <p className="hint">Maximum {MAX_PHOTOS} photos.</p>
              )}
            </div>
          ) : null}

          {/* WINDOW 3 — method + disclaimer + submit */}
          {step === 3 ? (
            <div>
              <h2 style={{ textAlign: "center" }}>How will we get your items?</h2>
              <button type="button" className={`method-card ${method === "instore" ? "sel" : ""}`} onClick={() => setMethod("instore")}>
                <div className="method-title">In-store drop-off</div>
                <div className="method-sub">Bring your items to our location in person. We'll evaluate them and give you a quote on the spot or shortly after.</div>
              </button>
              <button type="button" className={`method-card ${method === "ship" ? "sel" : ""}`} onClick={() => setMethod("ship")}>
                <div className="method-title">Ship to us — PUA</div>
                <div className="method-sub">
                  <strong>Payment Upon Arrival.</strong> Mail your items to us. Once they arrive and are
                  verified, we issue your payment — so you're paid after we receive and inspect them.
                </div>
              </button>

              <div className="field" style={{ marginTop: 14 }}>
                <label>Anything else we should know? (optional)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Extra details about your items…" />
              </div>

              <div className="disclaimer">
                Submitting your items does not guarantee that a deal has been agreed to. Your desired
                prices are not guaranteed. A sales associate will review your submission and get back
                to you with a quote.
              </div>
            </div>
          ) : null}

          <div className="wizard-nav">
            {step > 1 ? (
              <button type="button" className="btn ghost" onClick={back}>
                ← Back
              </button>
            ) : (
              <span />
            )}
            {step < 3 ? (
              <button type="button" className="btn" onClick={next}>
                Next →
              </button>
            ) : (
              <button className="btn" type="submit" disabled={busy || !method}>
                {busy ? "Submitting…" : "Submit to store to get my quote"}
              </button>
            )}
          </div>
        </Form>
      </div>
      <p className="sell-foot muted">© {new Date().getFullYear()} {businessName}</p>
    </div>
  );
}
