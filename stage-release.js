const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const target = path.join(root, '.release', 'app');
fs.mkdirSync(target, { recursive: true });
for (const entry of ['main.js', 'preload.js', 'src/session-guard.js', 'src/update-check.js', 'src/desktop-improvements.js', 'src/statement.js', 'src/google-oauth.json', 'src/db', 'src/renderer']) {
  const destination = path.join(target, entry);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(path.join(root, entry), destination, { recursive: true });
}
const { build, devDependencies, scripts, ...manifest } = require('./package.json');
const copied = new Set();
function copyDependencies(names, from) {
  for (const name of Object.keys(names || {})) {
    let current=from, source;
    while(current.startsWith(root)) {
      const candidate=path.join(current,'node_modules',name);
      if(fs.existsSync(path.join(candidate,'package.json'))) {source=candidate;break;}
      const parent=path.dirname(current);if(parent===current)break;current=parent;
    }
    if(!source)throw Error('Missing production dependency: '+name);
    if(copied.has(source))continue;copied.add(source);
    fs.cpSync(source,path.join(target,path.relative(root,source)),{recursive:true});
    const dependency=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
    copyDependencies(dependency.dependencies,source);
  }
}
copyDependencies(manifest.dependencies,root);
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2));
console.log('Prepared application-only release staging folder.');
