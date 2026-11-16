const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
process.chdir(path.join(__dirname, '..'));
const cap = (...args) => execFileSync(process.execPath, [require.resolve('@capacitor/cli/bin/capacitor'), ...args], { stdio: 'inherit' });
if (!fs.existsSync('android')) cap('add', 'android');
cap('sync', 'android');
require('./patch-manifest');
