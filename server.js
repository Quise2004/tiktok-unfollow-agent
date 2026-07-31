// server.js — billing server for the TikTok Unfollow Agent Chrome extension.
//
// Responsibilities:
// 1. Create a Stripe Checkout session for the one-time $5 unlock.
// 2. Verify the completed Checkout session and return a unique unlock key.
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
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const PORT = parseInt(process.env.PORT || "4242", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SERVER_URL = process.env.BILLING_SERVER_URL || `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH || "./billing.db";

if (!STRIPE_SECRET_KEY || !STRIPE_SECRET_KEY.startsWith("sk_")) {
  console.error("STRIPE_SECRET_KEY is missing or invalid. Set it in .env");
  process.exit(1);
}
if (!STRIPE_PRICE_ID || !STRIPE_PRICE_ID.startsWith("price_")) {
  console.error("STRIPE_PRICE_ID is missing or invalid. Set it in .env");
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
      stripe_customer_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      revoked INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_id ON unlock_keys(session_id)
  `);
});

function generateKey() {
  return "ttu_" + crypto.randomBytes(24).toString("hex");
}

function getKeyBySession(sessionId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT key, revoked FROM unlock_keys WHERE session_id = ?",
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
      "INSERT INTO unlock_keys (key, session_id, stripe_customer_id) VALUES (?, ?, ?)",
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

// Create a Stripe Checkout session for the $5 unlock.
// The extension calls this, opens the returned URL, and waits for payment.
// We try "payment" mode first (one-time). If the price is recurring, we
// fall back to "subscription" mode automatically.
app.post("/create-checkout-session", async (req, res) => {
  const baseParams = {
    line_items: [
      {
        price: STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${SERVER_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SERVER_URL}/cancel`,
    metadata: { source: "tt-unfollow-extension" },
  };

  // Try one-time payment mode first.
  try {
    const session = await stripe.checkout.sessions.create({
      ...baseParams,
      mode: "payment",
    });
    return res.json({ ok: true, url: session.url, session_id: session.id });
  } catch (err) {
    // If the price is recurring, switch to subscription mode.
    if (err && err.message && err.message.includes("recurring price")) {
      try {
        const session = await stripe.checkout.sessions.create({
          ...baseParams,
          mode: "subscription",
        });
        return res.json({ ok: true, url: session.url, session_id: session.id });
      } catch (err2) {
        console.error("create-checkout-session (subscription) error:", err2);
        return res.status(500).json({ ok: false, error: "stripe_error", detail: err2.message });
      }
    }
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ ok: false, error: "stripe_error", detail: err.message });
  }
});

// Success page shown after Stripe payment. The extension can close this tab.
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

// Verify a completed Stripe Checkout session and return an unlock key.
// The extension polls this after the user pays.
app.post("/verify-session", async (req, res) => {
  const { session_id } = req.body || {};
  if (!session_id || typeof session_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing_session_id" });
  }

  try {
    // Check if we already issued a key for this session.
    let row = await getKeyBySession(session_id);
    if (row) {
      if (row.revoked) {
        return res.json({ ok: false, error: "key_revoked" });
      }
      return res.json({ ok: true, key: row.key });
    }

    // Otherwise, verify the session with Stripe.
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") {
      return res.json({ ok: false, error: "not_paid" });
    }

    const key = generateKey();
    await storeKey(key, session_id, session.customer || null);
    console.log(`Issued unlock key ${key} for session ${session_id}`);
    return res.json({ ok: true, key });
  } catch (err) {
    console.error("verify-session error:", err);
    return res.status(500).json({ ok: false, error: "verification_failed" });
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
