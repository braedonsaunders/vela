// Builds every Vela brand file from one set of geometry.
//   node brand/build.mjs          SVG sources in brand/svg and the app's assets in client/assets/brand
//   node brand/build.mjs --png    also the PNG icons in brand/png (needs Google Chrome and playwright-core)
// Geometry is on the 64-unit symbol grid; the wordmark is on its own 100-unit ascender grid.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "../client/assets/brand");

// The two beams. The light side reaches the baseline; the shadow side stops short against it.
export const LIGHT = "M9 8H26.4L41 57.6H32.4Z";
export const SHADOW = "M38 8H55L36.8 50.8 32.4 57.6Z";
export const MARK = { x: 9, y: 8, w: 46, h: 49.6 };
// Pivots each beam turns about in the animated mark (its base).
export const PIVOT = { light: [36.7, 57.6], shadow: [34.6, 54.2] };
// Custom monoline lowercase: v, e, l, single-storey a. Stroke 12.5, round caps and joins.
export const LETTERS = ["M0 36L26 100L52 36", "M72 68H136A32 32 0 1 0 128.51 88.57", "M156 0V100", "M240 68A32 32 0 1 0 176 68A32 32 0 1 0 240 68M240 36V100"];
export const STROKE = 12.5;
const WM = { x: -6.25, y: -6.25, w: 252.5, h: 112.5 };

export const COLORS = {
  dark: { ground: "#090b0e", light: "#f5f1e9", shadow: "#dcb998" },
  paper: { ground: "#f3f0e8", light: "#111419", shadow: "#a65b38" },
  white: { light: "#ffffff", shadow: "#ffffff", shadowOpacity: 0.55 },
  ink: { light: "#111419", shadow: "#111419", shadowOpacity: 0.55 },
  ember: { ground: "#a65b38", light: "#fff6ec", shadow: "#fff6ec", shadowOpacity: 0.6 },
  tile: { top: "#1c222b", bottom: "#07090c" },
};

const svg = (vb, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${label ? ` role="img" aria-label="${label}"` : ""}>${body}</svg>\n`;
const beams = (c) => `<path d="${SHADOW}" fill="${c.shadow}"${c.shadowOpacity ? ` fill-opacity="${c.shadowOpacity}"` : ""}/><path d="${LIGHT}" fill="${c.light}"/>`;
const word = (c) => `<g fill="none" stroke="${c.light}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"><path d="${LETTERS.join("")}"/></g>`;
const r = (n) => +n.toFixed(2);

function symbol(c) { return svg(`${MARK.x} ${MARK.y} ${MARK.w} ${MARK.h}`, beams(c), "Vela"); }
function wordmark(c) { return svg(`${WM.x} ${WM.y} ${WM.w} ${WM.h}`, word(c), "Vela"); }
// Horizontal: the symbol stands 1.86 ascenders tall, centred on the word, one beam-width of air between.
function horizontal(c) {
  const s = 186 / MARK.h, mw = MARK.w * s, gap = 64, wx = mw + gap - WM.x, top = 50 - 93;
  const body = `<g transform="translate(0 ${r(top)}) scale(${r(s)}) translate(${-MARK.x} ${-MARK.y})">${beams(c)}</g><g transform="translate(${r(wx)} 0)">${word(c)}</g>`;
  return svg(`0 ${r(top)} ${r(wx + WM.x + WM.w)} 186`, body, "Vela");
}
function stacked(c) {
  const s = 300 / MARK.h, mw = MARK.w * s, wy = 300 + 71 - WM.y, wx = (mw - 240) / 2;
  const body = `<g transform="scale(${r(s)}) translate(${-MARK.x} ${-MARK.y})">${beams(c)}</g><g transform="translate(${r(wx)} ${r(wy)})">${word(c)}</g>`;
  return svg(`${r(Math.min(0, wx + WM.x))} 0 ${r(Math.max(mw, WM.w))} ${r(wy + WM.y + WM.h)}`, body, "Vela");
}
// App icon: the V on the night tile. `inset` is the V's share of the tile; `round` the corner radius.
function icon({ round = 14.5, scale = 0.58, label = "Vela" } = {}) {
  const t = COLORS.tile, k = 64 * scale / 46.4, ox = 32 - (MARK.x + MARK.w / 2) * k, oy = 32 - (MARK.y + MARK.h / 2) * k - 0.4;
  const body = `<defs><radialGradient id="t" cx=".5" cy=".28" r=".85"><stop offset="0" stop-color="${t.top}"/><stop offset="1" stop-color="${t.bottom}"/></radialGradient></defs>` +
    `<rect width="64" height="64" rx="${round}" fill="url(#t)"/>` + (round ? `<rect x=".25" y=".25" width="63.5" height="63.5" rx="${round - 0.25}" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width=".5"/>` : "") +
    `<g transform="translate(${r(ox)} ${r(oy)}) scale(${r(k)})">${beams(COLORS.dark)}</g>`;
  return svg("0 0 64 64", body, label);
}

const files = {
  "vela-symbol.svg": symbol(COLORS.dark),
  "vela-symbol-paper.svg": symbol(COLORS.paper),
  "vela-symbol-white.svg": symbol(COLORS.white),
  "vela-symbol-ink.svg": symbol(COLORS.ink),
  "vela-wordmark.svg": wordmark(COLORS.dark),
  "vela-wordmark-paper.svg": wordmark(COLORS.paper),
  "vela-lockup.svg": horizontal(COLORS.dark),
  "vela-lockup-paper.svg": horizontal(COLORS.paper),
  "vela-lockup-white.svg": horizontal(COLORS.white),
  "vela-lockup-ink.svg": horizontal(COLORS.ink),
  "vela-lockup-ember.svg": horizontal(COLORS.ember),
  "vela-stacked.svg": stacked(COLORS.dark),
  "vela-stacked-paper.svg": stacked(COLORS.paper),
  "vela-icon.svg": icon(),
  "vela-icon-square.svg": icon({ round: 0 }),
  "vela-icon-maskable.svg": icon({ round: 0, scale: 0.46 }),
};
mkdirSync(join(here, "svg"), { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(join(here, "svg", name), text);
// What the app loads as image assets (one node per use).
mkdirSync(app, { recursive: true });
for (const name of ["vela-symbol.svg", "vela-symbol-paper.svg", "vela-lockup.svg", "vela-lockup-paper.svg", "vela-stacked.svg", "vela-stacked-paper.svg", "vela-icon.svg"]) writeFileSync(join(app, name), files[name]);

if (process.argv.includes("--png")) {
  const pw = process.env.PLAYWRIGHT_CORE || "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs";
  const { chromium } = await import(pw);
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  const shot = async (name, file, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${files[file].replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: join(here, "png", name), omitBackground: true });
  };
  mkdirSync(join(here, "png"), { recursive: true });
  for (const s of [16, 32, 48]) await shot(`favicon-${s}.png`, "vela-icon.svg", s);
  await shot("apple-touch-icon-180.png", "vela-icon-square.svg", 180);
  for (const s of [192, 512]) await shot(`vela-icon-${s}.png`, "vela-icon.svg", s);
  for (const s of [192, 512]) await shot(`vela-icon-maskable-${s}.png`, "vela-icon-maskable.svg", s);
  await browser.close();
}
