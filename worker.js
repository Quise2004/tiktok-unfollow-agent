// worker.js — Cloudflare Worker port of the billing server for the
// TikTok Unfollow Agent Chrome extension.
//
// Same contract as server.js:
//   GET  /health
//   POST /create-checkout-session  -> { ok, url, session_id }
//   POST /verify-session           -> { ok, key } (session_id = ttu_ ref or cs_ id)
//   POST /verify-key               -> { ok, unlimited }
//   POST /cancel-subscription      -> { ok, canceled } — instantly cancels all
//                                     active subscriptions for the customer
//   GET  /success, /cancel         -> post-payment landing pages
//
// Storage: D1 table `unlock_keys` (same schema as the old SQLite billing.db).
// Stripe calls go through the REST API with fetch — no SDK needed.
// Secrets: STRIPE_SECRET_KEY via `wrangler secret put`.

const STRIPE_API = "https://api.stripe.com/v1";

function json(data, status = 200, corsOrigin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
    },
  });
}

function html(body) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function generateKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "ttu_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- Stripe REST
async function stripeGet(env, path) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body && body.error ? body.error.message : `stripe ${res.status}`);
  }
  return body;
}

async function stripeDelete(env, path) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body && body.error ? body.error.message : `stripe ${res.status}`);
  }
  return body;
}

// Resolve the payment link's plink_ id (cached on the isolate).
let _paymentLinkId = null;
async function getPaymentLinkId(env) {
  if (_paymentLinkId) return _paymentLinkId;
  const links = await stripeGet(env, "/payment_links?limit=100");
  const match = (links.data || []).find((l) => l.url === env.STRIPE_PAYMENT_LINK_URL);
  if (!match) throw new Error(`Payment link not found for URL ${env.STRIPE_PAYMENT_LINK_URL}`);
  _paymentLinkId = match.id;
  return _paymentLinkId;
}

// Find a paid Checkout Session on our payment link whose client_reference_id
// matches `ref`. Sessions list returns newest first.
async function findPaidSessionByRef(env, ref) {
  const linkId = await getPaymentLinkId(env);
  let startingAfter = "";
  for (let page = 0; page < 10; page++) {
    const qs = `payment_link=${encodeURIComponent(linkId)}&limit=100` +
      (startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : "");
    const list = await stripeGet(env, `/checkout/sessions?${qs}`);
    const hit = (list.data || []).find(
      (s) => s.client_reference_id === ref && s.payment_status === "paid"
    );
    if (hit) return hit;
    if (!list.has_more || !list.data.length) return null;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return null;
}

// ---------------------------------------------------------------- D1 helpers
async function getKeyBySession(env, sessionId) {
  return env.DB.prepare(
    "SELECT key, revoked, customer_id FROM unlock_keys WHERE session_id = ?"
  ).bind(sessionId).first();
}

async function storeKey(env, key, sessionId, customerId) {
  await env.DB.prepare(
    "INSERT INTO unlock_keys (key, session_id, customer_id) VALUES (?, ?, ?)"
  ).bind(key, sessionId, customerId || null).run();
}

async function isKeyValid(env, key) {
  const row = await env.DB.prepare(
    "SELECT 1 AS x FROM unlock_keys WHERE key = ? AND revoked = 0"
  ).bind(key).first();
  return !!row;
}

// ---------------------------------------------------------------- routes
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = env.CORS_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": cors,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "tiktok-unfollow-agent-billing" }, 200, cors);
    }

    if (url.pathname === "/create-checkout-session" && request.method === "POST") {
      const ref = generateKey();
      const link = env.STRIPE_PAYMENT_LINK_URL;
      const join = link.includes("?") ? "&" : "?";
      const checkoutUrl = `${link}${join}client_reference_id=${encodeURIComponent(ref)}`;
      return json({ ok: true, url: checkoutUrl, session_id: ref }, 200, cors);
    }

    if (url.pathname === "/success") {
      const sessionId = url.searchParams.get("session_id") || "";
      return html(`<!DOCTYPE html>
<html><head><title>Payment successful</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center;">
  <h1>Payment successful</h1>
  <p>You can close this tab and return to the extension.</p>
  <p style="font-family:monospace;opacity:0.6;">session: ${escapeHtml(sessionId)}</p>
</body></html>`);
    }

    if (url.pathname === "/cancel") {
      return html(`<!DOCTYPE html>
<html><head><title>Payment cancelled</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center;">
  <h1>Payment cancelled</h1>
  <p>Close this tab and try again from the extension.</p>
</body></html>`);
    }

    if (url.pathname === "/verify-session" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const sessionId = body.session_id;
      if (!sessionId || typeof sessionId !== "string") {
        return json({ ok: false, error: "missing_session_id" }, 400, cors);
      }
      try {
        const existing = await getKeyBySession(env, sessionId);
        if (existing) {
          if (existing.revoked) return json({ ok: false, error: "key_revoked" }, 200, cors);
          return json({ ok: true, key: existing.key }, 200, cors);
        }

        let paidSession = null;
        if (sessionId.startsWith("cs_")) {
          const session = await stripeGet(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
          if (session.payment_status === "paid") paidSession = session;
        } else {
          paidSession = await findPaidSessionByRef(env, sessionId);
        }
        if (!paidSession) {
          return json({ ok: false, error: "not_paid" }, 200, cors);
        }

        const key = generateKey();
        await storeKey(env, key, sessionId, paidSession.customer || null);
        console.log(`Issued unlock key ${key} for session ${sessionId}`);
        return json({ ok: true, key }, 200, cors);
      } catch (err) {
        console.error("verify-session error:", err);
        return json({ ok: false, error: "verification_failed" }, 500, cors);
      }
    }

    // Instantly cancel every active/trialing/past_due subscription for the
    // customer behind this purchase reference, and revoke their unlock key.
    // If they only made a one-time payment, canceled comes back 0 and the key
    // stays valid.
    if (url.pathname === "/cancel-subscription" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const sessionId = body.session_id;
      if (!sessionId || typeof sessionId !== "string") {
        return json({ ok: false, error: "missing_session_id" }, 400, cors);
      }
      try {
        let customerId = null;
        const row = await getKeyBySession(env, sessionId);
        if (row && row.customer_id) customerId = row.customer_id;

        if (!customerId) {
          let session = null;
          if (sessionId.startsWith("cs_")) {
            session = await stripeGet(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
          } else {
            session = await findPaidSessionByRef(env, sessionId);
          }
          customerId = session && session.customer;
        }
        if (!customerId) {
          return json({ ok: false, error: "customer_not_found" }, 200, cors);
        }

        const subs = await stripeGet(env,
          `/subscriptions?customer=${encodeURIComponent(customerId)}&limit=100`
        );
        const cancellable = (subs.data || []).filter(
          (s) => s.status === "active" || s.status === "trialing" || s.status === "past_due"
        );
        for (const s of cancellable) {
          await stripeDelete(env, `/subscriptions/${s.id}`);
        }

        if (cancellable.length > 0) {
          await env.DB.prepare("UPDATE unlock_keys SET revoked = 1 WHERE session_id = ?")
            .bind(sessionId).run();
        }
        return json({ ok: true, canceled: cancellable.length }, 200, cors);
      } catch (err) {
        console.error("cancel-subscription error:", err);
        return json({ ok: false, error: "cancel_failed" }, 500, cors);
      }
    }

    if (url.pathname === "/verify-key" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const key = body.key;
      if (!key || typeof key !== "string") {
        return json({ ok: false, error: "missing_key" }, 400, cors);
      }
      const valid = await isKeyValid(env, key);
      return json({ ok: valid, unlimited: valid }, 200, cors);
    }

    return new Response("Not found", { status: 404 });
  },
};
