// background.js — service worker.
// Mostly a relay: forwards messages from the popup to the content script
// (and vice versa). Also opens TikTok on install so the user can log in.
// Finally, watches for the Stripe Payment Link's post-payment redirect to
// the success URL and unlocks unlimited mode (no backend server — the
// redirect itself is the proof of payment).

// After a successful Stripe payment, the Payment Link redirects here.
// Configure this exact URL as the "after payment" redirect in your Stripe
// Payment Link settings. The extension watches for this URL and unlocks.
const STRIPE_SUCCESS_URL = "https://www.tiktok.com/?ttu_paid=1";

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
// The buy button opens a Stripe Payment Link. After payment, Stripe
// redirects to STRIPE_SUCCESS_URL. We watch for that redirect here (in the
// service worker, which persists even when the popup is closed), and flip
// unlimitedUnlocked on in storage. Any open popup is notified so it can
// refresh its UI.
//
// NOTE: there is no server-side verification. We trust that reaching the
// success URL means Stripe marked the payment successful (Stripe only
// redirects there on success). The tradeoff: anyone who manually visits
// STRIPE_SUCCESS_URL would also unlock. Acceptable for a $5 extension.
chrome.tabs.onUpdated.addListener(async (_tabId, _info, tab) => {
  if (!tab || !tab.url) return;
  let u;
  try { u = new URL(tab.url); } catch (_) { return; }
  // Match the success redirect. We compare on origin+pathname+the ttu_paid
  // flag so extra query params Stripe may append don't break the match.
  const success = new URL(STRIPE_SUCCESS_URL);
  const isSuccess =
    u.origin === success.origin &&
    u.pathname === success.pathname &&
    u.searchParams.get("ttu_paid") === "1";
  if (!isSuccess) return;

  // Already unlocked? Nothing to do.
  const cur = await chrome.storage.local.get(["unlimitedUnlocked"]);
  if (cur.unlimitedUnlocked) return;

  await chrome.storage.local.set({ unlimitedUnlocked: true });
  // Notify any open popup so it can refresh its quota UI immediately.
  try {
    await chrome.runtime.sendMessage({ source: "tt-unfollow", type: "PAYMENT_UNLOCKED" });
  } catch (_) {}
});
