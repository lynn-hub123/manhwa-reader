'use strict';
// Synthetic test PDF only; never a user's library or copyrighted sample.
const fs = require('node:fs');
const path = require('node:path');
function pdf(height) {
  const objects = [null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let page = 1; page <= 3; page++) {
    const stream = `q 0.93 0.94 0.98 rg 0 0 600 ${height} re f 0.54 0.38 0.85 rg 35 ${height - 160} 530 100 re f Q\nBT /F1 32 Tf 55 ${height - 100} Td (MOBILE TEST - PAGE ${page}) Tj ET\nBT /F1 20 Tf 50 100 Td (Synthetic PDF / no private data) Tj ET\n`;
    const contentId = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(body + `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const output = path.resolve(process.argv[2]);
if (!fs.existsSync(output)) throw new Error('Create the explicit fixture directory first');
for (const [name, height] of [['mobile-smoke.pdf', 840], ['mobile-webtoon.pdf', 1800]]) {
  const target = path.join(output, name);
  fs.writeFileSync(target, pdf(height), { flag: 'wx' });
  console.log(target);
}
