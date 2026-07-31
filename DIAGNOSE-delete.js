// DIAGNOSE-delete.js
// Paste this whole file into the Chrome DevTools Console while a TikTok video
// of YOURS is open (the detail view with the "..." buttons visible).
// It clicks each "..." candidate and prints everything that appears, so we can
// see exactly what the delete option is called and which button opens it.
//
// How to run:
//   1. Open your TikTok profile, click one of your posts (viewer opens)
//   2. Press F12 -> Console tab
//   3. Paste this entire file, press Enter
//   4. Copy ALL the output and send it back

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    if (parseFloat(s.opacity) === 0) return false;
    return true;
  };
  const textOf = (el) => (el.innerText || el.textContent || "").trim();

  // ---- 1. Snapshot all visible short texts BEFORE clicking anything ----
  const snapshotTexts = () => {
    const set = new Set();
    for (const n of document.querySelectorAll("*")) {
      if (!isVisible(n)) continue;
      const t = textOf(n);
      if (t && t.length <= 40) set.add(t);
    }
    return set;
  };

  const before = snapshotTexts();
  console.log("%c=== BASELINE: " + before.size + " visible texts ===", "color:#888");

  // ---- 2. Find "..." candidates ----
  const cands = [];
  const seen = new Set();
  const add = (el, why) => {
    if (!el || !isVisible(el)) return;
    const r = el.getBoundingClientRect();
    const key = Math.round(r.top) + "_" + Math.round(r.left);
    if (seen.has(key)) return;
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (/close|cancel|back/.test(aria)) return;
    seen.add(key);
    cands.push({ el, why, r });
  };

  document.querySelectorAll('[data-e2e], [aria-label]').forEach((el) => {
    const e2e = (el.getAttribute("data-e2e") || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (/more|ellipsis|option|action|setting/.test(e2e + " " + aria)) add(el, "attr:" + (e2e || aria));
  });

  document.querySelectorAll("button, [role=button], div, span, p").forEach((el) => {
    const t = textOf(el);
    if (t === "..." || /^\.{3,}$/.test(t) || t === "\u2026") add(el, "text-ellipsis");
  });

  document.querySelectorAll("svg").forEach((svg) => {
    if (!isVisible(svg)) return;
    const sr = svg.getBoundingClientRect();
    if (sr.width < 12 || sr.width > 50 || sr.height < 12 || sr.height > 50) return;
    let target = svg, el = svg.parentElement;
    for (let i = 0; i < 5 && el; i++) {
      const r = el.getBoundingClientRect();
      const tagOk = el.tagName === "BUTTON" || el.getAttribute("role") === "button";
      const sizeOk = r.width >= 16 && r.width <= 80 && r.height >= 16 && r.height <= 80;
      if (tagOk && sizeOk) { target = el; break; }
      if (sizeOk) target = el;
      if (r.width > 120 || r.height > 120) break;
      el = el.parentElement;
    }
    if (textOf(target).length > 3) return;
    add(target, "svg-icon");
  });

  console.log("%c=== FOUND " + cands.length + " '...' CANDIDATES ===", "color:#0af;font-weight:bold");
  cands.forEach((c, i) => {
    console.log(
      `#${i} why=${c.why} tag=${c.el.tagName} ` +
      `pos=${Math.round(c.r.left)},${Math.round(c.r.top)} ` +
      `size=${Math.round(c.r.width)}x${Math.round(c.r.height)} ` +
      `e2e="${c.el.getAttribute("data-e2e") || "-"}" ` +
      `aria="${c.el.getAttribute("aria-label") || "-"}" ` +
      `class="${(c.el.className || "").toString().slice(0, 60)}"`
    );
  });

  // ---- 3. Click each candidate and report NEW texts that appear ----
  const fullClick = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    try { el.dispatchEvent(new PointerEvent("pointerover", o)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent("mouseover", o)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent("mouseenter", o)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent("pointerdown", o)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent("mousedown", o)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent("pointerup", o)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent("mouseup", o)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent("click", o)); } catch (e) {}
    try { el.click(); } catch (e) {}
  };

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    console.log(`%c--- clicking candidate #${i} (${c.why}) at ${Math.round(c.r.left)},${Math.round(c.r.top)} ---`, "color:#fa0;font-weight:bold");
    fullClick(c.el);
    await sleep(1200);

    const after = snapshotTexts();
    const added = [...after].filter((t) => !before.has(t));
    if (added.length) {
      console.log("%c  NEW TEXTS APPEARED (" + added.length + "):", "color:#0f0;font-weight:bold");
      added.forEach((t) => console.log("    > " + JSON.stringify(t)));
      const del = added.filter((t) => /delete/i.test(t));
      if (del.length) {
        console.log("%c  *** DELETE-LIKE TEXT FOUND: " + JSON.stringify(del) + " ***", "color:#f0f;font-size:14px;font-weight:bold");
        console.log("%c  >>> CANDIDATE #" + i + " IS THE RIGHT '...' BUTTON <<<", "color:#f0f;font-size:14px;font-weight:bold");
      }
    } else {
      console.log("  (no new text appeared - this candidate opened nothing)");
    }

    // Close whatever opened, so the next candidate starts clean.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    await sleep(600);
  }

  console.log("%c=== DIAGNOSTIC COMPLETE - copy everything above ===", "color:#0af;font-weight:bold");
})();
