'use strict';
// Build-time only. Pass the bundled sharp module; no app/runtime dependency is added.
const fs = require('node:fs');
const path = require('node:path');
async function generate(sharpPath) {
  const sharp = require(sharpPath);
  const root = path.resolve(__dirname, '..');
  const svg = path.join(root, 'icons', 'icon.svg');
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const target = path.join(root, 'icons', name);
    if (fs.existsSync(target)) throw new Error('Refusing to overwrite ' + target);
    await sharp(svg).resize(size, size).flatten({ background: '#181B22' }).png().toFile(target);
  }
  const mask = path.join(root, 'icons', 'maskable-512.png');
  if (fs.existsSync(mask)) throw new Error('Refusing to overwrite ' + mask);
  const foreground = await sharp(svg).resize(410, 410).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#181B22' } })
    .composite([{ input: foreground, left: 51, top: 51 }]).png().toFile(mask);
}
generate(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
