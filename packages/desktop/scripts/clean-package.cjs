const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const generatedTargets = [
  path.join(repoRoot, 'packages/shared/dist'),
  path.join(repoRoot, 'packages/desktop/dist'),
  path.join(repoRoot, 'packages/desktop/release'),
];

for (const target of generatedTargets) {
  const relative = path.relative(repoRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.length === 0) {
    throw new Error(`Refusing to remove path outside the repository: ${target}`);
  }

  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed generated output: ${relative}`);
}
