// server.js — billing server for the TikTok Unfollow Agent Chrome extension.
//
// Responsibilities:
// 1. Return the Stripe Payment Link with a unique client_reference_id so the
//    purchase can be matched back to this install.
// 2. Verify a completed payment (by client_reference_id, or by Checkout
//    Session id when the payment link's after-payment redirect is used) and
//    return a unique unlock key.
// 3. Let the extension verify an unlock key on demand.
//
// Run locally:  npm install && npm start
// Runs forever: use pm2 / systemd / Docker in production.

require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const sqlite3 = require("sqlite3");
const Stripe = require("stripe");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PAYMENT_LINK_URL =
  process.env.STRIPE_PAYMENT_LINK_URL || "https://buy.stripe.com/dRmbJ38hZbk56jA6SadjO00";
const PORT = parseInt(process.env.PORT || "4242", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SERVER_URL = process.env.BILLING_SERVER_URL || `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH || "./billing.db";

if (!STRIPE_SECRET_KEY || !STRIPE_SECRET_KEY.startsWith("sk_")) {
  console.error("STRIPE_SECRET_KEY is missing or invalid. Set it in .env");
  process.exit(1);
}
if (!STRIPE_PAYMENT_LINK_URL.startsWith("https://buy.stripe.com/")) {
  console.error("STRIPE_PAYMENT_LINK_URL is missing or invalid. Set it in .env (https://buy.stripe.com/...)");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const app = express();
app.use(express.json());

// ---------------------------------------------------------------- CORS
// Allow the Chrome extension to call this server.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------- SQLite
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS unlock_keys (
      key TEXT PRIMARY KEY,
      session_id TEXT UNIQUE,
      customer_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      revoked INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_id ON unlock_keys(session_id)
  `);
  // Migrate older schema if present: stripe_customer_id -> customer_id.
  db.all("PRAGMA table_info(unlock_keys)", (err, cols) => {
    if (err || !cols) return;
    if (cols.some((c) => c.name === "stripe_customer_id")) {
      db.run("ALTER TABLE unlock_keys RENAME COLUMN stripe_customer_id TO customer_id", () => {});
    }
  });
});

function generateKey() {
  return "ttu_" + crypto.randomBytes(24).toString("hex");
}

// session_id stores the client_reference_id (ttu_...) we attach to the payment
// link, or a Stripe Checkout Session id (cs_...) if the payment link's
// after-payment redirect is configured to our /success page.
function getKeyBySession(sessionId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT key, revoked, customer_id FROM unlock_keys WHERE session_id = ?",
      [sessionId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

function storeKey(key, sessionId, customerId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO unlock_keys (key, session_id, customer_id) VALUES (?, ?, ?)",
      [key, sessionId, customerId || null],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function isKeyValid(key) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT 1 FROM unlock_keys WHERE key = ? AND revoked = 0",
      [key],
      (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      }
    );
  });
}

// ---------------------------------------------------------------- Stripe helpers
// Resolve the payment link's plink_ id once (needed to list its sessions).
let _paymentLinkId = null;
async function getPaymentLinkId() {
  if (_paymentLinkId) return _paymentLinkId;
  const links = await stripe.paymentLinks.list({ limit: 100 });
  const match = links.data.find((l) => l.url === STRIPE_PAYMENT_LINK_URL);
  if (!match) {
    throw new Error(`Payment link not found for URL ${STRIPE_PAYMENT_LINK_URL}`);
  }
  _paymentLinkId = match.id;
  return _paymentLinkId;
}

// Find a paid Checkout Session on our payment link whose client_reference_id
// matches `ref`. Sessions list returns newest first, so a just-paid session
// is near the top; paginate a few pages as a safety net.
async function findPaidSessionByRef(ref) {
  const linkId = await getPaymentLinkId();
  let startingAfter;
  for (let page = 0; page < 10; page++) {
    const list = await stripe.checkout.sessions.list({
      payment_link: linkId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const hit = list.data.find(
      (s) => s.client_reference_id === ref && s.payment_status === "paid"
    );
    if (hit) return hit;
    if (!list.has_more || list.data.length === 0) return null;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return null;
}

// ---------------------------------------------------------------- routes

// Health check (JSON) — kept on /health so the marketing site can live at /.
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "tiktok-unfollow-agent-billing" });
});

// ---------------------------------------------------------------- marketing site
// Static marketing site (landing + ~20 high-CTA programmatic pages) generated
// by `node site/generate.js` into ./site/. Served at the root.
app.use(express.static(path.join(__dirname, "site"), {
  index: "index.html",
  extensions: ["html"],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Content-Type", "text/html; charset=utf-8");
  },
}));
// SPA-ish fallback for /p/<slug> without .html (clean URLs).
app.get("/p/:slug", (req, res, next) => {
  const file = path.join(__dirname, "site", "p", `${req.params.slug}.html`);
  res.sendFile(file, (err) => { if (err) next(); });
});

// Return the Stripe Payment Link with a unique client_reference_id. The
// extension opens it in a new tab; Stripe records the reference on the
// resulting Checkout Session, which /verify-session uses to match the
// payment back to this request.
app.post("/create-checkout-session", (_req, res) => {
  const ref = "ttu_" + crypto.randomBytes(24).toString("hex");
  const join = STRIPE_PAYMENT_LINK_URL.includes("?") ? "&" : "?";
  const url = `${STRIPE_PAYMENT_LINK_URL}${join}client_reference_id=${encodeURIComponent(ref)}`;
  res.json({ ok: true, url, session_id: ref });
});

// Success page shown after Stripe payment (only reached if the payment link's
// "after payment" redirect is configured to this URL — recommended:
// `${SERVER_URL}/success?session_id={CHECKOUT_SESSION_ID}`).
// The extension can close this tab.
app.get("/success", (req, res) => {
  const sessionId = req.query.session_id || "";
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Payment successful</title></head>
      <body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center;">
        <h1>Payment successful</h1>
        <p>You can close this tab and return to the extension.</p>
        <p style="font-family:monospace;opacity:0.6;">session: ${escapeHtml(sessionId)}</p>
      </body>
    </html>
  `);
});

app.get("/cancel", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Payment cancelled</title></head>
      <body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center;">
        <h1>Payment cancelled</h1>
        <p>Close this tab and try again from the extension.</p>
      </body>
    </html>
  `);
});

// Verify a payment and return an unlock key. The extension polls this after
// the user pays. session_id is either the client_reference_id (ttu_...) we
// attached to the payment link, or a Checkout Session id (cs_...) coming from
// the /success redirect.
app.post("/verify-session", async (req, res) => {
  const { session_id } = req.body || {};
  if (!session_id || typeof session_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing_session_id" });
  }

  try {
    // Check if we already issued a key for this session/reference.
    let row = await getKeyBySession(session_id);
    if (row) {
      if (row.revoked) {
        return res.json({ ok: false, error: "key_revoked" });
      }
      return res.json({ ok: true, key: row.key });
    }

    // Otherwise, verify the payment with Stripe.
    let paidSession = null;
    if (session_id.startsWith("cs_")) {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === "paid") paidSession = session;
    } else {
      paidSession = await findPaidSessionByRef(session_id);
    }
    if (!paidSession) {
      return res.json({ ok: false, error: "not_paid" });
    }

    const key = generateKey();
    await storeKey(key, session_id, paidSession.customer || null);
    console.log(`Issued unlock key ${key} for session ${session_id}`);
    return res.json({ ok: true, key });
  } catch (err) {
    console.error("verify-session error:", err);
    return res.status(500).json({ ok: false, error: "verification_failed" });
  }
});

// Instantly cancel every active/trialing/past_due subscription for the
// customer behind this purchase reference, and revoke their unlock key.
// One-time purchases come back with canceled: 0 and the key stays valid.
app.post("/cancel-subscription", async (req, res) => {
  const { session_id } = req.body || {};
  if (!session_id || typeof session_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing_session_id" });
  }
  try {
    let customerId = null;
    const row = await getKeyBySession(session_id);
    if (row && row.customer_id) customerId = row.customer_id;

    if (!customerId) {
      let session = null;
      if (session_id.startsWith("cs_")) {
        session = await stripe.checkout.sessions.retrieve(session_id);
      } else {
        session = await findPaidSessionByRef(session_id);
      }
      customerId = session && session.customer;
    }
    if (!customerId) {
      return res.json({ ok: false, error: "customer_not_found" });
    }

    const subs = await stripe.subscriptions.list({ customer: customerId, limit: 100 });
    const cancellable = subs.data.filter(
      (s) => s.status === "active" || s.status === "trialing" || s.status === "past_due"
    );
    for (const s of cancellable) {
      await stripe.subscriptions.cancel(s.id);
    }

    if (cancellable.length > 0) {
      await new Promise((resolve, reject) =>
        db.run("UPDATE unlock_keys SET revoked = 1 WHERE session_id = ?", [session_id],
          (err) => (err ? reject(err) : resolve()))
      );
    }
    return res.json({ ok: true, canceled: cancellable.length });
  } catch (err) {
    console.error("cancel-subscription error:", err);
    return res.status(500).json({ ok: false, error: "cancel_failed" });
  }
});

// Verify an unlock key (used by the extension on each launch / before running).
app.post("/verify-key", async (req, res) => {
  const { key } = req.body || {};
  if (!key || typeof key !== "string") {
    return res.status(400).json({ ok: false, error: "missing_key" });
  }
  const valid = await isKeyValid(key);
  return res.json({ ok: valid, unlimited: valid });
});

// ---------------------------------------------------------------- helpers
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------- start
app.listen(PORT, () => {
  console.log(`Billing server listening on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
