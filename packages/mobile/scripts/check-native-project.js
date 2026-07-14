const fs = require('node:fs');
const path = require('node:path');

const platform = process.argv[2];
const validPlatforms = new Set(['android', 'ios']);

if (!platform || !validPlatforms.has(platform)) {
  console.error('Usage: node ./scripts/check-native-project.js <android|ios>');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
const targetDir = path.join(projectRoot, platform);

if (fs.existsSync(targetDir)) {
  process.exit(0);
}

const platformLabel = platform === 'android' ? 'Android' : 'iOS';

console.error(
  [
    `Missing native ${platformLabel} project: ${platform}/`,
    'This workspace currently has only the JavaScript app files for React Native.',
    'Create native folders first, then run this command again.',
    'Tip: generate a temporary RN project and copy its android/ios folders into packages/mobile.',
  ].join('\n'),
);
process.exit(1);
