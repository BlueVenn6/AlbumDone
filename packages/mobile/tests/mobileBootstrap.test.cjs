const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(mobileRoot, 'index.js'), 'utf8');

const storageSetup = entry.indexOf('globalThis.localStorage = AsyncStorage');
const appLoad = entry.indexOf("require('./src/App')");

assert(storageSetup >= 0, 'Mobile must install AsyncStorage as the settings persistence adapter.');
assert(appLoad > storageSetup, 'Settings storage must be configured before App stores are imported.');
assert(!fs.existsSync(path.join(mobileRoot, 'src/components/InstructionPanel.tsx')));
assert(!fs.existsSync(path.join(mobileRoot, 'src/hooks/useImageAnalysis.ts')));

console.log('mobile bootstrap persistence and legacy cleanup tests passed');
