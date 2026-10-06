/* Browser asset generated from the single, backend-owned public catalogue. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'backend/replicate_catalog.json'), 'utf8'));
const json = JSON.stringify(catalog).replace(/</g, '\\u003c');
fs.writeFileSync(path.join(root, 'replicate-catalog.js'), `/* Generated from backend/replicate_catalog.json; check with npm run check. */
(function (root) {
    'use strict';
    const catalog = ${json};
    if (typeof module === 'object' && module.exports) module.exports = catalog;
    else root.ReplicateCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis);
`);
