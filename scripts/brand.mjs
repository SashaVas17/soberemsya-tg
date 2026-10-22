// Renders the Flockly brand images into public/brand/ (graphite and coral,
// 2026-10-22; see docs/notes/Дизайн.md). Run from the repository root:
//   node scripts/brand.mjs
// Needs Chromium for Playwright; CHROME_PATH points to another one
// (in the cloud: /opt/pw-browsers/chromium-*/chrome-linux/chrome).
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const fontData = (path) =>
  `data:font/woff2;base64,${readFileSync(`node_modules/@fontsource-variable/${path}`).toString("base64")}`;
const fonts = `
@font-face{font-family:U;src:url("${fontData("unbounded/files/unbounded-latin-wght-normal.woff2")}") format("woff2");font-weight:200 900}
@font-face{font-family:G;src:url("${fontData("golos-text/files/golos-text-cyrillic-wght-normal.woff2")}") format("woff2");font-weight:400 900;unicode-range:U+0400-04FF}
@font-face{font-family:G;src:url("${fontData("golos-text/files/golos-text-latin-wght-normal.woff2")}") format("woff2");font-weight:400 900}`;

const css = `${fonts}
html,body{margin:0}
.c{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--gap,0);position:relative;overflow:hidden;color:var(--ink)}
.dark{background:#141416;--ink:#f8f8f8;--sub:#b4b4ba}
.light{background:#efefed;--ink:#26262b;--sub:#505057}
.w{position:relative;font-family:U;font-weight:700;letter-spacing:-0.03em;display:flex;align-items:baseline;line-height:1}
.dot{display:inline-block;border-radius:50%;background:#f04438}
.dot.glow{background:radial-gradient(circle at 35% 30%,#ff8a7a,#f04438 60%)}
.blob{position:absolute;border-radius:50%;filter:blur(70px)}
.sub{position:relative;font-family:G;font-weight:500;color:var(--sub);letter-spacing:-0.01em}`;

const glow = (r) => `box-shadow:0 0 ${r}px rgba(240,68,56,.7),0 0 ${r * 2.4}px rgba(240,68,56,.35)`;
/** "flockly" with the "o" as a coral circle the size of the x-height. */
const word = (size, glowing = false) =>
  `<div class="w" style="font-size:${size}px">fl<span class="dot${glowing ? " glow" : ""}" style="width:${size * 0.58}px;height:${size * 0.58}px;margin:0 ${size * 0.02}px;${glowing ? glow(size * 0.19) : ""}"></span>ckly</div>`;
/** The compact mark "f●". */
const mark = (size) =>
  `<div class="w" style="font-size:${size}px">f<span class="dot glow" style="width:${size * 0.36}px;height:${size * 0.36}px;margin-left:${size * 0.05}px;${glow(size * 0.125)}"></span></div>`;

/** Soft coral and amber fields over graphite, scaled to the canvas. */
const sunset = (w, h) => {
  const s = Math.min(w, h);
  return `<div class="blob" style="width:${s * 0.5}px;height:${s * 0.5}px;left:-${s * 0.12}px;top:-${s * 0.2}px;background:#f04438;opacity:.55"></div>
<div class="blob" style="width:${s * 0.45}px;height:${s * 0.45}px;right:-${s * 0.12}px;top:${h * 0.2}px;background:#ff9a5c;opacity:.35"></div>
<div class="blob" style="width:${s * 0.5}px;height:${s * 0.5}px;left:${w * 0.1}px;bottom:-${s * 0.3}px;background:#4a4a55;opacity:.7"></div>`;
};
/** One coral glow in the corner, as in the app. */
const corner = (w, h, opacity = 0.35) =>
  `<div class="blob" style="width:${Math.min(w, h) * 1.1}px;height:${Math.min(w, h) * 1.1}px;left:-${Math.min(w, h) * 0.5}px;top:-${Math.min(w, h) * 0.6}px;background:#f04438;opacity:${opacity}"></div>`;

const tagline = "Время и место для встречи — вместе";

const images = [
  // Bot avatar (BotFather /setuserpic): the name, its "o" glowing.
  ["avatar.png", 640, 640, "dark", sunset(640, 640) + word(128, true)],
  // Logo: graphite with one corner glow (variant 2), and a light copy.
  ["logo.png", 1600, 640, "dark", corner(1600, 640) + word(210)],
  ["logo-light.png", 1600, 640, "light", corner(1600, 640, 0.18) + word(210)],
  // The mark f● for small places: app icons and the browser tab.
  ["mark.png", 512, 512, "dark", sunset(512, 512) + mark(256)],
  ["apple-touch-icon.png", 180, 180, "dark", sunset(180, 180) + mark(90)],
  ["favicon-32.png", 32, 32, "dark", mark(20)],
  // Link preview (Open Graph) and the bot's description picture (640×360).
  ["og.png", 1200, 630, "dark", `${corner(1200, 630)}${word(150)}<div class="sub" style="font-size:40px">${tagline}</div>`, "48px"],
  ["description.png", 640, 360, "dark", `${sunset(640, 360)}${word(92, true)}<div class="sub" style="font-size:24px">${tagline}</div>`, "26px"],
];

mkdirSync("public/brand", { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const [name, width, height, theme, inner, gap] of images) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<style>${css}</style><div class="c ${theme}" style="width:${width}px;height:${height}px;${gap ? `--gap:${gap}` : ""}">${inner}</div>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `public/brand/${name}` });
  await page.close();
  console.log(`public/brand/${name}`);
}
await browser.close();
