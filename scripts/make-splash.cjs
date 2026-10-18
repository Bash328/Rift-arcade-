// Makes the iPhone launch images (the screen shown while a home-screen web app opens) and prints the <link> tags
// that point at them. Run it whenever the name or colours change, then paste the tags into each page's <head>.
//
//   npm i --no-save puppeteer-core sharp        (neither is a project dependency)
//   node scripts/make-splash.cjs "RIFT" "ARCADE" "#120826" "#35e5ff"
//
// Arguments: first word, second word (shown in the accent colour), background colour, accent colour.
// Needs Google Chrome; set CHROME to its path if it is not in the usual place. Images go to public/splash.
const puppeteer = require("puppeteer-core");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const [first = "RIFT", second = "ARCADE", bg = "#120826", accent = "#35e5ff"] = process.argv.slice(2);
const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const out = path.join(__dirname, "..", "public", "splash");
fs.mkdirSync(out, { recursive: true });

// [CSS width, CSS height, pixel ratio] in portrait: iPhone 8 up to the 16 Pro Max. Add a row for a new model.
const devices = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [390, 844, 3],
  [375, 812, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2],
];

// A flat lightning bolt (swap this <path> for your own logo) and the name, on a solid colour.
const page = (w, h) => {
  const m = Math.min(w, h);
  return `<!doctype html><html><head><style>
  @import url("https://fonts.googleapis.com/css2?family=Orbitron:wght@800&display=swap");
  html,body{margin:0;width:${w}px;height:${h}px;background:${bg};overflow:hidden}
  .c{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:${m * 0.04}px}
  svg{width:${m * 0.3}px;height:${m * 0.3}px}
  p{margin:0;font:800 ${m * 0.07}px/1 Orbitron,"Arial Black",sans-serif;letter-spacing:.18em;color:#fff}
  p span{color:${accent}}
</style></head><body><div class="c"><svg viewBox="150 50 220 410"><path d="M290 70 170 290h78l-36 152 140-227h-80z" fill="#ff2bd6" stroke="${accent}" stroke-width="16" stroke-linejoin="round"/></svg><p>${first} <span>${second}</span></p></div></body></html>`;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"] });
  const tags = [];
  for (const [cw, ch, ratio] of devices) {
    for (const landscape of [false, true]) {
      const px = landscape ? [ch * ratio, cw * ratio] : [cw * ratio, ch * ratio];
      const file = `${px[0]}x${px[1]}.png`;
      const tab = await browser.newPage();
      await tab.setViewport({ width: px[0], height: px[1], deviceScaleFactor: 1 });
      await tab.setContent(page(px[0], px[1]), { waitUntil: "networkidle0" });
      await tab.evaluate(() => document.fonts.ready);
      const shot = await tab.screenshot({ type: "png" });
      await sharp(shot).png({ palette: true, colors: 12, dither: 0, compressionLevel: 9, effort: 10 }).toFile(path.join(out, file));
      await tab.close();
      // The media query must match the phone exactly: CSS size, pixel ratio and orientation.
      tags.push(`<link rel="apple-touch-startup-image" href="/splash/${file}" media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${landscape ? "landscape" : "portrait"})" />`);
    }
  }
  await browser.close();
  console.log(tags.join("\n"));
})();
