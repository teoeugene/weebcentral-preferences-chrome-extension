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
console.log('Manifest references and extension JavaScript syntax pass.');
