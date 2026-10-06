const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [i, match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
    if (match[1].trim()) new vm.Script(match[1], { filename: `index.html script ${i}` });
}
for (const file of ['research-core.js', 'research-workspace.js', 'creator-core.js', 'creator-studio.js', 'replicate-catalog.js', 'replicate-value.js', 'replicate-studio.js', 'video-production.js']) {
    new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
require('node:assert/strict').deepEqual(require('../replicate-catalog.js'), require('../backend/replicate_catalog.json'), 'Regenerate replicate-catalog.js from the backend catalog.');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML ids.');
console.log('All application scripts parse; HTML ids are unique.');
