// The one shared tooltip. Any element with data-tip shows its text in the element #tip on hover (after a short
// delay), keyboard focus or a tap, and goes away on leaving (a mouse may cross onto the tip to read it), scrolling,
// Escape or a press elsewhere. A control that is switched off (aria-disabled="true") shows its reason when pressed,
// so a touch screen can read it too.
// The inlined page script keeps this file's code as it is (the build only drops `export`).
export function installTooltip(doc = document) {
  const tip = doc.getElementById("tip");
  let timer;
  let leaveTimer;
  let owner = null;
  const show = (el) => {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    hide();
    owner = el;
    tip.textContent = text;
    tip.setAttribute("data-on", "");
    el.setAttribute("aria-describedby", tip.id);
    // Measure from the corner, so the size does not depend on where the last tooltip was.
    tip.style.left = "0px";
    tip.style.top = "0px";
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const view = doc.documentElement;
    const x = Math.max(12, Math.min(r.left + r.width / 2 - t.width / 2, view.clientWidth - t.width - 12));
    const below = r.bottom + 8;
    const y = below + t.height > view.clientHeight - 8 ? Math.max(8, r.top - t.height - 8) : below;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  function hide() {
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    tip.removeAttribute("data-on");
    owner?.removeAttribute("aria-describedby");
    owner = null;
  }
  doc.addEventListener("pointerover", (e) => {
    clearTimeout(leaveTimer);
    clearTimeout(timer);
    if (e.target.closest("#tip")) return;
    const el = e.target.closest("[data-tip]");
    if (!el) {
      if (owner && e.pointerType !== "touch") leaveTimer = setTimeout(hide, 150);
      else hide();
    } else if (el !== owner) {
      if (e.pointerType !== "touch") timer = setTimeout(() => show(el), 250);
      else show(el);
    }
  });
  doc.addEventListener("pointerdown", (e) => { if (!e.target.closest("[data-tip], #tip")) hide(); });
  doc.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el && el.matches(":focus-visible")) show(el);
  });
  // Only the control that owns the tooltip takes it away: a tap that moves focus to another control must keep its own.
  doc.addEventListener("focusout", (e) => { if (e.target === owner) hide(); });
  doc.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  doc.addEventListener("scroll", hide, true);
  doc.addEventListener("click", (e) => {
    const el = e.target.closest('[aria-disabled="true"]');
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    show(el);
  }, true);
  return { show, hide };
}
