// The page script. build.mjs inlines src/browser.mjs and src/ui/tooltip.mjs above this file.
installTooltip();

/** This browser and what it can do. Later steps read browser.features to switch a control off with its reason. */
const browser = detectBrowser(window);
document.getElementById("browserChip").textContent = browser.label;

/** A row of choices: one is pressed at a time; a switched-off choice is never picked (the tooltip shows why). */
function choices(group) {
  group.addEventListener("click", (e) => {
    const picked = e.target.closest("button");
    if (!picked || picked.getAttribute("aria-disabled") === "true") return;
    for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === picked));
  });
}

// Step 1 is done from the start: one choice is always picked.
choices(document.getElementById("streamSeg"));
