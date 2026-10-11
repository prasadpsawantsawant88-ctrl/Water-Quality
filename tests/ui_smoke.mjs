// Generic smoke test: visits every nav entry, records page errors, optional extra steps per phase.
// Optional browser smoke test: visits every page and fails on console errors or NaN/undefined text.
// Needs the preview server running (npm run build && npm run preview) and Playwright: PLAYWRIGHT=/path/to/playwright/index.mjs node tests/ui_smoke.mjs
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const viewport = process.env.VP ? { width: +process.env.VP.split("x")[0], height: +process.env.VP.split("x")[1] } : { width: 1440, height: 1000 };
const b = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
const p = await b.newPage({ viewport });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/tile|ERR_|Failed to load resource/.test(m.text())) errors.push("CONSOLE " + m.text()); });
await p.goto("http://localhost:4173/");
await p.waitForTimeout(500);
const nav = await p.locator("aside nav button").allInnerTexts();
console.log("NAV:", nav.map((t) => t.replace(/\n/g, " ")).join(" | "));
let i = 0;
for (const label of nav) {
  const name = label.replace(/^\d+\s*/, "").replace(/\n/g, " ").trim();
  await p.locator("aside nav button").filter({ hasText: name }).first().click();
  await p.waitForTimeout(2200);
  const h1 = await p.locator("main h1").first().innerText().catch(() => "(no h1)");
  const body = await p.locator("main").innerText();
  const bad = /NaN|undefined|Infinity|\[object/.test(body);
  i++;
  console.log(`${bad ? "BAD-TEXT" : "ok      "} ${name} -> ${h1}`);
}
for (const step of (process.env.STEPS || "").split(";").filter(Boolean)) {
  const [nav1, tab] = step.split(">");
  await p.locator("aside nav button").filter({ hasText: nav1 }).first().click();
  if (tab) await p.getByRole("button", { name: tab }).first().click();
  await p.waitForTimeout(2200);
  const body = await p.locator("main").innerText();
  console.log(`${/NaN|undefined|Infinity|\[object/.test(body) ? "BAD-TEXT" : "ok      "} step ${step}`);
}
console.log("ERRORS:", errors.length ? errors : "none");
await b.close();
process.exit(errors.length ? 1 : 0);
