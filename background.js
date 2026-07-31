// background.js — service worker.
// Mostly a relay: forwards messages from the popup to the content script
// (and vice versa). Also opens TikTok on install so the user can log in.
// Finally, watches for the Stripe Checkout post-payment redirect to the
// Render billing server's /success page and verifies the session to unlock
// unlimited mode persistently (the popup may be closed during payment).

const BILLING_SERVER_URL = "https://tiktok-unfollow-billing.onrender.com";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    try {
      // Open TikTok home — the user logs in here, then clicks the extension
      // and Start, which navigates to their profile and opens the Following
      // card automatically.
      await chrome.tabs.create({ url: "https://www.tiktok.com" });
    } catch (_) {}
  }
});

// Forward runtime messages from content scripts to any open popup.
// (chrome.runtime.sendMessage from content.js reaches listeners here AND
// the popup if it's open; this is a no-op safety relay.)
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  // Intentionally empty: popup listens on chrome.runtime.onMessage too,
  // and content.js talks to the popup via chrome.tabs.sendMessage.
  return false;
});

// ---------------------------------------------------------------- payment unlock
// The buy button creates a Stripe Checkout session via the Render backend.
// After payment, Stripe redirects to the billing server's /success?session_id=
// page. We watch for that redirect here (in the service worker, which persists
// even when the popup is closed), verify the session with the billing server,
// and flip unlimitedUnlocked on in storage. Any open popup is notified so it
// can refresh its UI.
chrome.tabs.onUpdated.addListener(async (_tabId, _info, tab) => {
  if (!tab || !tab.url) return;
  let u;
  try { u = new URL(tab.url); } catch (_) { return; }
  if (u.origin !== BILLING_SERVER_URL) return;
  if (!u.pathname.startsWith("/success")) return;
  const sessionId = u.searchParams.get("session_id");
  if (!sessionId) return;

  // Already unlocked? Nothing to do.
  const cur = await chrome.storage.local.get(["unlimitedUnlocked", "__paidSessionSeen"]);
  if (cur.unlimitedUnlocked) return;
  // Avoid re-processing the same session across multiple onUpdated fires.
  if (cur.__paidSessionSeen === sessionId) return;
  await chrome.storage.local.set({ __paidSessionSeen: sessionId });

  // Verify with the billing server. Stripe marks the session paid by the
  // time of the success redirect, but allow a few retries in case of lag.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = await fetch(`${BILLING_SERVER_URL}/verify-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const json = await res.json();
      if (json.ok && json.key) {
        await chrome.storage.local.set({ unlimitedUnlocked: true });
        // Notify any open popup so it can refresh its quota UI immediately.
        try {
          await chrome.runtime.sendMessage({ source: "tt-unfollow", type: "PAYMENT_UNLOCKED" });
        } catch (_) {}
        return;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
});
