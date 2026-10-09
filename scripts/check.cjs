const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json')));
if (manifest.manifest_version !== 3) throw new Error('Manifest must use V3.');
for (const file of ['background.js', 'popup.html', ...manifest.content_scripts.flatMap((entry) => entry.js)]) {
  if (!fs.existsSync(path.join(root, 'extension', file))) throw new Error(`Missing ${file}`);
}
for (const file of fs.readdirSync(path.join(root, 'extension')).filter((file) => file.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', path.join(root, 'extension', file)]);
}
for (const [size, file] of Object.entries(manifest.icons || {})) {
  const image = fs.readFileSync(path.join(root, 'extension', file));
  if (image.readUInt32BE(16) !== Number(size) || image.readUInt32BE(20) !== Number(size)) throw new Error('Wrong icon dimensions: ' + file);
}
if (manifest.version !== JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version) throw new Error('Package and manifest versions differ.');
console.log('Manifest references, icon dimensions, version and extension JavaScript syntax pass.');
