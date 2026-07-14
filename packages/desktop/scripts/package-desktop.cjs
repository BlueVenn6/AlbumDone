const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const desktopRoot = path.join(repoRoot, 'packages/desktop');
const desktopPackage = require(path.join(desktopRoot, 'package.json'));
const npmCli = process.env.npm_execpath;
const builderCli = require.resolve('electron-builder/out/cli/cli.js');

if (!npmCli) {
  throw new Error('npm_execpath is unavailable; run this script through npm.');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${output ? `\n${output}` : ''}`);
  }

  return (result.stdout ?? '').trimEnd();
}

function git(args) {
  return run('git', args, { cwd: repoRoot, capture: true });
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function hashTree(root) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        const relative = path.relative(root, fullPath).replaceAll(path.sep, '/');
        entries.push(`${relative}\0${hash(fs.readFileSync(fullPath))}`);
      }
    }
  };
  visit(root);
  return hash(entries.join('\n'));
}

const buildStartedAt = new Date();
const head = git(['rev-parse', 'HEAD']);
const gitStatus = git(['status', '--short']);
const changedFiles = gitStatus
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3));
const timestamp = buildStartedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const buildId = `${timestamp}-${head.slice(0, 8)}${gitStatus ? '-dirty' : ''}`;
const sourceSnapshot = {
  currentHead: head,
  gitStatus,
  changedFiles,
  buildId,
  buildStartedAt: buildStartedAt.toISOString(),
  desktopVersion: desktopPackage.version,
  desktopSourceSha256: hashTree(path.join(desktopRoot, 'src')),
  sharedSourceSha256: hashTree(path.join(repoRoot, 'packages/shared/src')),
  workingTreeDiffSha256: hash(git(['diff', '--binary', 'HEAD'])),
};

console.log(JSON.stringify(sourceSnapshot, null, 2));

run(process.execPath, [npmCli, 'run', 'clean:package'], { cwd: desktopRoot });
run(process.execPath, [npmCli, 'run', 'build'], { cwd: desktopRoot });

const distManifestPath = path.join(desktopRoot, 'dist/build-source.json');
fs.writeFileSync(distManifestPath, `${JSON.stringify(sourceSnapshot, null, 2)}\n`, 'utf8');

run(process.execPath, [builderCli, '--win', 'nsis'], {
  cwd: desktopRoot,
  env: { ...process.env, ALBUMDONE_BUILD_ID: buildId },
});

const releaseDirectory = path.join(desktopRoot, 'release');
const installers = fs.readdirSync(releaseDirectory)
  .filter((name) => name.toLowerCase().endsWith('.exe'))
  .map((name) => path.join(releaseDirectory, name));

if (installers.length !== 1) {
  throw new Error(`Expected exactly one installer, found ${installers.length}: ${installers.join(', ')}`);
}

const artifactPath = installers[0];
const artifactStat = fs.statSync(artifactPath);
const buildFinishedAt = new Date();
const releaseRecord = {
  ...sourceSnapshot,
  buildFinishedAt: buildFinishedAt.toISOString(),
  artifactPath: path.relative(repoRoot, artifactPath).replaceAll(path.sep, '/'),
  artifactFileName: path.basename(artifactPath),
  artifactSize: artifactStat.size,
  artifactModifiedAt: artifactStat.mtime.toISOString(),
  artifactSha256: hash(fs.readFileSync(artifactPath)),
};

fs.writeFileSync(
  path.join(releaseDirectory, 'build-record.json'),
  `${JSON.stringify(releaseRecord, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(releaseRecord, null, 2));
