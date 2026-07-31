// generate.js — builds a static marketing site with ~20 high-CTA programmatic
// pages for the TikTok Unfollow Agent Chrome extension.
//
// Run:  node site/generate.js
// Output: site/index.html (landing) + site/p/*.html (20 programmatic pages)
//
// Edit the CHROME_WEBSTORE_URL below with your real Chrome Web Store listing URL
// once the extension is published. Until then the button falls back to the
// bundled .zip download for manual (developer-mode) install.

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- config
// TODO: replace with your real Chrome Web Store listing URL.
const CHROME_WEBSTORE_URL = "https://chrome.google.com/webstore/detail/tiktok-unfollow-agent/REPLACE_WITH_REAL_ID";
// Bundled zip (manual / developer-mode install fallback). Copied into site/
// so it's served at /UPLOAD-ME-v1.8.0.zip — works locally and on Vercel.
const ZIP_URL = "/UPLOAD-ME-v1.9.0.zip";
const SITE_TITLE = "TikTok Unfollow Agent";
const BRAND = "TikTok Unfollow Agent";

// ---------------------------------------------------------------- helpers
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------- install button
// Primary: link to Chrome Web Store (opens install dialog).
// Secondary: download the .zip for developer-mode install.
// We also attempt Chrome inline install if the page is served from the
// Web Store's verified origin; otherwise the plain link is the safe path.
function installButton({ primary = "Add to Chrome — Free", secondary = "Download .zip (manual install)" } = {}) {
  return `
    <div class="cta-row">
      <a class="btn btn-primary" href="${CHROME_WEBSTORE_URL}" target="_blank" rel="noopener" id="install-btn">
        <span class="btn-icon" aria-hidden="true">＋</span> ${primary}
      </a>
      <a class="btn btn-secondary" href="${ZIP_URL}" download>
        ${secondary}
      </a>
    </div>
    <p class="cta-note">Free to try · 3 unfollows free · Unlock unlimited for $5 · No account needed</p>
    <script>
      // Best-effort inline install. Only works when this page is served from a
      // verified Web Store owner origin; otherwise the link above still works.
      (function () {
        var btn = document.getElementById('install-btn');
        if (!btn) return;
        if (window.chrome && chrome.webstore && typeof chrome.webstore.install === 'function') {
          btn.addEventListener('click', function (e) {
            try {
              chrome.webstore.install('', function () {}, function (err) {
                // Inline install failed (wrong origin / not verified) -> follow link normally.
                console.warn('Inline install unavailable:', err);
              });
            } catch (_) {}
          });
        }
      })();
    </script>`;
}

// ---------------------------------------------------------------- shared layout
function layout({ title, description, canonical, h1, heroSub, bodyClass = "", extraHead = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/style.css">
  ${extraHead}
</head>
<body class="${bodyClass}">
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/">${BRAND}</a>
      <nav class="site-nav">
        <a href="/#features">Features</a>
        <a href="/#how">How it works</a>
        <a href="/#faq">FAQ</a>
        <a class="nav-cta" href="${CHROME_WEBSTORE_URL}" target="_blank" rel="noopener">Add to Chrome</a>
      </nav>
    </div>
  </header>
  <main>
    <section class="hero">
      <div class="wrap">
        <h1>${h1}</h1>
        <p class="hero-sub">${heroSub}</p>
        ${installButton()}
      </div>
    </section>
`;
}

function footer({ related = [] }) {
  const relatedHtml = related.length
    ? `<nav class="related"><span>Related:</span> ${related
        .map((r) => `<a href="/p/${r.slug}.html">${escapeHtml(r.anchor)}</a>`)
        .join(" ")}</nav>`
    : "";
  return `    ${relatedHtml}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>&copy; ${new Date().getFullYear()} ${BRAND}. Not affiliated with TikTok. Use responsibly and respect TikTok's Terms of Service.</p>
      <p><a href="/">Home</a> · <a href="/#features">Features</a> · <a href="/#faq">FAQ</a> · <a href="${CHROME_WEBSTORE_URL}" target="_blank" rel="noopener">Add to Chrome</a></p>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------- 20 programmatic pages
// Each entry targets a high-intent search query with a strong CTA title tag,
// meta description, H1, and unique supporting copy. Slugs are keyword-rich.
const PAGES = [
  {
    slug: "unfollow-everyone-on-tiktok",
    keyword: "unfollow everyone on tiktok",
    title: "Unfollow Everyone on TikTok in One Click — Free Chrome Extension",
    description: "Unfollow everyone on TikTok fast. One-click bulk unfollow with the TikTok Unfollow Agent Chrome extension. Free to try, unlimited for $5.",
    h1: "Unfollow Everyone on TikTok — In One Click",
    heroSub: "Stop clicking Following → Unfollow 500 times. Run the agent, walk away, come back to a clean list.",
    sections: [
      ["Why people unfollow everyone", "A bloated following list buries the creators you actually watch. Unfollowing everyone lets you rebuild a feed that serves you — not the algorithm's guess. The TikTok Unfollow Agent clicks each Following button, confirms Unfollow, and scrolls to load more, automatically."],
      ["How the one-click unfollow works", "Open tiktok.com/following, click the extension, choose Unfollow all, hit Start. The agent handles the rest with human-ish pacing so you don't trip rate limits. Watch the live progress bar and log."],
      ["Is it safe?", "The extension runs locally in your browser — nothing leaves your machine. Use Dry run first to preview, enable Shuffle to randomize order, and pace yourself to respect TikTok's Terms of Service."],
    ],
  },
  {
    slug: "bulk-unfollow-tiktok",
    keyword: "bulk unfollow tiktok",
    title: "Bulk Unfollow on TikTok — Fast, Safe, One-Click Tool",
    description: "Bulk unfollow on TikTok without clicking each button. The TikTok Unfollow Agent automates the whole list. Free 3 unfollows, unlimited $5.",
    h1: "Bulk Unfollow on TikTok — Without the Click Fatigue",
    heroSub: "Hundreds of accounts. One Start button. The agent clicks, confirms, and scrolls for you.",
    sections: [
      ["The bulk unfollow problem", "TikTok has no native bulk unfollow. You're stuck clicking each row, confirming each dialog. For 800 follows that's 1,600 clicks. The agent does it in one run."],
      ["Pick a count or unfollow all", "Use Unfollow N to trim a batch (say 200), or Unfollow all to clear the list. Shuffle randomizes order so it doesn't always hammer the top of the list."],
      ["What you get", "Manifest V3 extension, no external dependencies, no network calls. Free tier gives 3 unfollows to test. Unlock unlimited for a one-time $5."],
    ],
  },
  {
    slug: "mass-unfollow-tiktok",
    keyword: "mass unfollow tiktok",
    title: "Mass Unfollow on TikTok — Clear Your Following List Fast",
    description: "Mass unfollow on TikTok with one click. Automate the entire following list with the TikTok Unfollow Agent. Free trial, $5 unlimited.",
    h1: "Mass Unfollow on TikTok — Done in One Run",
    heroSub: "Clear hundreds of follows in a single automated pass. You stay in control the whole time.",
    sections: [
      ["Mass unfollow, not mass risk", "Mass actions can trip TikTok's rate limits. The agent uses randomized delays between actions and a Shuffle option so the pattern looks less robotic. Pace yourself and use Dry run first."],
      ["Works on the page and the modal", "The agent runs on /following and on the Following modal opened from any profile. Defensive DOM hunting survives minor TikTok layout changes."],
      ["Stop anytime", "Click Stop to halt immediately. The log shows exactly what was clicked, so you always know where you are."],
    ],
  },
  {
    slug: "tiktok-unfollow-tool",
    keyword: "tiktok unfollow tool",
    title: "The TikTok Unfollow Tool That Actually Works (2026)",
    description: "The best TikTok unfollow tool: one-click, local, no passwords. Free 3 unfollows, $5 unlimited. Chrome extension, Manifest V3.",
    h1: "The TikTok Unfollow Tool That Actually Works",
    heroSub: "No shady web app. No login. No password. Just a Chrome extension that clicks the buttons for you.",
    sections: [
      ["Why most unfollow tools are risky", "Web-based unfollowers ask for your TikTok login. That's a credential leak waiting to happen. This extension never asks for a password — it runs in your own logged-in browser tab."],
      ["What makes this tool different", "Local-only, Manifest V3, zero network calls, zero dependencies. Dry run mode, Shuffle, Debug mode, live progress, and a Stop button. Free to try."],
      ["Get it now", "Add to Chrome, open your following list, hit Start. Three unfollows free; unlock unlimited for a one-time $5."],
    ],
  },
  {
    slug: "tiktok-unfollow-app",
    keyword: "tiktok unfollow app",
    title: "TikTok Unfollow App — Chrome Extension (No Login, No Password)",
    description: "A TikTok unfollow app that lives in your browser. No login, no password, no servers. Free trial + $5 unlimited unlock.",
    h1: "A TikTok Unfollow App That Lives in Your Browser",
    heroSub: "Not a web app that wants your password. A Chrome extension that uses the session you already have.",
    sections: [
      ["Apps vs. extensions", "Mobile apps can't automate TikTok's web UI. Web apps want your credentials. A Chrome extension sits inside the page you're already logged into — no password ever leaves your hands."],
      ["Install in 30 seconds", "Add to Chrome, pin it, open tiktok.com/following, click the icon, hit Start. That's the whole onboarding."],
      ["Pricing", "Free tier: 3 unfollows. Unlimited: one-time $5 via Stripe. No subscription, no recurring charge."],
    ],
  },
  {
    slug: "how-to-unfollow-everyone-on-tiktok",
    keyword: "how to unfollow everyone on tiktok",
    title: "How to Unfollow Everyone on TikTok (2026 Guide + Free Tool)",
    description: "Step-by-step how to unfollow everyone on TikTok. Plus a free Chrome extension that does it for you. No password, local-only.",
    h1: "How to Unfollow Everyone on TikTok — The Fast Way",
    heroSub: "The manual way takes hours. The agent way takes one click. Here's both.",
    sections: [
      ["The manual method", "Open tiktok.com/following, click Following on each row, click Unfollow in the dialog, scroll, repeat. For 500 follows: ~1,600 clicks and an hour of your life."],
      ["The fast method", "Install the TikTok Unfollow Agent, open /following, choose Unfollow all, click Start. The agent clicks, confirms, and scrolls automatically with human-ish pacing."],
      ["Step-by-step", "1) Add to Chrome. 2) Open tiktok.com/following. 3) Click the extension icon. 4) Pick Unfollow all (or Unfollow N). 5) Optional: Shuffle, Dry run. 6) Start. 7) Watch the log. 8) Stop anytime."],
    ],
  },
  {
    slug: "unfollow-all-tiktok",
    keyword: "unfollow all tiktok",
    title: "Unfollow All on TikTok — One-Click Chrome Extension",
    description: "Unfollow all on TikTok in one click. The TikTok Unfollow Agent clears your whole following list automatically. Free trial, $5 unlimited.",
    h1: "Unfollow All on TikTok — One Click, Whole List",
    heroSub: "Pick Unfollow all, hit Start, come back to a clean following list.",
    sections: [
      ["Unfollow all vs. unfollow N", "Unfollow all keeps going until the list is exhausted. Unfollow N stops after a count you set — useful for pacing over several days."],
      ["Don't get rate-limited", "Enable Shuffle and let the agent's randomized delays do their job. Run in batches across days if your list is huge. Dry run first to preview."],
      ["Start free", "Three unfollows on the house. Unlock unlimited for a one-time $5 — no subscription."],
    ],
  },
  {
    slug: "tiktok-following-cleaner",
    keyword: "tiktok following cleaner",
    title: "TikTok Following Cleaner — Trim Your List Automatically",
    description: "Clean your TikTok following list automatically. Remove inactive or unwanted follows in bulk. Free Chrome extension, $5 unlimited.",
    h1: "TikTok Following Cleaner — Trim the Noise Automatically",
    heroSub: "A following list full of accounts you never watch? Clean it in one run.",
    sections: [
      ["Why clean your following list", "Every follow you don't act on tells the algorithm you're fine with that content. Cleaning your list retunes your feed to what you actually want."],
      ["Clean in bulk", "Unfollow N lets you trim 100, 200, 500 at a time. Shuffle spreads the action across the list instead of always hitting the top."],
      ["Local and private", "Runs in your browser. No servers see your list. No password required."],
    ],
  },
  {
    slug: "tiktok-unfollow-tracker",
    keyword: "tiktok unfollow tracker",
    title: "TikTok Unfollow Tracker + Tool — See & Clear Your Follows",
    description: "Track and clear your TikTok follows. The agent logs every action so you always know what was unfollowed. Free trial, $5 unlimited.",
    h1: "TikTok Unfollow Tracker + Cleaner in One",
    heroSub: "Every unfollow is logged with the account name. You always know exactly what happened.",
    sections: [
      ["A log you can trust", "The popup's scrolling log records each unfollow as it happens. No guessing, no mystery stops. Scroll back to audit any run."],
      ["Track then clean", "Watch the log to see who's on your list, then let the agent clean the ones you don't want. Stop anytime to keep the rest."],
      ["Debug mode", "Turn on Debug mode for extra diagnostic logs — handy when TikTok changes their markup and you need to tune selectors."],
    ],
  },
  {
    slug: "remove-tiktok-followers",
    keyword: "remove tiktok followers",
    title: "Remove TikTok Follows in Bulk — Free Chrome Extension",
    description: "Remove TikTok follows in bulk. One-click bulk removal with the TikTok Unfollow Agent. Local, no password. Free trial, $5 unlimited.",
    h1: "Remove TikTok Follows in Bulk — Not One by One",
    heroSub: "Removing follows one at a time is a chore. Bulk-remove them with one Start click.",
    sections: [
      ["Remove follows, keep control", "You pick the count or unfollow all. The agent never does anything you didn't ask for. Stop halts instantly."],
      ["No password, ever", "The extension uses your existing logged-in TikTok tab. It never sees or stores your password."],
      ["Try it free", "Three unfollows free. Like it? Unlock unlimited for a one-time $5."],
    ],
  },
  {
    slug: "delete-tiktok-following",
    keyword: "delete tiktok following",
    title: "Delete Your TikTok Following List — One-Click Tool",
    description: "Delete your TikTok following list in one click. The agent clears every follow automatically. Free trial, $5 unlimited unlock.",
    h1: "Delete Your TikTok Following List — In One Run",
    heroSub: "Want a fresh start? Delete the whole following list and rebuild your feed from scratch.",
    sections: [
      ["Fresh start", "Deleting your following list resets the algorithm's model of you. Re-follow only the creators you actually love."],
      ["How to delete it", "Add to Chrome → open /following → Unfollow all → Start. The agent deletes each follow with a confirm click and auto-scroll."],
      ["Pace it", "For huge lists, run Unfollow N in batches over a few days. Shuffle + randomized delays keep the pattern human-ish."],
    ],
  },
  {
    slug: "tiktok-unfollow-bot",
    keyword: "tiktok unfollow bot",
    title: "TikTok Unfollow Bot — Safe, Local, No Password",
    description: "A TikTok unfollow bot that runs in your browser — no password, no servers. Free 3 unfollows, $5 unlimited. Chrome extension.",
    h1: "A TikTok Unfollow Bot That Doesn't Want Your Password",
    heroSub: "Most bots are cloud services that need your login. This one runs on the page you already logged into.",
    sections: [
      ["Bot, not cloud", "Cloud bots store your credentials and act on your behalf from their IPs — easy to detect and risky. A browser bot acts from your own session at your own pace."],
      ["Human-ish pacing", "Randomized delays between clicks plus optional Shuffle make the bot's pattern look less robotic. You control the speed by batching."],
      ["Free to try", "Three unfollows free. Unlimited is a one-time $5 — no subscription, no recurring bot fee."],
    ],
  },
  {
    slug: "auto-unfollow-tiktok",
    keyword: "auto unfollow tiktok",
    title: "Auto Unfollow on TikTok — Automate the Whole List",
    description: "Auto unfollow on TikTok with one click. The agent automates clicking, confirming, and scrolling. Free trial, $5 unlimited.",
    h1: "Auto Unfollow on TikTok — Automate the Boring Part",
    heroSub: "Clicking Following → Unfollow 800 times is not a good use of a human. Let the agent do it.",
    sections: [
      ["What automation handles", "Finding visible Following buttons, clicking one, waiting for the confirm dialog, clicking Unfollow, scrolling to load more, repeating. All automatic."],
      ["What you still control", "Mode (N or all), Shuffle, Dry run, Debug, Start, Stop. You're the supervisor, not the clicker."],
      ["Free + paid", "Free tier: 3 auto-unfollows. Unlimited: one-time $5."],
    ],
  },
  {
    slug: "tiktok-unfollow-extension",
    keyword: "tiktok unfollow extension",
    title: "TikTok Unfollow Extension — Add to Chrome (Free)",
    description: "The TikTok unfollow extension for Chrome. Manifest V3, local-only, no password. Free 3 unfollows, $5 unlimited unlock.",
    h1: "The TikTok Unfollow Extension for Chrome",
    heroSub: "A Manifest V3 extension that lives in your toolbar and clears your following list on demand.",
    sections: [
      ["Manifest V3, future-proof", "Built on the current Chrome extension standard. No legacy manifest issues, no deprecation warnings."],
      ["Zero dependencies", "No external libraries, no network calls. The extension does its work entirely in your browser tab."],
      ["Install", "Add to Chrome from the Web Store, or download the .zip and load it unpacked in developer mode."],
    ],
  },
  {
    slug: "free-tiktok-unfollow-tool",
    keyword: "free tiktok unfollow tool",
    title: "Free TikTok Unfollow Tool — 3 Unfollows Free, $5 Unlimited",
    description: "A genuinely free TikTok unfollow tool. Try 3 unfollows free, no card. Unlock unlimited for a one-time $5. Chrome extension.",
    h1: "A Genuinely Free TikTok Unfollow Tool",
    heroSub: "Try it free — 3 unfollows, no credit card, no signup. Like it? Unlock unlimited for $5.",
    sections: [
      ["Free means free", "No trial timer, no card required. You get 3 real unfollows to test the whole flow end-to-end. The free count is stored locally in your browser."],
      ["Unlock when you're ready", "Hit the cap? Pay $5 once via Stripe Checkout and get a unique unlock key. Paste it in the popup — unlimited forever. No subscription."],
      ["Why free first", "You should know a tool works before you pay for it. The free tier lets you verify it on your actual following list."],
    ],
  },
  {
    slug: "tiktok-unfollow-chrome-extension",
    keyword: "tiktok unfollow chrome extension",
    title: "TikTok Unfollow Chrome Extension — Add to Chrome Free",
    description: "The TikTok unfollow Chrome extension. Local, no password, Manifest V3. Free 3 unfollows, $5 unlimited. Add to Chrome now.",
    h1: "TikTok Unfollow Chrome Extension",
    heroSub: "Built for Chrome, runs in your tab, never asks for your password.",
    sections: [
      ["Chrome-native", "Pinned to your toolbar, opens on tiktok.com/following, talks to the content script on the active tab. Standard Chrome extension behavior."],
      ["Permissions", "Only what's needed: script injection on tiktok.com and local storage for the free-tier count. No broad host permissions, no telemetry."],
      ["Add it", "One click from the Chrome Web Store, or load unpacked from the .zip in developer mode."],
    ],
  },
  {
    slug: "unfollow-inactive-tiktok-accounts",
    keyword: "unfollow inactive tiktok accounts",
    title: "Unfollow Inactive TikTok Accounts — Clean Your List",
    description: "Unfollow inactive TikTok accounts in bulk. Clear dead follows and retune your feed. Free Chrome extension, $5 unlimited.",
    h1: "Unfollow Inactive TikTok Accounts — Clean the Dead Weight",
    heroSub: "Inactive follows skew your feed. Clear them in bulk and watch what you actually want.",
    sections: [
      ["Why inactive follows hurt", "Accounts that stopped posting still count toward your following number and influence the algorithm's picture of your tastes. Removing them sharpens your feed."],
      ["Bulk-remove the dead weight", "Scroll your list, spot the inactive ones, and let the agent unfollow them in a batch with Unfollow N. Shuffle spreads the removals across the list."],
      ["Safe and local", "Runs in your browser, no password, no servers. Free 3 unfollows to start."],
    ],
  },
  {
    slug: "clean-tiktok-following-list",
    keyword: "clean tiktok following list",
    title: "Clean Your TikTok Following List — One-Click Tool",
    description: "Clean your TikTok following list in one click. Remove unwanted follows in bulk. Free Chrome extension, $5 unlimited.",
    h1: "Clean Your TikTok Following List — In One Click",
    heroSub: "A messy following list makes a messy feed. Clean it in a single automated run.",
    sections: [
      ["The cleanup workflow", "Open /following → extension → Unfollow N (say 200) → Shuffle on → Start. Come back to a tighter list. Repeat over a few days for huge lists."],
      ["Dry run first", "New to the tool? Enable Dry run to see exactly what it would click — no actual unfollows — before you commit."],
      ["Free to try", "Three unfollows free. Unlimited for a one-time $5."],
    ],
  },
  {
    slug: "tiktok-following-manager",
    keyword: "tiktok following manager",
    title: "TikTok Following Manager — Bulk Manage Your Follows",
    description: "A TikTok following manager that bulk-removes follows with one click. Local, no password. Free trial, $5 unlimited.",
    h1: "A TikTok Following Manager That Actually Manages",
    heroSub: "TikTok gives you no tools to manage your follows in bulk. This extension does.",
    sections: [
      ["Manage, don't just unfollow", "Pick a count, shuffle the order, dry-run the plan, then execute. You're managing the list, not blindly nuking it."],
      ["Live oversight", "Progress bar, counter, and scrolling log keep you in the loop. Stop halts instantly if you change your mind."],
      ["Local and private", "No password, no servers, no telemetry. Your following list never leaves your browser."],
    ],
  },
  {
    slug: "fast-tiktok-unfollower",
    keyword: "fast tiktok unfollower",
    title: "Fast TikTok Unfollower — Clear Hundreds in One Run",
    description: "A fast TikTok unfollower that clears hundreds of follows in one automated run. Free 3 unfollows, $5 unlimited. Chrome extension.",
    h1: "A Fast TikTok Unfollower — Hundreds in One Run",
    heroSub: "Fast doesn't mean reckless. The agent clicks, confirms, and scrolls at human-ish speed so you don't trip limits.",
    sections: [
      ["Fast vs. safe", "Pure speed gets you rate-limited. The agent's randomized delays are fast enough to save you an hour, slow enough to look human. The sweet spot."],
      ["How fast is it?", "Depends on your list size and how aggressively you batch. Most users clear a few hundred follows in a single session. Use Unfollow N to pace over days for huge lists."],
      ["Start fast, free", "Three unfollows free right now. Unlimited for $5."],
    ],
  },
];

// ---------------------------------------------------------------- landing page
function landingPage() {
  const features = [
    ["One-click bulk unfollow", "Unfollow N or Unfollow all. The agent clicks, confirms, and scrolls for you."],
    ["Works on page & modal", "Runs on /following and on the Following modal from any profile."],
    ["Dry run mode", "Preview exactly what would be clicked — no actual unfollows."],
    ["Shuffle", "Randomize order so it doesn't always hammer the top of the list."],
    ["Human-ish pacing", "Randomized delays between actions to look less robotic."],
    ["Live progress + log", "Progress bar, counter, and scrolling log of every action."],
    ["Local & private", "No password, no servers, no telemetry. Runs in your browser."],
    ["Free + $5 unlimited", "3 unfollows free. Unlock unlimited with a one-time $5 — no subscription."],
  ];

  const steps = [
    ["Add to Chrome", "Install from the Chrome Web Store or load the .zip unpacked in developer mode."],
    ["Open your following list", "Go to tiktok.com/following, or open the Following modal from any profile."],
    ["Pick a mode", "Unfollow N for a batch, or Unfollow all for the whole list. Toggle Shuffle / Dry run."],
    ["Hit Start", "Watch the live log. Stop anytime. Done."],
  ];

  const faqs = [
    ["Is this safe for my account?", "Bulk actions can trip TikTok's rate limits. The agent uses randomized delays and a Shuffle option to look less robotic. Use Dry run first, pace yourself across days for huge lists, and respect TikTok's Terms of Service. You're responsible for how you use it."],
    ["Does it need my TikTok password?", "No. It runs in your already-logged-in browser tab. It never sees or stores your password."],
    ["Is it really free?", "Yes — 3 unfollows free, no card, no signup. Unlock unlimited for a one-time $5 via Stripe. No subscription, no recurring charge."],
    ["Where does it work?", "On tiktok.com/following and on the Following modal opened from any profile. Chrome only (Manifest V3)."],
    ["What if TikTok changes their layout?", "The agent uses defensive DOM hunting with multiple selectors, so it survives minor changes. Debug mode exposes extra logs to help tune selectors if needed."],
    ["Does anything leave my browser?", "No. The extension makes no network calls. The billing server only handles Stripe Checkout and unlock-key verification."],
  ];

  const featuresHtml = features
    .map(
      ([t, d]) => `
      <div class="feature">
        <h3>${escapeHtml(t)}</h3>
        <p>${escapeHtml(d)}</p>
      </div>`
    )
    .join("");

  const stepsHtml = steps
    .map(
      ([t, d], i) => `
      <div class="step">
        <div class="step-num">${i + 1}</div>
        <div>
          <h3>${escapeHtml(t)}</h3>
          <p>${escapeHtml(d)}</p>
        </div>
      </div>`
    )
    .join("");

  const faqsHtml = faqs
    .map(
      ([q, a]) => `
      <details class="faq">
        <summary>${escapeHtml(q)}</summary>
        <p>${escapeHtml(a)}</p>
      </details>`
    )
    .join("");

  // Top programmatic pages for internal linking / SEO.
  const topPages = PAGES.slice(0, 12).map((p) => ({
    slug: p.slug,
    anchor: p.keyword,
  }));
  const popularHtml = topPages
    .map(
      (p) =>
        `<li><a href="/p/${p.slug}.html">${escapeHtml(p.anchor)}</a></li>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TikTok Unfollow Agent — Bulk Unfollow on TikTok in One Click (Free)</title>
  <meta name="description" content="Bulk unfollow on TikTok in one click. Local Chrome extension, no password, no servers. Free 3 unfollows, $5 unlimited. Manifest V3.">
  <link rel="canonical" href="/">
  <meta property="og:title" content="TikTok Unfollow Agent — Bulk Unfollow in One Click">
  <meta property="og:description" content="Local Chrome extension. No password. Free trial + $5 unlimited.">
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/">${BRAND}</a>
      <nav class="site-nav">
        <a href="#features">Features</a>
        <a href="#how">How it works</a>
        <a href="#faq">FAQ</a>
        <a class="nav-cta" href="${CHROME_WEBSTORE_URL}" target="_blank" rel="noopener">Add to Chrome</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero hero-home">
      <div class="wrap">
        <span class="eyebrow">Chrome Extension · Manifest V3 · Local-only</span>
        <h1>Bulk Unfollow on TikTok — In One Click</h1>
        <p class="hero-sub">Stop clicking Following → Unfollow 800 times. The TikTok Unfollow Agent clicks, confirms, and scrolls for you — right in your browser, no password, no servers.</p>
        ${installButton({ primary: "Add to Chrome — Free", secondary: "Download .zip (manual install)" })}
        <ul class="hero-badges">
          <li>No password</li>
          <li>No servers</li>
          <li>No subscription</li>
          <li>Free to try</li>
        </ul>
      </div>
    </section>

    <section id="features" class="section">
      <div class="wrap">
        <h2>Everything you need to clean your following list</h2>
        <div class="features-grid">
          ${featuresHtml}
        </div>
      </div>
    </section>

    <section id="how" class="section section-alt">
      <div class="wrap">
        <h2>How it works</h2>
        <div class="steps">
          ${stepsHtml}
        </div>
      </div>
    </section>

    <section class="section cta-band">
      <div class="wrap cta-band-inner">
        <h2>Ready to clean your TikTok following list?</h2>
        <p>Free to try. Unlimited for a one-time $5. No subscription.</p>
        ${installButton({ primary: "Add to Chrome — Free", secondary: "Download .zip" })}
      </div>
    </section>

    <section id="faq" class="section">
      <div class="wrap">
        <h2>Frequently asked questions</h2>
        <div class="faqs">
          ${faqsHtml}
        </div>
      </div>
    </section>

    <section class="section section-alt">
      <div class="wrap">
        <h2>Popular unfollow guides</h2>
        <ul class="popular-list">
          ${popularHtml}
        </ul>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>&copy; ${new Date().getFullYear()} ${BRAND}. Not affiliated with TikTok. Use responsibly and respect TikTok's Terms of Service.</p>
      <p><a href="/">Home</a> · <a href="#features">Features</a> · <a href="#faq">FAQ</a> · <a href="${CHROME_WEBSTORE_URL}" target="_blank" rel="noopener">Add to Chrome</a></p>
    </div>
  </footer>
  <script>
    (function () {
      var btn = document.getElementById('install-btn');
      if (btn && window.chrome && chrome.webstore && typeof chrome.webstore.install === 'function') {
        btn.addEventListener('click', function (e) {
          try { chrome.webstore.install('', function(){}, function(err){ console.warn('Inline install unavailable:', err); }); } catch (_) {}
        });
      }
    })();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------- programmatic page builder
function buildProgrammaticPage(p) {
  const sectionsHtml = p.sections
    .map(
      ([h, body]) => `
      <section class="section">
        <div class="wrap">
          <h2>${escapeHtml(h)}</h2>
          <p>${escapeHtml(body)}</p>
        </div>
      </section>`
    )
    .join("");

  // Mid-page CTA band.
  const midCta = `
    <section class="section cta-band">
      <div class="wrap cta-band-inner">
        <h2>${escapeHtml(p.h1)} — start free</h2>
        <p>Free 3 unfollows. Unlimited for a one-time $5. No subscription.</p>
        ${installButton({ primary: "Add to Chrome — Free", secondary: "Download .zip" })}
      </div>
    </section>`;

  // Related pages (3) for internal linking.
  const related = PAGES.filter((x) => x.slug !== p.slug)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((x) => ({ slug: x.slug, anchor: x.keyword }));

  const canonical = `/p/${p.slug}.html`;

  return (
    layout({
      title: p.title,
      description: p.description,
      canonical,
      h1: p.h1,
      heroSub: p.heroSub,
      bodyClass: "page-prog",
    }) +
    sectionsHtml +
    midCta +
    footer({ related })
  );
}

// ---------------------------------------------------------------- write everything
const OUT_DIR = path.join(__dirname);
const PAGES_DIR = path.join(OUT_DIR, "p");

fs.mkdirSync(PAGES_DIR, { recursive: true });

// Landing page.
fs.writeFileSync(path.join(OUT_DIR, "index.html"), landingPage(), "utf8");

// Programmatic pages.
let count = 0;
for (const p of PAGES) {
  const html = buildProgrammaticPage(p);
  fs.writeFileSync(path.join(PAGES_DIR, `${p.slug}.html`), html, "utf8");
  count++;
}

// sitemap.xml for SEO.
const urls = [
  `<url><loc>/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  ...PAGES.map(
    (p) =>
      `<url><loc>/p/${p.slug}.html</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>`
  ),
].join("\n");
fs.writeFileSync(
  path.join(OUT_DIR, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  "utf8"
);

// robots.txt
fs.writeFileSync(
  path.join(OUT_DIR, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n",
  "utf8"
);

console.log(`Generated ${count} programmatic pages + landing + sitemap + robots in ${OUT_DIR}`);
