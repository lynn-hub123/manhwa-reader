'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function build(sourceDirectory, outputDirectory) {
  const source = fs.realpathSync(sourceDirectory);
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output) && (fs.lstatSync(output).isSymbolicLink() || fs.readdirSync(output).length)) {
    throw new Error('Output must be empty; refusing to overwrite existing files');
  }
  const { assets } = require(path.join(source, 'pwa-assets.js'));
  const names = [...new Set(assets.filter(name => name !== './').map(name => name.replace(/^\.\//, '')).concat([
    'service-worker.js', 'vendor/pdfjs/LICENSE', 'vendor/pdfjs/README.md', 'fonts/OFL.txt'
  ]))].sort();
  // Resolve every source before creating output, so missing assets fail closed.
  const entries = names.map(name => {
    if (path.isAbsolute(name) || name.split('/').includes('..') || name.includes('\\')) throw new Error('Invalid asset path');
    const input = path.join(source, name);
    const resolved = fs.realpathSync(input);
    if (!resolved.startsWith(source + path.sep) || !fs.lstatSync(input).isFile()) throw new Error('Asset escapes the source root');
    const bytes = fs.readFileSync(input);
    return { path: name, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  for (const entry of entries) {
    const destination = path.join(output, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.bytes, { flag: 'wx' });
  }
  return { output, count: entries.length, bytes: entries.reduce((sum, item) => sum + item.bytes.length, 0),
    files: entries.map(({ path, sha256 }) => ({ path, sha256 })) };
}
module.exports = { build };
if (require.main === module) {
  try { console.log(JSON.stringify(build(path.resolve(__dirname, '..'), process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
