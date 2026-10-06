// popup.js — UI controller for the TikTok Unfollow Agent
// Clean rewrite: robust error handling, auto-inject content script,
// proper billing flow, user-friendly UX.

const $ = (id) => document.getElementById(id);

// --- DOM refs ---
const dot = $("dot");
const statusText = $("statusText");
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const countWrap = $("countWrap");
const countInput = $("count");
const delCountInput = null; // Delete Posts is Coming Soon — no inputs
const delCountWrap = null;
const unfollowSection = $("unfollowSection");
const deleteSection = $("deleteSection");
const quotaLabel = $("quotaLabel");
const quotaLeft = $("quotaLeft");
const quotaBadge = $("quotaBadge");
const buySection = $("buySection");
const buyBtn = $("buyBtn");
const payStatus = $("payStatus");
const unlockedBanner = $("unlockedBanner");
const progressWrap = $("progressWrap");
const progressFill = $("progressFill");
const doneLabel = $("doneLabel");
const targetLabel = $("targetLabel");
const logEl = $("log");
const logToggle = $("logToggle");
const autostartBanner = $("autostartBanner");
const autostartCount = $("autostartCount");
const autostartCancel = $("autostartCancel");

// --- Constants ---
const FREE_TIER_LIMIT = 5;
const BILLING_SERVER_URL = "https://tiktok-unfollow-billing.onrender.com";

let tool = "unfollow";      // "unfollow" or "delete"
let mode = "count";         // unfollow sub-mode: "count" or "all"
let delMode = "count";      // delete sub-mode: "count" or "all"
let running = false;
let logVisible = false;

// ================================================================ UI helpers
function setStatus(text, cls) {
  statusText.textContent = text;
  dot.className = "dot " + (cls || "");
}

function pushLog(text, cls) {
  const line = document.createElement("div");
  line.className = "line " + (cls || "");
  const t = new Date().toLocaleTimeString();
  line.textContent = `[${t}] ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  if (!logVisible) { logEl.classList.add("show"); logVisible = true; logToggle.textContent = "\u25BC Hide log"; }
}

// Prominent toast banner shown at the top of the popup. More visible than the
// small log area — used for errors, completions, and important state changes.
function showToast(text, cls) {
  const wrap = $("toastWrap");
  if (!wrap) return;
  const t = document.createElement("div");
  t.className = "toast " + (cls || "info");
  t.textContent = text;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add("fading");
    setTimeout(() => t.remove(), 300);
  }, 4200);
}

// Blocking modal alert popup. Used for important messages (errors, completions)
// so they show as a real popup dialog instead of just a line in the log.
// opts: { title, cls, okText, onOk, upgrade: bool }
function showAlert(msg, opts) {
  opts = opts || {};
  const cls = opts.cls || "info";
  const overlay = $("modalOverlay");
  const bar = $("modalBar");
  const title = $("modalTitle");
  const msgEl = $("modalMsg");
  const actions = $("modalActions");

  bar.className = "modal-bar " + cls;
  title.className = "modal-title " + cls;
  title.textContent = opts.title || (cls === "err" ? "Error" : cls === "ok" ? "Success" : cls === "warn" ? "Heads up" : "Notice");
  msgEl.textContent = msg;

  // Rebuild action buttons.
  actions.innerHTML = "";
  const okBtn = document.createElement("button");
  okBtn.className = "modal-btn primary";
  okBtn.textContent = opts.okText || "OK";
  okBtn.addEventListener("click", () => {
    overlay.classList.remove("show");
    if (typeof opts.onOk === "function") opts.onOk();
  });
  actions.appendChild(okBtn);

  // Optional "Unlock Unlimited" button for quota-exhausted errors.
  if (opts.upgrade) {
    const upBtn = document.createElement("button");
    upBtn.className = "modal-btn upgrade";
    upBtn.textContent = "Unlock Unlimited";
    upBtn.addEventListener("click", () => {
      overlay.classList.remove("show");
      buyBtn.click();
    });
    actions.insertBefore(upBtn, okBtn);
  }

  overlay.classList.add("show");
  okBtn.focus();
}

function setProgress(done, target) {
  progressWrap.classList.remove("hidden");
  doneLabel.textContent = `${done} done`;
  targetLabel.textContent = `/ ${target || "?"}`;
  const pct = target > 0 ? Math.min(100, (done / target) * 100) : 0;
  progressFill.style.width = pct + "%";
}

function setRunningUI(isRunning) {
  running = isRunning;
  startBtn.classList.toggle("hidden", isRunning);
  stopBtn.classList.toggle("hidden", !isRunning);
}

// ================================================================ Log toggle
logToggle.addEventListener("click", () => {
  logVisible = !logVisible;
  logEl.classList.toggle("show", logVisible);
  logToggle.textContent = logVisible ? "\u25BC Hide log" : "\u25B6 Show log";
});

// ================================================================ Tool tabs (Unfollow / Delete)
document.querySelectorAll(".tool-tab").forEach((el) => {
  el.addEventListener("click", () => {
    if (running) return; // don't switch tools while running
    document.querySelectorAll(".tool-tab").forEach((t) => t.classList.remove("active"));
    el.classList.add("active");
    tool = el.dataset.tool;
    unfollowSection.classList.toggle("hidden", tool !== "unfollow");
    deleteSection.classList.toggle("hidden", tool !== "delete");
    // Delete Posts is "Coming Soon" — hide action UI while on that tab.
    const isDelete = tool === "delete";
    startBtn.classList.toggle("hidden", isDelete);
    stopBtn.classList.toggle("hidden", isDelete || !running);
    startBtn.textContent = "Start Unfollowing";
  });
});

// ================================================================ Hidden owner unlock
// Click the "U" logo 5 times within 3 seconds to unlock Unlimited on this PC.
// This is the owner's backdoor — no payment required. Intended for the
// extension author / their own machines only.
(() => {
  let logoClicks = 0;
  let logoTimer = null;
  const logoBtn = $("logoBtn");
  if (logoBtn) {
    logoBtn.style.cursor = "pointer";
    logoBtn.addEventListener("click", async () => {
      logoClicks++;
      if (logoTimer) clearTimeout(logoTimer);
      logoTimer = setTimeout(() => {
        logoClicks = 0;
        logoBtn.textContent = "U";
      }, 3000);
      // Show progress on the logo itself so you can see clicks registering.
      logoBtn.textContent = logoClicks >= 5 ? "U" : String(logoClicks);
      if (logoClicks >= 5) {
        logoClicks = 0;
        logoBtn.textContent = "U";
        try {
          await setUnlimited(true);
          showAlert("Unlimited mode unlocked on this device. Enjoy!", {
            cls: "ok",
            title: "Unlocked",
            okText: "Nice",
          });
          pushLog("Unlimited unlocked via owner backdoor", "ok");
        } catch (e) {
          showAlert("Couldn't unlock: " + (e && e.message ? e.message : String(e)), { cls: "err" });
        }
      }
    });
  }
})();

// ================================================================ Unfollow mode toggle
document.querySelectorAll(".mode[data-mode]").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".mode[data-mode]").forEach((m) => m.classList.remove("active"));
    el.classList.add("active");
    mode = el.dataset.mode;
    countWrap.classList.toggle("hidden", mode !== "count");
  });
});

// Delete mode toggle removed — Delete Posts is "Coming Soon".

// ================================================================ Quota / billing
async function loadQuota() {
  const data = await chrome.storage.local.get(["unfollowCount", "unlimitedUnlocked"]);
  const used = parseInt(data.unfollowCount, 10) || 0;
  const unlimited = !!data.unlimitedUnlocked;
  renderQuota(used, unlimited);
  return { used, unlimited };
}

function renderQuota(used, unlimited) {
  if (unlimited) {
    quotaLabel.textContent = "Unlimited Plan";
    quotaLeft.textContent = "No limits — unfollow & delete as many as you want";
    quotaBadge.textContent = "Pro";
    quotaBadge.className = "badge unlimited";
    buySection.classList.add("hidden");
    unlockedBanner.classList.remove("hidden");
  } else {
    const left = Math.max(0, FREE_TIER_LIMIT - used);
    quotaLabel.textContent = "Free Plan";
    quotaLeft.textContent = `${left} of ${FREE_TIER_LIMIT} actions remaining`;
    quotaBadge.textContent = "Free";
    quotaBadge.className = "badge";
    buySection.classList.remove("hidden");
    unlockedBanner.classList.add("hidden");
  }
}

async function setUnlimited(unlocked) {
  await chrome.storage.local.set({ unlimitedUnlocked: unlocked });
  await loadQuota();
}

// --- Buy button (Stripe Payment Link via Render backend) ---
// Polls /verify-session until the payment confirms or times out. The pending
// reference is persisted in chrome.storage so polling can resume if the popup
// is closed while the user is still paying.
function startPaymentPoll(sessionId) {
  let attempts = 0;
  const maxAttempts = 120; // 5 minutes at 2.5s intervals
  const poll = setInterval(async () => {
    attempts++;
    if (attempts >= maxAttempts) {
      clearInterval(poll);
      await chrome.storage.local.remove("__pendingPaymentRef");
      payStatus.className = "pay-status err";
      payStatus.textContent = "Timed out waiting for payment. Try again.";
      buyBtn.disabled = false;
      buyBtn.textContent = "Unlock Unlimited — $5";
      return;
    }
    try {
      const vres = await fetch(`${BILLING_SERVER_URL}/verify-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const vjson = await vres.json();
      if (vjson.ok && vjson.key) {
        clearInterval(poll);
        await chrome.storage.local.remove("__pendingPaymentRef");
        // Payment confirmed — unlock unlimited immediately.
        await setUnlimited(true);
        payStatus.className = "pay-status ok";
        payStatus.textContent = "Payment confirmed! Unlimited unlocked.";
        pushLog("Unlimited unlocked via Stripe payment", "ok");
        buyBtn.disabled = false;
        buyBtn.textContent = "Unlock Unlimited — $5";
      }
    } catch (_) { /* keep polling */ }
  }, 2500);
}

buyBtn.addEventListener("click", async () => {
  buyBtn.disabled = true;
  buyBtn.textContent = "Creating checkout...";
  payStatus.className = "pay-status";
  payStatus.textContent = "";

  try {
    const res = await fetch(`${BILLING_SERVER_URL}/create-checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (!json.ok || !json.url) {
      payStatus.className = "pay-status err";
      payStatus.textContent = "Could not start checkout. Is the billing server running?";
      buyBtn.disabled = false;
      buyBtn.textContent = "Unlock Unlimited — $5";
      return;
    }

    // Persist the pending reference so the poll can resume on popup reopen.
    const sessionId = json.session_id;
    await chrome.storage.local.set({ __pendingPaymentRef: sessionId });

    // Open Stripe Payment Link in new tab.
    chrome.tabs.create({ url: json.url });
    payStatus.className = "pay-status";
    payStatus.textContent = "Complete payment in the new tab. Waiting for confirmation...";
    buyBtn.textContent = "Waiting for payment...";
    startPaymentPoll(sessionId);
  } catch (e) {
    payStatus.className = "pay-status err";
    payStatus.textContent = "Can't reach billing server. Make sure it's running.";
    buyBtn.disabled = false;
    buyBtn.textContent = "Unlock Unlimited — $5";
  }
});

// ================================================================ Tab / content script
async function getTikTokTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.url || !/https:\/\/(www\.)?tiktok\.com\//.test(tab.url)) return null;
  return tab;
}

// Wait for a tab to finish loading after a navigation. Resolves on
// status === "complete" or after a safety timeout so we never hang.
function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
    // Check current status immediately — the tab may already be complete
    // (e.g. if reload was very fast or we attached the listener too late).
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === "complete") finish();
    });
  });
}

async function sendToTab(message) {
  const tab = await getTikTokTab();
  if (!tab) return { error: "not_on_tiktok" };
  return sendToTabById(tab.id, message);
}

// Send a message to a specific tab by id, injecting content.js if needed.
async function sendToTabById(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    // Content script not loaded — inject it.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await new Promise((r) => setTimeout(r, 500));
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      return { error: "inject_failed", message: String(e2) };
    }
  }
}

// ================================================================ Start / Stop
// Core start flow, extracted so both the Start button and the popup-open
// auto-start can invoke it. Returns true if the agent actually started.
async function runStartFlow() {
  // Delete Posts is "Coming Soon" — guard against any stray start.
  if (tool === "delete") {
    showAlert("Delete Posts is coming soon! Stay tuned for a future update.", {
      cls: "info",
      title: "Coming Soon",
      okText: "Got it",
    });
    return false;
  }
  // Check quota first (shared between unfollow & delete).
  const quota = await loadQuota();
  if (!quota.unlimited && quota.used >= FREE_TIER_LIMIT) {
    setStatus("Free tier used up — unlock unlimited", "err");
    const actionWord = tool === "delete" ? "actions" : "unfollows";
    showAlert(`You've used all ${FREE_TIER_LIMIT} free ${actionWord}. Unlock Unlimited to keep going.`, {
      cls: "err",
      title: "Free tier used up",
      upgrade: true,
      okText: "Maybe later",
    });
    pushLog(`Free tier exhausted (${quota.used}/${FREE_TIER_LIMIT})`, "err");
    return false;
  }

  // Build params based on which tool is active.
  const isDelete = tool === "delete";
  const activeMode = isDelete ? delMode : mode;
  const target = activeMode === "count"
    ? Math.max(1, parseInt((isDelete ? delCountInput : countInput).value) || 1)
    : 0;
  const opts = {
    shuffle: $("shuffle").checked,
    dryRun: $("dryRun").checked,
    debug: $("debug").checked,
    confirmEach: isDelete ? $("delConfirm").checked : false,
  };

  startBtn.disabled = true;
  setRunningUI(true);
  setStatus("Reloading page…", "run");

  if (isDelete) {
    showToast("Reloading page & finding your posts…", "info");
    pushLog("Start clicked (Delete Posts) — reloading page", "ok");
  } else {
    showToast("Reloading page & opening Following list…", "info");
    pushLog("Start clicked — reloading page and opening Following card", "ok");
  }

  // 1. Get the active TikTok tab. If not on TikTok, send the tab to TikTok.
  let tab = await getTikTokTab();
  if (!tab) {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTabs[0]) {
      setStatus("No active tab", "err");
      showAlert("No active tab found. Open a TikTok tab first.", { cls: "err" });
      setRunningUI(false);
      startBtn.disabled = false;
      return false;
    }
    tab = activeTabs[0];
    await chrome.tabs.update(tab.id, { url: "https://www.tiktok.com" });
  } else {
    // Reload the current TikTok page.
    await chrome.tabs.reload(tab.id);
  }

  // 2. Wait for the page to finish loading.
  await waitForTabComplete(tab.id);
  // Extra settle time — TikTok is a SPA and the profile renders after load.
  await new Promise((r) => setTimeout(r, 1800));

  if (isDelete) {
    // Delete flow: navigate to profile, then start the delete agent.
    setStatus("Opening your profile…", "run");
    const navRes = await sendToTabById(tab.id, { type: "OPEN_PROFILE" });
    if (!navRes || !navRes.ok) {
      const msg = navRes?.error === "not_on_profile" ? "Couldn't navigate to your profile. Make sure you're logged in." :
                  "Failed to open your profile. Try again.";
      setStatus(msg, "err");
      showAlert(msg, { cls: "err", title: "Couldn't open profile" });
      pushLog(`Open profile failed: ${navRes?.error || "unknown"}`, "err");
      setRunningUI(false);
      startBtn.disabled = false;
      return false;
    }

    setStatus("Running…", "run");
    showToast("Started deleting posts!", "ok");
    const res = await sendToTabById(tab.id, { type: "DELETE_START", mode: delMode, target, opts });
    if (!res || res.error) {
      const msg = res?.error === "inject_failed" ? "Can't inject into this page. Reload TikTok and try again." : "Failed to start the delete agent.";
      setStatus(msg, "err");
      showAlert(msg, { cls: "err", title: "Start failed" });
      pushLog(`Delete start failed: ${res?.error || "unknown"}`, "err");
      setRunningUI(false);
      startBtn.disabled = false;
      return false;
    }
    pushLog(`Delete started — mode: ${delMode}, target: ${target || "all"}`, "ok");
    return true;
  } else {
    // Unfollow flow: open the Following card on the profile, then start.
    setStatus("Opening Following list…", "run");
    const openRes = await sendToTabById(tab.id, { type: "OPEN_FOLLOWING_CARD" });
    if (!openRes || !openRes.ok) {
      const msg = openRes?.error === "not_on_profile" ? "Not on your profile — open your TikTok profile first, then click Start." :
                  openRes?.error === "no_following_stat" ? "Couldn't find the Following count on your profile. Make sure you're logged in and on your own profile." :
                  openRes?.error === "modal_did_not_open" ? "The Following list didn't open. Try again, or open it manually and click Start." :
                  "Failed to open the Following list. Try again.";
      setStatus(msg, "err");
      showAlert(msg, { cls: "err", title: "Couldn't open Following list" });
      pushLog(`Open following card failed: ${openRes?.error || "unknown"}`, "err");
      setRunningUI(false);
      startBtn.disabled = false;
      return false;
    }

    setStatus("Running…", "run");
    showToast("Started unfollowing!", "ok");
    const res = await sendToTabById(tab.id, { type: "START", mode, target, opts });
    if (!res || res.error) {
      const msg = res?.error === "inject_failed" ? "Can't inject into this page. Reload TikTok and try again." : "Failed to start the agent.";
      setStatus(msg, "err");
      showAlert(msg, { cls: "err", title: "Start failed" });
      pushLog(`Start failed: ${res?.error || "unknown"}`, "err");
      setRunningUI(false);
      startBtn.disabled = false;
      return false;
    }
    pushLog(`Started — mode: ${mode}, target: ${target || "all"}, dryRun: ${opts.dryRun}`, "ok");
    return true;
  }
}

startBtn.addEventListener("click", () => { runStartFlow(); });

stopBtn.addEventListener("click", async () => {
  await sendToTab({ type: "STOP" });
  pushLog("Stop requested", "warn");
  showToast("Stop requested…", "warn");
});

// ================================================================ Auto-start on open
// When the popup opens, automatically kick off the full unfollow flow
// (open profile → open Following card → reload → unfollow) after a short,
// cancelable countdown. Uses the current UI settings (mode + count).
let autostartTimer = null;
let autostartCancelled = false;

function cancelAutostart() {
  autostartCancelled = true;
  if (autostartTimer) { clearInterval(autostartTimer); autostartTimer = null; }
  if (autostartBanner) autostartBanner.classList.add("hidden");
}

function beginAutostartCountdown() {
  if (autostartTimer) return; // already counting
  autostartCancelled = false;
  let n = 3;
  autostartCount.textContent = String(n);
  autostartBanner.classList.remove("hidden");
  setStatus(`Auto-starting in ${n}s…`, "run");
  autostartTimer = setInterval(async () => {
    if (autostartCancelled) {
      clearInterval(autostartTimer);
      autostartTimer = null;
      return;
    }
    n--;
    if (n <= 0) {
      clearInterval(autostartTimer);
      autostartTimer = null;
      autostartBanner.classList.add("hidden");
      pushLog("Auto-start triggered on popup open", "ok");
      await runStartFlow();
      return;
    }
    autostartCount.textContent = String(n);
    setStatus(`Auto-starting in ${n}s…`, "run");
  }, 1000);
}

autostartCancel.addEventListener("click", () => {
  cancelAutostart();
  setStatus("Auto-start cancelled — click Start when ready", "");
  pushLog("Auto-start cancelled by user", "warn");
});

// ================================================================ Init
(async function init() {
  setStatus("Checking page…");

  // Load quota (non-blocking on server check).
  try { await loadQuota(); } catch (_) {}

  // Resume a pending payment poll if the popup was closed mid-payment.
  try {
    const { __pendingPaymentRef, unlimitedUnlocked } =
      await chrome.storage.local.get(["__pendingPaymentRef", "unlimitedUnlocked"]);
    if (__pendingPaymentRef && !unlimitedUnlocked) {
      payStatus.className = "pay-status";
      payStatus.textContent = "Waiting for payment confirmation...";
      startPaymentPoll(__pendingPaymentRef);
    }
  } catch (_) {}

  // Ping content script.
  try {
    const res = await sendToTab({ type: "PING" });
    if (!res || res.error) {
      if (res?.error === "not_on_tiktok") {
        // Not on TikTok yet — that's fine, the start flow will navigate
        // there. Keep Start enabled and let the auto-start countdown run.
        setStatus("Will open TikTok & start…", "run");
        startBtn.disabled = false;
        const quota = await loadQuota();
        const quotaOk = quota.unlimited || quota.used < FREE_TIER_LIMIT;
        if (tool === "unfollow" && quotaOk) {
          beginAutostartCountdown();
        } else if (!quotaOk) {
          setStatus("Free tier used up — unlock unlimited to auto-start", "err");
        }
        return;
      } else if (res?.error === "inject_failed") {
        setStatus("Can't connect — try reloading TikTok", "err");
        startBtn.disabled = true;
      } else {
        setStatus("Error — reload TikTok & reopen popup", "err");
        startBtn.disabled = true;
      }
      return;
    }

    if (res.running) {
      setStatus("Agent running", "run");
      setRunningUI(true);
    } else {
      // Don't disable Start — the user might open the Following modal
      // after the popup is open. Let them try; the agent detects the
      // modal at runtime.
      setStatus(res.onFollowingPage ? "Ready — click Start" : "Open your Following list or modal, then Start", res.onFollowingPage ? "ok" : "");
      startBtn.disabled = false;

      // Auto-start the unfollow flow on popup open. Only when:
      //   - the Unfollow tool is active (Delete Posts is "Coming Soon")
      //   - the agent isn't already running
      //   - quota isn't exhausted (no point auto-starting a flow that
      //     will immediately hit the paywall)
      const quota = await loadQuota();
      const quotaOk = quota.unlimited || quota.used < FREE_TIER_LIMIT;
      if (tool === "unfollow" && quotaOk) {
        beginAutostartCountdown();
      } else if (!quotaOk) {
        setStatus("Free tier used up — unlock unlimited to auto-start", "err");
      }
    }
    if (res.lastLog) pushLog(res.lastLog);
  } catch (e) {
    setStatus("Error — reload TikTok & reopen popup", "err");
    startBtn.disabled = true;
  }
})();

// ================================================================ Live updates
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.source !== "tt-unfollow") return;
  if (msg.type === "PROGRESS") {
    setProgress(msg.done, msg.target);
  } else if (msg.type === "LOG") {
    pushLog(msg.text, msg.cls);
  } else if (msg.type === "DONE") {
    setRunningUI(false);
    if (msg.reason === "free_tier_exhausted") {
      setStatus("Free tier used up", "err");
      pushLog("Free tier exhausted. Unlock unlimited to continue.", "err");
      showAlert(`You've used all ${FREE_TIER_LIMIT} free unfollows (${msg.done} done). Unlock Unlimited to keep going.`, {
        cls: "err",
        title: "Free tier used up",
        upgrade: true,
        okText: "Maybe later",
      });
      loadQuota(); // refresh UI
    } else if (msg.reason === "stopped") {
      setStatus("Stopped", "err");
      pushLog(`Stopped — ${msg.done} unfollowed`, "err");
      showAlert(`Stopped — ${msg.done} unfollowed.`, { cls: "warn", title: "Stopped", okText: "Close" });
    } else {
      setStatus("Finished", "ok");
      pushLog(`Done — ${msg.done} unfollowed`, "ok");
      showAlert(`Done — ${msg.done} unfollowed!`, { cls: "ok", title: "Finished", okText: "Nice" });
    }
    loadQuota(); // refresh quota display
  } else if (msg.type === "STATUS") {
    setStatus(msg.text, msg.cls);
  } else if (msg.type === "PAYMENT_UNLOCKED") {
    // Background verified a Stripe payment redirect. Refresh UI + notify.
    loadQuota();
    payStatus.className = "pay-status ok";
    payStatus.textContent = "Payment confirmed! Unlimited unlocked.";
    pushLog("Unlimited unlocked via Stripe payment link", "ok");
    showAlert("Payment confirmed — Unlimited unlocked!", { cls: "ok", title: "Unlocked", okText: "Nice" });
  }
});
