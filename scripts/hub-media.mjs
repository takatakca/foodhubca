// Turns the console stills (scripts/hub-shots.mjs, 1280×800 at 2×) into the WebP files of the public landing
// (public/hub-media/). Run: node scripts/hub-media.mjs <folder of PNG stills>. Sizes are the ones listed in
// lib/foodhub/public-hub-tour.ts (HUB_SHOTS); tests/public-hub-tour.test.ts checks that every file exists.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = process.argv[2];
const OUT = path.resolve('public/hub-media');
if (!SRC) throw new Error('usage: node scripts/hub-media.mjs <folder of PNG stills>');
fs.mkdirSync(OUT, { recursive: true });

// name in the stills folder → { out, widths, crop (CSS px of the 1280×800 frame, ×2 in the file) }
const JOBS = [
  { src: 'orders-board', out: 'orders', widths: [1280, 768] },
  { src: 'overview', out: 'today', widths: [1280, 768] },
  { src: 'insights', out: 'reports', widths: [1280, 768] },
  { src: 'kitchen', out: 'kitchen', widths: [1280, 768] },
  { src: 'kitchen-new-order', out: 'new-order', widths: [960, 560], crop: { left: 216, top: 150, width: 848, height: 500 } },
];

for (const job of JOBS) for (const lang of ['fr', 'en']) {
  const file = path.join(SRC, `${job.src}${lang === 'fr' ? '' : '-en'}.png`);
  for (const w of job.widths) {
    let img = sharp(file);
    if (job.crop) img = img.extract({ left: job.crop.left * 2, top: job.crop.top * 2, width: job.crop.width * 2, height: job.crop.height * 2 });
    const dest = path.join(OUT, `${job.out}-${lang}-${w}.webp`);
    await img.resize({ width: w }).webp({ quality: 80, effort: 6 }).toFile(dest);
    const meta = await sharp(dest).metadata();
    console.log(path.basename(dest), `${meta.width}×${meta.height}`, `${Math.round(fs.statSync(dest).size / 1024)} KB`);
  }
}
// The customer ordering page on a phone (390×844 at 3×): one French still, the page's own first language.
for (const w of [780, 390]) {
  const dest = path.join(OUT, `ordering-phone-${w}.webp`);
  await sharp(path.join(SRC, 'ordering-phone.png')).extract({ left: 0, top: 0, width: 1170, height: 2100 }).resize({ width: w }).webp({ quality: 80, effort: 6 }).toFile(dest);
  const meta = await sharp(dest).metadata();
  console.log(path.basename(dest), `${meta.width}×${meta.height}`, `${Math.round(fs.statSync(dest).size / 1024)} KB`);
}
