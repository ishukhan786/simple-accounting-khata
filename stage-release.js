const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const target = path.join(root, '.release', 'app');
fs.mkdirSync(target, { recursive: true });
for (const entry of ['main.js', 'preload.js', 'src/session-guard.js', 'src/google-oauth.json', 'src/db', 'src/renderer', 'node_modules/sql.js']) {
  const destination = path.join(target, entry);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(path.join(root, entry), destination, { recursive: true });
}
const { build, devDependencies, scripts, ...manifest } = require('./package.json');
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2));
console.log('Prepared application-only release staging folder.');
