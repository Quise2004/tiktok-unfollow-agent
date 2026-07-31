# TikTok Unfollow Agent (Chrome Extension)

A small, local-only Chrome extension that automates clicking **Following → Unfollow**
on your TikTok following list. You stay in control: pick a target count or unfollow all,
optionally randomize order, and watch progress in the popup. Nothing leaves your browser.

> **Use responsibly.** Bulk actions can trip TikTok's rate limits and may risk your
> account. Pace yourself, use the dry-run mode first, and respect TikTok's Terms of
> Service. You are responsible for how you use this tool.

## Features

- Manifest V3 Chrome extension (no external dependencies, no network calls).
- Two modes: **Unfollow N** (a specific count) or **Unfollow all**.
- Works on the `/following` page **and** on the Following modal opened from any profile.
- **Free tier:** 3 unfollows. Unlock unlimited mode to remove the cap.
- **Dry run** mode logs what it would do without clicking.
- **Shuffle** option to randomize order so it doesn't always hit the top of the list.
- **Debug mode** exposes extra diagnostic logs to help tune selectors.
- Live progress bar, counter, and scrolling log in the popup.
- Defensive DOM hunting — survives minor TikTok layout changes via multiple selectors.
- Human-ish pacing (randomized delays) between actions.

## Install (developer mode)

1. Download or clone this folder so you have `C:\Users\ja348\tiktok-unfollow-agent\`
   with `manifest.json` inside it.
2. Open Chrome and go to `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `tiktok-unfollow-agent` folder.
5. The TikTok Unfollow Agent icon appears in your toolbar. (On install it tries to
   open `https://www.tiktok.com/following` for you.)

## Use

1. Log in to TikTok in Chrome and either:
   - open `https://www.tiktok.com/following`, **or**
   - open a profile and click its **Following** count to open the modal (like your screenshot).
2. Click the extension icon.
3. The status line should say **Ready on following list**. If it says to reload,
   refresh the TikTok tab and reopen the popup.
4. Choose a mode:
   - **Unfollow N** — enter how many accounts to unfollow.
   - **Unfollow all** — keep going until the list is exhausted.
5. (Optional) toggle **Shuffle**, **Dry run**, or **Debug mode**.
6. Click **Start**. Watch the progress bar and log. Click **Stop** anytime.

## How it works

- `manifest.json` — extension metadata, permissions, entry points.
- `popup.html` / `popup.js` — the toolbar UI; sends `START` / `STOP` / `PING`
  messages to the content script on the active TikTok tab. Also manages the
  free-tier quota and unlock state.
- `content.js` — injected on `tiktok.com`. The "agent": finds visible
  **Following** buttons, clicks one, waits for the confirm dialog, clicks
  **Unfollow**, scrolls to load more, and reports `PROGRESS` / `LOG` / `DONE`
  back to the popup. Enforces the free-tier cap.
- `background.js` — minimal service worker; opens the following page on install.
- `server.js` — Express + Stripe billing server. Creates Checkout sessions,
  verifies payments, and stores unlock keys in SQLite.
- `icons/` — generated PNG icons (see `generate-icons.js`).

## Free tier & unlocking unlimited

- Free users can unfollow **3 accounts** total (stored in `chrome.storage.local`).
- The popup shows how many are left, a **Buy unlimited unlock — $5** button, and
  a **Verify key** field.
- Payments go through Stripe Checkout. The server issues a unique unlock key
  only after the Checkout session is `paid`.

## Run the billing server

1. Create a Stripe product + price at <https://dashboard.stripe.com/products>
   for $5. Copy the **Price ID** (`price_...`).
2. Copy `.env.example` to `.env` and fill in your **new** keys:
   - `STRIPE_SECRET_KEY` — your **new** secret key (rotate the leaked one)
   - `STRIPE_PUBLISHABLE_KEY` — publishable key
   - `STRIPE_PRICE_ID` — the price ID from step 1
   - `BILLING_SERVER_URL` — `http://localhost:4242` for local testing
   - `CORS_ORIGIN` — `*` for local testing; restrict to your extension origin in production
3. Install dependencies and start:
   ```bash
   npm install
   npm start
   ```
   For production, run it with `pm2`, `systemd`, or Docker so it stays up forever.
4. The extension popup is already configured to call `http://localhost:4242`.
   Change `BILLING_SERVER_URL` in `popup.js` to your production HTTPS URL.

## Production checklist

- Rotate the Stripe secret key that was leaked in chat.
- Restrict `CORS_ORIGIN` to your Chrome extension ID (`chrome-extension://YOUR_ID`).
- Serve the billing server over HTTPS.
- Keep `.env` and `billing.db` out of git (already ignored by `.gitignore`).
- Add rate limiting and input validation to `server.js` before taking real payments.
- Consider Stripe webhook verification for stronger payment guarantees.

## Regenerate icons

```bash
node generate-icons.js
```

Requires Node.js. Writes `icons/icon{16,32,48,128}.png`.

## Troubleshooting

- **Popup says "Reload the TikTok tab"** — the content script wasn't ready.
  Refresh the TikTok tab, then reopen the popup.
- **No confirm dialog appears** — TikTok changed their dialog markup. The agent
  will skip that row and continue; check the log. You may need to update the
  selectors in `findConfirmUnfollowButton()` in `content.js`.
- **It stops early** — the list didn't load more rows. Scroll the modal/page
  manually once, then click Start again.
- **Buttons not found** — enable **Debug mode** and check the log. Make sure the
  Following modal/page is visible and you're logged in.

## Disclaimer

This project is for personal, educational use. Automating TikTok actions may
violate TikTok's Terms of Service. The author is not affiliated with TikTok and
accepts no responsibility for any consequences of using this extension.
