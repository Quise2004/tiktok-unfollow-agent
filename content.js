// content.js — runs on tiktok.com pages.
// The "agent": finds Following buttons, clicks them, confirms the unfollow
// dialog, scrolls to load more, and reports progress to the popup.
//
// Defensive by design: TikTok's DOM changes frequently, so we use multiple
// selector strategies and heuristics rather than a single brittle selector.

(() => {
  if (window.__ttUnfollowInjected) return;
  window.__ttUnfollowInjected = true;

  // Build stamp — logged on start so stale/cached code is obvious.
  const AGENT_BUILD = "1.8.0";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

  const state = {
    running: false,
    stopRequested: false,
    done: 0,
    target: 0,
    mode: "count",
    opts: { shuffle: true, dryRun: false, debug: false },
    lastLog: "",
    onFollowingPage: /\/following\b/i.test(location.pathname + location.search) || hasFollowingModal(),
    quota: { used: 0, unlimited: false },
  };

  function debugLog(text) {
    if (state.opts.debug) log("[debug] " + text);
  }

  // ---------------------------------------------------------------- billing / quota
  const FREE_TIER_LIMIT = 5;

  async function loadQuota() {
    try {
      const data = await chrome.storage.local.get(["unfollowCount", "unlimitedUnlocked"]);
      state.quota.used = parseInt(data.unfollowCount, 10) || 0;
      state.quota.unlimited = !!data.unlimitedUnlocked;
    } catch (_) {
      state.quota.used = 0;
      state.quota.unlimited = false;
    }
  }

  async function saveQuota() {
    try {
      await chrome.storage.local.set({
        unfollowCount: state.quota.used,
        unlimitedUnlocked: state.quota.unlimited,
      });
    } catch (_) {}
  }

  function remainingFree() {
    return Math.max(0, FREE_TIER_LIMIT - state.quota.used);
  }

  async function consumeUnfollow() {
    if (state.quota.unlimited) return { ok: true };
    await loadQuota();
    if (state.quota.used >= FREE_TIER_LIMIT) {
      return { ok: false, reason: "free_tier_exhausted" };
    }
    state.quota.used += 1;
    await saveQuota();
    return { ok: true, remaining: remainingFree() };
  }

  // ---------------------------------------------------------------- helpers
  function log(text, cls) {
    state.lastLog = text;
    try {
      chrome.runtime.sendMessage({
        source: "tt-unfollow",
        type: "LOG",
        text,
        cls: cls || "",
      });
    } catch (_) {}
  }

  function sendProgress() {
    try {
      chrome.runtime.sendMessage({
        source: "tt-unfollow",
        type: "PROGRESS",
        done: state.done,
        target: state.target || state.done,
      });
    } catch (_) {}
  }

  function sendDone(reason) {
    state.running = false;
    try {
      chrome.runtime.sendMessage({
        source: "tt-unfollow",
        type: "DONE",
        done: state.done,
        reason,
      });
    } catch (_) {}
  }

  function setStatus(text, cls) {
    try {
      chrome.runtime.sendMessage({ source: "tt-unfollow", type: "STATUS", text, cls });
    } catch (_) {}
  }

  // ---------------------------------------------------------------- DOM hunting
  // We scope everything to the "following card" — the container on your
  // profile that lists accounts you follow (the /following page or the
  // following modal). We then only click buttons whose visible text is
  // EXACTLY "Following" (case-insensitive). Anything else ("Follow",
  // "Follow back", "Requested", "Unfollow", "") is ignored.

  // Strict match: the button's own text is just "Following".
  // We use the button's direct text (not descendants) so a button that
  // contains "Following" plus an icon label still counts only if its
  // trimmed text is exactly "Following".
  const FOLLOWING_TEXT_RE = /^\s*following\s*$/i;

  // Texts we must NEVER click — these are not "you are following them".
  const REJECT_TEXT_RE = /^\s*(unfollow|follow\b|follow\s*back|requested|following[^a-z]|pending)\b/i;

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function textOf(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  // Direct text of an element (excluding child element text), trimmed.
  // Used so a button wrapping an icon + label still matches "Following"
  // only when its own textual content is exactly that word.
  function directTextOf(el) {
    let s = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) s += node.textContent;
    }
    return s.trim();
  }

  // ---------------------------------------------------------------- the card
  // Locate the "following card" — the container on the /following page or the
  // profile modal that lists accounts you follow.
  function findFollowingCard() {
    // 1) Modal opened from a profile. It has tabs like
    //    "Following 170", "Followers 9167", "Friends 0", "Suggested".
    //    OR it simply contains "Following" buttons.
    const allDialogs = Array.from(
      document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="dialog" i]')
    ).filter(isVisible);
    for (const d of allDialogs) {
      const text = textOf(d);
      const hasTabs = /(following\s*\d+|followers\s*\d+|friends\s*\d+|suggested)/i.test(text);
      const hasButtons = countFollowingButtons(d) >= 1;
      if (hasTabs || hasButtons) {
        // Return the dialog itself (or its body if we can find one).
        const body = d.querySelector('[class*="modal-body" i], [class*="content" i], [class*="body" i]') || d;
        return body;
      }
    }

    // 2) TikTok's data-e2e hooks on the /following page.
    const e2eContainer = document.querySelector(
      '[data-e2e*="following-list" i], [data-e2e*="following-container" i], ' +
      '[data-e2e*="following-modal" i], [data-e2e*="following-page" i]'
    );
    if (e2eContainer && isVisible(e2eContainer)) return e2eContainer;

    // 3) A visible container with the most "Following" buttons.
    const candidates = Array.from(
      document.querySelectorAll(
        '[class*="following" i], [class*="follow-list" i], ' +
        '[role="list"], main, [class*="modal-body" i], [class*="scroll" i]'
      )
    ).filter(isVisible);

    let best = null, bestCount = 0;
    for (const c of candidates) {
      const count = countFollowingButtons(c);
      if (count > bestCount) { best = c; bestCount = count; }
    }
    if (best && bestCount >= 1) return best;

    // 4) Fallback: whole document (still filtered by exact button text).
    return document;
  }

  // Count how many visible buttons inside a root have exactly "Following" text.
  function countFollowingButtons(root) {
    let n = 0;
    const nodes = root.querySelectorAll('button, [role="button"]');
    for (const b of nodes) {
      if (isVisible(b) && FOLLOWING_TEXT_RE.test(textOf(b))) n++;
    }
    return n;
  }

  // Find buttons that say EXACTLY "Following", scoped to the following card.
  // We no longer require a "user row" class wrapper — TikTok's modal rows
  // often use generic generated class names. As long as the button is inside
  // the detected following card and its visible text is exactly "Following",
  // we treat it as a target.
  function findFollowingButtons() {
    const card = findFollowingCard();
    const candidates = [];

    // Query all likely clickable elements inside the card.
    const nodes = card.querySelectorAll(
      'button, [role="button"], a[data-e2e], div[data-e2e]'
    );

    for (const b of nodes) {
      if (!isVisible(b)) continue;
      const t = textOf(b);
      const dt = directTextOf(b);
      if (!t) continue;

      // Strict: text must be exactly "Following". The header tab says
      // "Following 170", so it won't match. "Friends" won't match.
      if (FOLLOWING_TEXT_RE.test(t) || FOLLOWING_TEXT_RE.test(dt)) {
        candidates.push(b);
      }
    }

    // De-duplicate by bounding box position.
    const seen = new Set();
    const unique = [];
    for (const c of candidates) {
      const r = c.getBoundingClientRect();
      const key = `${Math.round(r.top)}_${Math.round(r.left)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(c);
    }
    return unique;
  }

  // The confirm dialog after clicking "Following" usually has an "Unfollow"
  // button. We look for a modal/dialog container and an unfollow action.
  // Only accept a button whose text is exactly "Unfollow" — not "Cancel",
  // not "Following", not a header label.
  function findConfirmUnfollowButton() {
    const UNFOLLOW_RE = /^\s*unfollow\s*$/i;
    const dialogs = document.querySelectorAll(
      '[role="dialog"], [class*="modal" i], [class*="dialog" i], [class*="confirm" i], [class*="popover" i]'
    );
    const searchRoots = dialogs.length ? Array.from(dialogs).filter(isVisible) : [document];

    for (const root of searchRoots) {
      const nodes = root.querySelectorAll('button, [role="button"], a');
      for (const n of nodes) {
        if (!isVisible(n)) continue;
        const t = textOf(n);
        if (UNFOLLOW_RE.test(t)) return n;
      }
    }
    return null;
  }

  function dismissStrayDialogs() {
    // Sometimes a tooltip or stray popup lingers. Try to click any visible
    // "Cancel" button inside a dialog to clean up.
    const cancels = document.querySelectorAll(
      '[role="dialog"] button, [role="dialog"] [role="button"]'
    );
    for (const c of cancels) {
      if (!isVisible(c)) continue;
      if (/cancel/i.test(textOf(c))) {
        try { c.click(); } catch (_) {}
        return true;
      }
    }
    return false;
  }

  // Detect whether the profile "Following" modal is currently open.
  function hasFollowingModal() {
    const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="dialog" i]');
    for (const d of dialogs) {
      if (!isVisible(d)) continue;
      const text = textOf(d);
      // Pattern 1: tab headers like "Following 170 / Followers 9167".
      if (/(following\s*\d+|followers\s*\d+|friends\s*\d+|suggested)/i.test(text)) return true;
      // Pattern 2: a dialog with 1+ "Following" buttons inside it.
      if (countFollowingButtons(d) >= 1) return true;
    }
    return false;
  }

  // Find the "Following" count element on the profile page that, when clicked,
  // opens the Following card/modal. TikTok renders this as a stat with a label
  // like "Following" and a number (e.g. "Following 170" or "170 Following").
  function findFollowingStatLink() {
    // 1) TikTok's data-e2e hooks (most stable).
    const e2e = document.querySelector(
      '[data-e2e*="following-count" i], [data-e2e*="following_count" i], ' +
      '[data-e2e*="following-stat" i], [data-e2e*="following_number" i]'
    );
    if (e2e && isVisible(e2e)) {
      // The clickable element may be the stat's parent <a>/<button>.
      const clickable = e2e.closest('a, button, [role="button"], [data-e2e]') || e2e;
      if (isVisible(clickable)) return clickable;
    }

    // 2) A link whose href points to the /following route.
    const followingHref = document.querySelector('a[href*="/following" i]');
    if (followingHref && isVisible(followingHref)) return followingHref;

    // 3) Any visible clickable element whose text starts with "Following" + a
    //    number, or a number + "Following" (the profile stat).
    const clickables = document.querySelectorAll('a, button, [role="button"], [data-e2e]');
    for (const c of clickables) {
      if (!isVisible(c)) continue;
      const t = textOf(c);
      if (/^following\s*\d+/i.test(t) || /^\d+\s*following/i.test(t)) return c;
    }

    // 4) Fallback: a stat container whose parent mentions "Following".
    const stats = document.querySelectorAll('[class*="count" i], [class*="stat" i], [class*="number" i]');
    for (const s of stats) {
      if (!isVisible(s)) continue;
      const parent = s.parentElement;
      if (parent && /following/i.test(textOf(parent))) {
        const clickable = parent.closest('a, button, [role="button"]') || parent;
        if (isVisible(clickable)) return clickable;
      }
    }

    return null;
  }

  // Open the Following card on the profile by clicking the "Following" stat.
  // If not on a profile page, tries to navigate to the user's profile first.
  async function openFollowingCard() {
    // Already open — nothing to do.
    if (hasFollowingModal()) return { ok: true };

    // If we're not on a profile page (URL has /@username), try to navigate to
    // the logged-in user's profile via the nav avatar/link.
    if (!/\/@[^/]+/i.test(location.pathname)) {
      // Try several selectors for the profile entry point in the nav.
      const profileLink =
        document.querySelector('a[href*="/@"][data-e2e*="profile" i]') ||
        document.querySelector('[data-e2e*="profile-icon" i]') ||
        document.querySelector('[data-e2e*="nav-profile" i]') ||
        document.querySelector('a[href*="/@"]:not([href*="/following"])') ||
        document.querySelector('header a[href*="/@"]') ||
        document.querySelector('[class*="avatar" i][role="button"], [class*="avatar" i] a');
      if (profileLink && isVisible(profileLink)) {
        log("Not on profile — navigating to your profile…");
        profileLink.click();
        // Wait for the SPA navigation to settle.
        for (let i = 0; i < 30; i++) {
          await sleep(300);
          if (/\/@[^/]+/i.test(location.pathname)) break;
        }
        await sleep(1500); // let the profile render
      } else {
        return { ok: false, error: "not_on_profile" };
      }
    }

    // Find and click the "Following" stat to open the card.
    const stat = findFollowingStatLink();
    if (!stat) return { ok: false, error: "no_following_stat" };

    log("Clicking Following stat to open the card…");
    stat.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(rand(300, 600));
    stat.click();

    // Wait for the modal/card to appear.
    for (let i = 0; i < 30; i++) {
      if (hasFollowingModal()) {
        log("Following card opened", "ok");
        // Give the rows/buttons a moment to render inside the modal before
        // returning — the modal shell appears before the user rows load.
        await sleep(rand(1200, 2000));
        return { ok: true };
      }
      await sleep(200);
    }
    return { ok: false, error: "modal_did_not_open" };
  }

  // ---------------------------------------------------------------- profile nav
  // Find the logged-in user's profile URL from TikTok's nav. Returns
  // { ok: true, url } or { ok: false, error }. Used by the popup to navigate
  // directly to the profile via chrome.tabs.update (reliable) instead of
  // clicking a nav avatar (fragile).
  function getProfileUrl() {
    // Already on a profile page — return the current URL.
    if (/\/@[^/]+/i.test(location.pathname)) {
      return { ok: true, url: location.origin + location.pathname };
    }
    // Find the profile link in the nav and read its href.
    const profileLink =
      document.querySelector('a[href*="/@"][data-e2e*="profile" i]') ||
      document.querySelector('[data-e2e*="profile-icon" i]') ||
      document.querySelector('[data-e2e*="nav-profile" i]') ||
      document.querySelector('a[href*="/@"]:not([href*="/following"])') ||
      document.querySelector('header a[href*="/@"]') ||
      document.querySelector('[class*="avatar" i][role="button"], [class*="avatar" i] a');
    if (profileLink) {
      const href = profileLink.getAttribute("href") || profileLink.href || "";
      if (/\/@[^/]+/i.test(href)) {
        // Resolve to a full URL.
        try { return { ok: true, url: new URL(href, location.origin).href }; }
        catch (_) { return { ok: false, error: "bad_profile_url" }; }
      }
    }
    return { ok: false, error: "not_logged_in" };
  }

  // Navigate to the logged-in user's profile. Used by the delete-posts tool.
  async function openProfile() {
    // Already on a profile page (URL has /@username).
    if (/\/@[^/]+/i.test(location.pathname)) return { ok: true };

    // Try several selectors for the profile entry point in the nav.
    const profileLink =
      document.querySelector('a[href*="/@"][data-e2e*="profile" i]') ||
      document.querySelector('[data-e2e*="profile-icon" i]') ||
      document.querySelector('[data-e2e*="nav-profile" i]') ||
      document.querySelector('a[href*="/@"]:not([href*="/following"])') ||
      document.querySelector('header a[href*="/@"]') ||
      document.querySelector('[class*="avatar" i][role="button"], [class*="avatar" i] a');
    if (!profileLink || !isVisible(profileLink)) {
      return { ok: false, error: "not_on_profile" };
    }

    log("Navigating to your profile…");
    profileLink.click();
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      if (/\/@[^/]+/i.test(location.pathname)) break;
    }
    await sleep(1500); // let the profile render
    return { ok: true };
  }

  // ---------------------------------------------------------------- delete posts
  // Find video/post thumbnails on the profile grid. TikTok renders these as
  // clickable links to /@username/video/123 or similar.
  function findProfilePosts() {
    const posts = [];
    // TikTok video links: /@username/video/ID
    const linkSelector = 'a[href*="/video/"]';
    const links = document.querySelectorAll(linkSelector);
    const seen = new Set();
    for (const a of links) {
      if (!isVisible(a)) continue;
      const href = a.getAttribute("href") || "";
      if (!/\/video\//i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      posts.push(a);
    }
    return posts;
  }

  // Collect ALL plausible "..." (more options) buttons on the open video viewer.
  // TikTok's video detail view has several: one over the video (top-right) and
  // one next to the author name in the info panel. Only one of them contains
  // "Delete" for your own posts, so we return all candidates and the caller
  // tries each until a Delete option appears.
  function findMoreButtonCandidates() {
    const out = [];
    const seen = new Set();

    const add = (el) => {
      if (!el || !isVisible(el)) return;
      const r = el.getBoundingClientRect();
      const key = `${Math.round(r.top)}_${Math.round(r.left)}`;
      if (seen.has(key)) return;
      // Skip close (X) / cancel buttons.
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const e2e = (el.getAttribute("data-e2e") || "").toLowerCase();
      if (/close|cancel|back/i.test(aria) || /close/i.test(e2e)) return;
      seen.add(key);
      out.push(el);
    };

    // 0) EXACT match — CONFIRMED from live TikTok markup. The three-dot button
    //    that opens the menu containing "Delete" is:
    //      <div data-e2e="video-setting" class="...DivActionContainer">
    //        <svg class="...StyledEllipsisHorizontal" .../>
    //      </div>
    //    It opens a <ul class="...UlPopupContainer"> containing
    //      <li data-e2e="video-privacy-settings">…</li>
    //      <li data-e2e="video-delete"><button>Delete</button></li>
    //    NOTE: "browse-ellipsis" is a DIFFERENT menu (report/share) and does
    //    NOT contain Delete — so video-setting must come first.
    document.querySelectorAll('[data-e2e="video-setting"]').forEach(add);

    // 1) TikTok's other data-e2e hooks (most stable when present).
    document.querySelectorAll(
      '[data-e2e*="more" i], [data-e2e*="ellipsis" i], [data-e2e*="video-more" i], ' +
      '[data-e2e*="open-more" i], [data-e2e*="option" i], [data-e2e*="setting" i]'
    ).forEach(add);

    // 2) aria-labels mentioning more/options/actions.
    document.querySelectorAll(
      '[aria-label*="more" i], [aria-label*="option" i], [aria-label*="action" i]'
    ).forEach(add);

    // 3) Explicit "..." / ellipsis TEXT anywhere (some builds use text, not an icon).
    document.querySelectorAll('button, [role="button"], div, span, p').forEach((b) => {
      if (!isVisible(b)) return;
      const t = textOf(b);
      if (t === "..." || /^\.{3,}$/.test(t) || t === "\u2026" || /^\u2026+$/.test(t)) add(b);
    });

    // 4) Icon-only buttons: an <svg> with no text. TikTok's "..." is an SVG,
    //    so we walk up from the SVG to the nearest sensibly-sized clickable
    //    ancestor (the actual hit target) and add that.
    const svgs = document.querySelectorAll("svg");
    for (const svg of svgs) {
      if (!isVisible(svg)) continue;
      const sr = svg.getBoundingClientRect();
      // The "..." icon is small.
      if (sr.width < 12 || sr.width > 50 || sr.height < 12 || sr.height > 50) continue;
      // Walk up to find the clickable hit target (button/role=button, or a
      // wrapper whose size is still small — i.e. an icon button, not a panel).
      let target = svg;
      let el = svg.parentElement;
      for (let i = 0; i < 5 && el; i++) {
        const r = el.getBoundingClientRect();
        const tagOk = el.tagName === "BUTTON" || el.getAttribute("role") === "button";
        const sizeOk = r.width >= 16 && r.width <= 80 && r.height >= 16 && r.height <= 80;
        if (tagOk && sizeOk) { target = el; break; }
        if (sizeOk) target = el; // keep the largest still-small wrapper
        if (r.width > 120 || r.height > 120) break; // too big — stop climbing
        el = el.parentElement;
      }
      // Only keep it if the target has no meaningful text (icon-only button).
      if (textOf(target).length > 3) continue;
      add(target);
    }

    // Sort: prefer elements in the upper portion of the viewport (TikTok's
    // "..." buttons sit near the top), then right-most first (both "..."
    // buttons in the viewer are on the right side of the layout).
    out.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const upperA = ra.top < window.innerHeight * 0.35 ? 0 : 1;
      const upperB = rb.top < window.innerHeight * 0.35 ? 0 : 1;
      if (upperA !== upperB) return upperA - upperB;
      return rb.left - ra.left; // right-most first
    });

    // Cap the list so a page full of icons doesn't make the run take forever.
    return out.slice(0, 12);
  }

  // Simulate a real mouse hover over an element. TikTok reveals several menus
  // (including the video "..." menu) on hover rather than click, so we fire the
  // full pointer + mouse event sequence at the element's centre.
  function hoverElement(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    const fire = (type, Ctor) => {
      try { el.dispatchEvent(new Ctor(type, opts)); } catch (_) {}
    };
    fire("pointerover", PointerEvent);
    fire("pointerenter", PointerEvent);
    fire("mouseover", MouseEvent);
    fire("mouseenter", MouseEvent);
    fire("mousemove", MouseEvent);
    // Also hover the ancestors — TikTok often attaches the handler to a wrapper.
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++) {
      try {
        p.dispatchEvent(new MouseEvent("mouseover", opts));
        p.dispatchEvent(new MouseEvent("mouseenter", opts));
      } catch (_) {}
      p = p.parentElement;
    }
  }

  // Click an element with a full, realistic mouse event sequence. TikTok's
  // React handlers sometimes ignore a bare .click(), so we fire
  // pointerdown/mousedown/mouseup/click at the element's centre coordinates
  // and fall back to the native .click().
  function clickElement(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: 1,
    };
    try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mousedown", opts)); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("click", { ...opts, buttons: 0 })); } catch (_) {}
    // Native click as a final fallback (harmless if the events above worked).
    try { el.click(); } catch (_) {}
  }

  // Move the "mouse" off an element so hover-driven menus close.
  function unhoverElement(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new MouseEvent("mouseout", opts));
      el.dispatchEvent(new MouseEvent("mouseleave", opts));
      el.dispatchEvent(new PointerEvent("pointerout", opts));
      el.dispatchEvent(new PointerEvent("pointerleave", opts));
    } catch (_) {}
  }

  // Helper: dump all visible button texts inside a set of roots (for debug).
  function dumpButtonTexts(label, roots) {
    if (!state.opts.debug) return;
    const seen = new Set();
    for (const root of roots) {
      const nodes = root.querySelectorAll('button, [role="button"], [role="menuitem"], a, div, li, span, p');
      for (const n of nodes) {
        if (!isVisible(n)) continue;
        const t = textOf(n);
        if (!t || t.length > 40) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        const r = n.getBoundingClientRect();
        debugLog(`  ${label} text="${t}" tag=${n.tagName} ${Math.round(r.width)}x${Math.round(r.height)} role=${n.getAttribute("role") || "-"}`);
      }
    }
  }

  // Find the "Delete" option in the opened three-dot menu.
  // CONFIRMED live markup:
  //   <li data-e2e="video-delete" class="...LiPopupItem">
  //     <button type="button" class="...ButtonAction">Delete</button>
  //   </li>
  // We click the inner <button> when present, else the <li>.
  function findDeleteMenuItem() {
    // 1) Exact data-e2e hook (most reliable).
    const li = document.querySelector('[data-e2e="video-delete"]');
    if (li && isVisible(li)) {
      const btn = li.querySelector("button, [role=button]");
      return btn && isVisible(btn) ? btn : li;
    }

    // 2) Any popup list item whose e2e mentions delete.
    const alt = document.querySelector('[data-e2e*="delete" i]:not([data-e2e*="modal" i])');
    if (alt && isVisible(alt)) {
      const btn = alt.querySelector("button, [role=button]");
      return btn && isVisible(btn) ? btn : alt;
    }

    // 3) Fallback: a button inside a popup <ul> whose text is exactly "Delete".
    const btns = document.querySelectorAll("ul button, [role=menu] button, li button");
    for (const b of btns) {
      if (!isVisible(b)) continue;
      if (/^\s*delete\s*$/i.test(textOf(b))) return b;
    }

    // 4) Last resort: any visible button whose text is exactly "Delete", but
    //    NOT the confirmation-modal one (that comes later in the flow).
    for (const b of document.querySelectorAll("button, [role=button]")) {
      if (!isVisible(b)) continue;
      if ((b.getAttribute("data-e2e") || "").includes("modal")) continue;
      if (/^\s*delete\s*$/i.test(textOf(b))) return b;
    }
    return null;
  }

  // Find the confirm "Delete" button in the confirmation dialog.
  // CONFIRMED live markup:
  //   <section role="dialog" aria-modal="true" class="...ModalContentSection">
  //     <p>Are you sure you want to delete this video?</p>
  //     <button data-e2e="video-modal-delete" ...>Delete</button>
  //     <button data-e2e="video-modal-cancel" ...>Cancel</button>
  //   </section>
  function findConfirmDeleteButton() {
    // 1) Exact data-e2e hook (most reliable).
    const btn = document.querySelector('[data-e2e="video-modal-delete"]');
    if (btn && isVisible(btn)) return btn;

    // 2) Any e2e hook combining modal + delete.
    for (const b of document.querySelectorAll('[data-e2e*="delete" i]')) {
      if (!isVisible(b)) continue;
      if ((b.getAttribute("data-e2e") || "").toLowerCase().includes("modal")) return b;
    }

    // 3) Inside the confirmation dialog, the button whose text is "Delete".
    for (const sec of document.querySelectorAll('[role="dialog"]')) {
      if (!isVisible(sec)) continue;
      if (!/are you sure|delete this video/i.test(textOf(sec))) continue;
      for (const b of sec.querySelectorAll("button, [role=button]")) {
        if (!isVisible(b)) continue;
        if (/^\s*delete\s*$/i.test(textOf(b))) return b;
      }
    }
    return null;
  }

  // Close any open video viewer / modal by pressing Escape.
  async function closeVideoViewer() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    await sleep(rand(300, 600));
    // Also try clicking any visible "Close" (X) button in a dialog.
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const d of dialogs) {
      if (!isVisible(d)) continue;
      const closeBtn = d.querySelector('[data-e2e*="close" i], [aria-label*="close" i], button[class*="close" i]');
      if (closeBtn && isVisible(closeBtn)) {
        try { closeBtn.click(); } catch (_) {}
        break;
      }
    }
    await sleep(rand(300, 500));
  }

  // Delete a single post: open it, open the "..." menu, click Delete, confirm.
  async function deleteOnePost(postLink) {
    if (state.opts.dryRun) {
      log(`DRY RUN: would delete post ${postLink.getAttribute("href")}`);
      return true;
    }

    // Consume quota (shared with unfollows).
    const quota = await consumeUnfollow();
    if (!quota.ok) {
      log(`Free tier exhausted (${FREE_TIER_LIMIT}/${FREE_TIER_LIMIT}). Unlock unlimited to continue.`, "err");
      setStatus("Free tier exhausted — unlock unlimited", "err");
      sendDone("free_tier_exhausted");
      return false;
    }
    if (!state.quota.unlimited && quota.remaining !== undefined) {
      log(`${quota.remaining} free action(s) remaining`, "ok");
    }

    // 1. Open the post by clicking its thumbnail link.
    log("Opening post…");
    postLink.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(rand(300, 600));
    postLink.click();

    // Wait for the video viewer/modal to appear. TikTok's viewer isn't always
    // role="dialog" — it can be a full-page overlay or a URL change to
    // /@user/video/ID. Accept any of those signals.
    let viewerOpen = false;
    for (let i = 0; i < 25; i++) {
      // Signal 1: a visible role=dialog with meaningful content.
      const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="overlay" i]');
      for (const d of dialogs) {
        if (isVisible(d) && textOf(d).length > 20) { viewerOpen = true; break; }
      }
      // Signal 2: the URL now points at a specific video.
      if (!viewerOpen && /\/video\/\d+/i.test(location.pathname)) viewerOpen = true;
      // Signal 3: a <video> element is present and visible.
      if (!viewerOpen) {
        const vid = document.querySelector("video");
        if (vid && isVisible(vid)) viewerOpen = true;
      }
      if (viewerOpen) break;
      await sleep(200);
    }
    if (!viewerOpen) {
      log("Post viewer didn't open — skipping", "err");
      return false;
    }
    await sleep(rand(1000, 1600)); // let the viewer fully render

    // 2/3. Find the "..." menu and the "Delete" option inside it.
    // There are usually several "..." buttons in the viewer (one over the
    // video, one next to the author name). Only one opens a menu containing
    // "Delete", so we try each candidate until Delete shows up.
    const candidates = findMoreButtonCandidates();
    log(`Found ${candidates.length} "..." button candidate(s)`);
    if (state.opts.debug) {
      candidates.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        debugLog(`  cand #${i}: tag=${c.tagName} text="${textOf(c)}" aria="${c.getAttribute("aria-label") || "-"}" e2e="${c.getAttribute("data-e2e") || "-"}" at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
    }
    if (candidates.length === 0) {
      log("Couldn't find any '...' menu button — skipping", "err");
      if (state.opts.debug) {
        debugLog("Dumping all visible buttons on the page:");
        dumpButtonTexts("page", [document]);
      }
      await closeVideoViewer();
      return false;
    }

    let deleteItem = null;
    let usedCandidate = -1;
    for (let ci = 0; ci < candidates.length && !deleteItem; ci++) {
      const cand = candidates[ci];
      if (!isVisible(cand)) continue;
      const cr = cand.getBoundingClientRect();
      log(`Clicking "..." candidate ${ci + 1}/${candidates.length} at ${Math.round(cr.left)},${Math.round(cr.top)}`);

      // Hover first so the element becomes interactive, then CLICK the three
      // dots — the Delete option only appears after the click opens the menu.
      hoverElement(cand);
      await sleep(rand(250, 450));
      clickElement(cand);
      await sleep(rand(700, 1100)); // wait for the menu to open

      // TikTok's ellipsis has aria-expanded that flips to "true" when its
      // menu opens — a reliable signal that our click actually registered.
      let expanded = cand.getAttribute("aria-expanded") === "true";
      if (!expanded && cand.hasAttribute("aria-expanded")) {
        // Click didn't open it. The element has tabindex=0, so try keyboard
        // activation (focus + Enter, then Space) which React widgets honour.
        log("  click didn't open the menu — trying keyboard activation");
        try { cand.focus(); } catch (_) {}
        await sleep(200);
        for (const key of ["Enter", " "]) {
          const kopts = { key, code: key === " " ? "Space" : key, keyCode: key === " " ? 32 : 13, bubbles: true, cancelable: true };
          try {
            cand.dispatchEvent(new KeyboardEvent("keydown", kopts));
            cand.dispatchEvent(new KeyboardEvent("keyup", kopts));
          } catch (_) {}
          await sleep(600);
          if (cand.getAttribute("aria-expanded") === "true") break;
        }
        expanded = cand.getAttribute("aria-expanded") === "true";
      }
      if (cand.hasAttribute("aria-expanded")) {
        log(`  menu ${expanded ? "OPENED" : "did NOT open"} (aria-expanded=${cand.getAttribute("aria-expanded")})`);
      }

      for (let i = 0; i < 12; i++) {
        deleteItem = findDeleteMenuItem();
        if (deleteItem) break;
        await sleep(200);
      }

      if (deleteItem) {
        usedCandidate = ci;
        break;
      }

      // No Delete in this menu — dump EVERYTHING visible so we can see what
      // the menu actually contains, then close it and try the next candidate.
      if (state.opts.debug) {
        debugLog(`  no Delete found after candidate #${ci}. Visible short texts on page:`);
        const seenTexts = new Set();
        for (const n of document.querySelectorAll("*")) {
          if (!isVisible(n)) continue;
          const t = textOf(n);
          if (!t || t.length > 30 || seenTexts.has(t)) continue;
          seenTexts.add(t);
        }
        debugLog("  [" + Array.from(seenTexts).map((t) => JSON.stringify(t)).join(", ") + "]");
      }
      // Move the mouse away and close any menu (Escape) without closing the
      // video viewer, then try the next candidate.
      unhoverElement(cand);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
      await sleep(rand(300, 600));
    }

    if (!deleteItem) {
      log("Couldn't find 'Delete' in any '...' menu — skipping", "err");
      await closeVideoViewer();
      return false;
    }
    if (state.opts.debug) debugLog(`Found Delete via candidate #${usedCandidate}: text="${textOf(deleteItem)}" tag=${deleteItem.tagName}`);
    hoverElement(deleteItem);
    await sleep(rand(150, 300));
    clickElement(deleteItem);
    await sleep(rand(700, 1100)); // wait for confirmation dialog

    // 4. Confirm deletion in the confirmation dialog.
    let confirmBtn = null;
    for (let i = 0; i < 15; i++) {
      confirmBtn = findConfirmDeleteButton();
      if (confirmBtn) break;
      await sleep(200);
    }
    if (!confirmBtn) {
      log("Couldn't find the confirm 'Delete' button — skipping", "err");
      if (state.opts.debug) {
        debugLog("Dumping visible buttons in confirmation dialogs:");
        const dialogs = document.querySelectorAll('[role="dialog"], [class*="confirm" i], [class*="modal" i]');
        dumpButtonTexts("confirm", Array.from(dialogs).filter(isVisible));
      }
      await closeVideoViewer();
      return false;
    }
    if (state.opts.debug) debugLog(`Found confirm Delete: text="${textOf(confirmBtn)}" tag=${confirmBtn.tagName}`);
    hoverElement(confirmBtn);
    await sleep(rand(150, 300));
    clickElement(confirmBtn);

    // Wait for the deletion to process (dialog closes).
    for (let i = 0; i < 20; i++) {
      if (!findConfirmDeleteButton()) break;
      await sleep(200);
    }
    await sleep(rand(500, 900));

    // Close any remaining viewer.
    await closeVideoViewer();
    log(`Deleted post`, "ok");
    return true;
  }

  // The delete agent loop: finds posts on the profile, deletes them one by one.
  async function runDeleteAgent() {
    state.running = true;
    state.stopRequested = false;
    state.done = 0;
    sendProgress();

    log(`Delete agent v${AGENT_BUILD} started on ${location.pathname}`);

    // Enforce free tier before starting.
    await loadQuota();
    if (!state.quota.unlimited && state.quota.used >= FREE_TIER_LIMIT) {
      log(`Free tier exhausted (${FREE_TIER_LIMIT}/${FREE_TIER_LIMIT}). Unlock unlimited to continue.`, "err");
      setStatus("Free tier exhausted — unlock unlimited", "err");
      sendDone("free_tier_exhausted");
      return;
    }
    if (!state.quota.unlimited) {
      log(`Free tier: ${remainingFree()} of ${FREE_TIER_LIMIT} actions remaining`);
    } else {
      log("Unlimited mode active");
    }

    // Wait for posts to appear on the profile grid.
    let posts = findProfilePosts();
    if (posts.length === 0) {
      log("No posts found yet — waiting for the grid to render…");
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        posts = findProfilePosts();
        if (posts.length > 0) break;
      }
    }
    log(`Found ${posts.length} post(s) on the profile`);

    if (posts.length === 0) {
      log("No posts found on your profile.", "err");
      setStatus("No posts found", "err");
      sendDone("no_posts");
      return;
    }

    const handled = new Set(); // track by href
    let idleRounds = 0;

    while (state.running) {
      if (state.stopRequested) {
        sendDone("stopped");
        return;
      }
      if (state.mode === "count" && state.done >= state.target) {
        sendDone("target_reached");
        return;
      }

      // Re-scan for posts (the grid may have shifted after deletions).
      let currentPosts = findProfilePosts().filter((p) => {
        const href = p.getAttribute("href") || "";
        return !handled.has(href);
      });

      if (currentPosts.length === 0) {
        // Try scrolling down to load more.
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(rand(1000, 1800));
        currentPosts = findProfilePosts().filter((p) => {
          const href = p.getAttribute("href") || "";
          return !handled.has(href);
        });
        if (currentPosts.length === 0) {
          idleRounds++;
          log(`No more posts found (idle ${idleRounds}/3)`);
          if (idleRounds >= 3) {
            sendDone(state.mode === "all" ? "list_exhausted" : "no_posts");
            return;
          }
          await sleep(rand(1200, 2000));
          continue;
        }
        idleRounds = 0;
      }

      // Process the first unhandled post.
      const post = currentPosts[0];
      const href = post.getAttribute("href") || "";
      handled.add(href);

      try {
        const ok = await deleteOnePost(post);
        if (ok) {
          state.done++;
          log(`Deleted #${state.done}`, "ok");
        }
      } catch (e) {
        log(`Error deleting post: ${e.message}`, "err");
      }
      sendProgress();

      // Human-ish pacing.
      await sleep(rand(1500, 3000));
    }
  }

  // Scroll the following card to load more rows. Uses the detected card;
  // if the card itself isn't scrollable, walks up to find a scrollable
  // ancestor, then falls back to window scroll.
  async function scrollForMore() {
    const card = findFollowingCard();
    let target = card;
    // Find a scrollable element at or above the card.
    let el = card;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 50) {
        target = el;
        break;
      }
      el = el.parentElement;
    }
    if (target && target.scrollHeight > target.clientHeight + 50) {
      target.scrollTop = target.scrollHeight;
    } else {
      window.scrollTo(0, document.body.scrollHeight);
    }
    await sleep(rand(700, 1200));
  }

  // ---------------------------------------------------------------- the loop
  async function clickUnfollowOne(btn) {
    if (state.opts.dryRun) {
      log(`DRY RUN: would unfollow row near "${shortLabel(btn)}"`);
      return true;
    }

    // Consume quota only for real unfollows (not dry runs).
    const quota = await consumeUnfollow();
    if (!quota.ok) {
      log(`Free tier exhausted (${FREE_TIER_LIMIT}/${FREE_TIER_LIMIT}). Unlock unlimited to continue.`, "err");
      setStatus("Free tier exhausted — unlock unlimited", "err");
      sendDone("free_tier_exhausted");
      return false;
    }
    if (!state.quota.unlimited && quota.remaining !== undefined) {
      log(`${quota.remaining} free unfollow(s) remaining`, "ok");
    }

    // Bring into view & click.
    btn.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(rand(250, 500));
    btn.click();

    // Wait for the confirm dialog.
    let confirmBtn = null;
    for (let i = 0; i < 20; i++) {
      confirmBtn = findConfirmUnfollowButton();
      if (confirmBtn) break;
      await sleep(150);
    }

    if (confirmBtn) {
      await sleep(rand(200, 450));
      confirmBtn.click();
      // Wait for the dialog to clear (sign the action completed).
      for (let i = 0; i < 20; i++) {
        if (!findConfirmUnfollowButton()) break;
        await sleep(150);
      }
    } else {
      // No dialog appeared. TikTok may unfollow without confirmation on some
      // surfaces. Verify the button changed to a "Follow" state.
      await sleep(rand(400, 800));
      const newText = textOf(btn).toLowerCase();
      if (newText.includes("follow") && !newText.includes("following")) {
        log(`Unfollowed without dialog: ${shortLabel(btn)}`, "ok");
        await sleep(rand(300, 600));
        return true;
      }
      log("No confirm dialog appeared — skipping", "err");
      dismissStrayDialogs();
      return false;
    }
    await sleep(rand(300, 600));
    return true;
  }

  function shortLabel(btn) {
    const card = btn.closest('[class*="user" i], [class*="item" i], [class*="row" i], li, article');
    if (!card) return "?";
    const nameEl = card.querySelector(
      'a[href*="/@"], [class*="nickname" i], [class*="username" i], [class*="name" i]'
    );
    return nameEl ? textOf(nameEl).slice(0, 40) : "?";
  }

  async function runAgent() {
    state.running = true;
    state.stopRequested = false;
    state.done = 0;
    sendProgress();

    // Re-check live: user may have just opened the Following modal.
    state.onFollowingPage = /\/following\b/i.test(location.pathname + location.search) || hasFollowingModal();

    const card = findFollowingCard();
    const cardTag = card === document ? "document (fallback)" : (card.getAttribute("data-e2e") || card.className || card.tagName).toString().slice(0, 80);
    log(`Agent v${AGENT_BUILD} started on ${location.pathname}`);
    log(`Detected following card: ${cardTag}`);
    if (state.opts.debug) {
      debugLog(`modal detected: ${hasFollowingModal()}`);
      debugLog(`card dimensions: ${card.clientWidth}x${card.clientHeight}, scrollable: ${card.scrollHeight > card.clientHeight + 50}`);
    }

    // Wait for "Following" buttons to appear in the card. The modal may have
    // just been opened by OPEN_FOLLOWING_CARD and the rows can take a moment
    // to render. Retry for up to ~15 seconds before giving up.
    let initialButtons = findFollowingButtons();
    if (initialButtons.length === 0) {
      log("No Following buttons yet — waiting for the list to render…");
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        // Re-check if the modal is open and re-scan.
        state.onFollowingPage = /\/following\b/i.test(location.pathname + location.search) || hasFollowingModal();
        initialButtons = findFollowingButtons();
        if (initialButtons.length > 0) break;
        if (i === 5 || i === 15 || i === 25) {
          log(`Still waiting for Following buttons… (${initialButtons.length} found so far)`);
        }
      }
    }
    log(`Found ${initialButtons.length} "Following" button(s) in card`);
    if (state.opts.debug) {
      initialButtons.forEach((b, i) => {
        const r = b.getBoundingClientRect();
        debugLog(`button #${i}: text="${textOf(b)}" tag=${b.tagName} rect=${Math.round(r.top)},${Math.round(r.left)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
    }

    // Enforce free tier before starting real work.
    await loadQuota();
    if (!state.quota.unlimited && state.quota.used >= FREE_TIER_LIMIT) {
      log(`Free tier exhausted (${FREE_TIER_LIMIT}/${FREE_TIER_LIMIT}). Unlock unlimited to continue.`, "err");
      setStatus("Free tier exhausted — unlock unlimited", "err");
      sendDone("free_tier_exhausted");
      return;
    }
    if (!state.quota.unlimited) {
      log(`Free tier: ${remainingFree()} of ${FREE_TIER_LIMIT} unfollows remaining`);
    } else {
      log("Unlimited mode active");
    }

    if (card === document && !state.onFollowingPage) {
      log("No following card found. Open your profile's Following list, then Start.", "err");
      setStatus("No following card detected", "err");
      sendDone("no_card");
      return;
    }

    if (initialButtons.length === 0) {
      log("No visible 'Following' buttons found. Try scrolling the list once, then Start.", "err");
      setStatus("No Following buttons found", "err");
      sendDone("no_buttons");
      return;
    }

    // Track buttons we've already handled so we don't loop forever.
    const handled = new WeakSet();
    let idleRounds = 0;

    while (state.running) {
      if (state.stopRequested) {
        sendDone("stopped");
        return;
      }
      if (state.mode === "count" && state.done >= state.target) {
        sendDone("target_reached");
        return;
      }

      let buttons = findFollowingButtons().filter((b) => !handled.has(b));

      if (state.opts.shuffle && buttons.length > 1) {
        // Light shuffle so we don't always hammer the top of the list.
        buttons = shuffle(buttons);
      }

      if (buttons.length === 0) {
        // Try to load more by scrolling.
        await scrollForMore();
        buttons = findFollowingButtons().filter((b) => !handled.has(b));
        if (buttons.length === 0) {
          idleRounds++;
          log(`No more Following buttons found (idle ${idleRounds}/3)`);
          if (idleRounds >= 3) {
            sendDone(state.mode === "all" ? "list_exhausted" : "no_buttons");
            return;
          }
          await sleep(rand(1200, 2000));
          continue;
        }
        idleRounds = 0;
      }

      // Process a small batch, then re-scan (DOM may have shifted).
      const batch = buttons.slice(0, Math.min(5, buttons.length));
      for (const btn of batch) {
        if (state.stopRequested) break;
        if (state.mode === "count" && state.done >= state.target) break;

        handled.add(btn);
        const label = shortLabel(btn);
        try {
          const ok = await clickUnfollowOne(btn);
          if (ok) {
            state.done++;
            log(`Unfollowed #${state.done}: ${label}`, "ok");
          }
        } catch (e) {
          log(`Error on "${label}": ${e.message}`, "err");
        }
        sendProgress();

        // Human-ish pacing to be gentle on rate limits.
        await sleep(rand(900, 1800));
      }
    }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------------------------------------------------------------- messaging
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING") {
      // Re-check live — the user may have opened the Following modal
      // after the content script was injected.
      state.onFollowingPage = /\/following\b/i.test(location.pathname + location.search) || hasFollowingModal();
      sendResponse({
        ok: true,
        running: state.running,
        onFollowingPage: state.onFollowingPage,
        lastLog: state.lastLog,
      });
      return true;
    }

    if (msg.type === "OPEN_FOLLOWING_CARD") {
      // Open the Following card on the profile, then respond. The popup
      // calls this after reloading the page, before sending START.
      openFollowingCard().then((result) => sendResponse(result));
      return true; // keep the message channel open for the async response
    }

    if (msg.type === "OPEN_PROFILE") {
      // Navigate to the logged-in user's profile. Used by the delete tool.
      openProfile().then((result) => sendResponse(result));
      return true;
    }

    if (msg.type === "START") {
      if (state.running) {
        sendResponse({ error: "already_running" });
        return true;
      }
      state.mode = msg.mode || "count";
      state.target = msg.target || 0;
      state.opts = msg.opts || { shuffle: true, dryRun: false };
      sendResponse({ ok: true });
      runAgent();
      return true;
    }

    if (msg.type === "DELETE_START") {
      if (state.running) {
        sendResponse({ error: "already_running" });
        return true;
      }
      state.mode = msg.mode || "count";
      state.target = msg.target || 0;
      state.opts = msg.opts || { shuffle: false, dryRun: false };
      sendResponse({ ok: true });
      runDeleteAgent();
      return true;
    }

    if (msg.type === "STOP") {
      state.stopRequested = true;
      sendResponse({ ok: true });
      return true;
    }
  });

  // Keep onFollowingPage fresh if user navigates within the tab.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      state.onFollowingPage = /\/following\b/i.test(location.pathname + location.search);
    }
  }, 1000);
})();
