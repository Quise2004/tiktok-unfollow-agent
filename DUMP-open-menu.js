// DUMP-open-menu.js
// USE THIS AFTER YOU MANUALLY CLICK THE THREE DOTS so the menu is OPEN.
//
// Steps:
//   1. Open your TikTok profile, click one of your posts (viewer opens)
//   2. MANUALLY click the three dots (...) so the menu with "Delete" is visible
//   3. Press F12 -> Console tab
//   4. Paste this whole file, press Enter
//   5. Copy ALL the output and send it back
//
// It prints the markup of the open menu and of the Delete row specifically.

(() => {
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    if (parseFloat(s.opacity) === 0) return false;
    return true;
  };
  const textOf = (el) => (el.innerText || el.textContent || "").trim();

  console.log("%c===== 1. THE ELLIPSIS BUTTON STATE =====", "color:#0af;font-weight:bold");
  document.querySelectorAll('[data-e2e*="ellipsis" i], [aria-haspopup]').forEach((el) => {
    if (!isVisible(el)) return;
    console.log(
      `e2e="${el.getAttribute("data-e2e") || "-"}" ` +
      `aria-expanded="${el.getAttribute("aria-expanded") || "-"}" ` +
      `aria-haspopup="${el.getAttribute("aria-haspopup") || "-"}" ` +
      `class="${(el.className || "").toString()}"`
    );
  });

  console.log("%c===== 2. ELEMENTS CONTAINING 'DELETE' =====", "color:#0f0;font-weight:bold");
  let found = 0;
  for (const el of document.querySelectorAll("*")) {
    if (!isVisible(el)) continue;
    const t = textOf(el);
    if (!t || t.length > 30) continue;
    if (!/delete/i.test(t)) continue;
    found++;
    console.log(`--- match #${found} ---`);
    console.log(`  text      : ${JSON.stringify(t)}`);
    console.log(`  tag       : ${el.tagName}`);
    console.log(`  role      : ${el.getAttribute("role") || "-"}`);
    console.log(`  data-e2e  : ${el.getAttribute("data-e2e") || "-"}`);
    console.log(`  aria-label: ${el.getAttribute("aria-label") || "-"}`);
    console.log(`  class     : ${(el.className || "").toString()}`);
    const r = el.getBoundingClientRect();
    console.log(`  position  : ${Math.round(r.left)},${Math.round(r.top)} size ${Math.round(r.width)}x${Math.round(r.height)}`);
    console.log(`  outerHTML : ${el.outerHTML.slice(0, 400)}`);
    // Show the ancestor chain so we can see the menu container.
    let chain = [], p = el.parentElement;
    for (let i = 0; i < 5 && p; i++) {
      chain.push(`${p.tagName}[role=${p.getAttribute("role") || "-"}][e2e=${p.getAttribute("data-e2e") || "-"}].${(p.className || "").toString().slice(0, 40)}`);
      p = p.parentElement;
    }
    console.log(`  ancestors : ${chain.join("  >  ")}`);
  }
  if (!found) {
    console.log("%cNO 'Delete' TEXT FOUND — is the menu actually open?", "color:red;font-weight:bold");
  }

  console.log("%c===== 3. THE OPEN MENU CONTAINER(S) =====", "color:#fa0;font-weight:bold");
  document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [data-e2e*="popover" i]').forEach((d) => {
    if (!isVisible(d)) return;
    console.log(`--- container: ${d.tagName} role="${d.getAttribute("role") || "-"}" e2e="${d.getAttribute("data-e2e") || "-"}" class="${(d.className || "").toString().slice(0, 60)}"`);
    console.log(`    text: ${JSON.stringify(textOf(d).slice(0, 300))}`);
    console.log(`    HTML: ${d.outerHTML.slice(0, 800)}`);
  });

  console.log("%c===== 4. ALL VISIBLE SHORT TEXTS (the menu options) =====", "color:#f0f;font-weight:bold");
  const seen = new Set();
  for (const el of document.querySelectorAll("*")) {
    if (!isVisible(el)) continue;
    const t = textOf(el);
    if (!t || t.length > 30 || seen.has(t)) continue;
    seen.add(t);
  }
  console.log(Array.from(seen).map((t) => JSON.stringify(t)).join(", "));

  console.log("%c===== DONE - copy everything above =====", "color:#0af;font-weight:bold");
})();
