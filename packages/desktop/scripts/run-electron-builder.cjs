const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const desktopRoot = path.join(repoRoot, 'packages/desktop');

function sameRealPath(left, right) {
  const leftPath = fs.realpathSync(left);
  const rightPath = fs.realpathSync(right);
  return process.platform === 'win32'
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function withWorkspaceNodeModules(callback, options = {}) {
  const rootNodeModules = options.rootNodeModules ?? path.join(repoRoot, 'node_modules');
  const desktopNodeModules = options.desktopNodeModules ?? path.join(desktopRoot, 'node_modules');

  if (!fs.existsSync(rootNodeModules)) {
    throw new Error(`Workspace dependencies are missing: ${rootNodeModules}`);
  }

  let removeLinkAfterBuild = false;
  if (fs.existsSync(desktopNodeModules)) {
    const existing = fs.lstatSync(desktopNodeModules);
    if (existing.isSymbolicLink()) {
      if (!sameRealPath(desktopNodeModules, rootNodeModules)) {
        throw new Error(`Desktop node_modules points to an unexpected location: ${desktopNodeModules}`);
      }
      removeLinkAfterBuild = true;
    }
  } else {
    fs.symlinkSync(
      rootNodeModules,
      desktopNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    removeLinkAfterBuild = true;
    console.log(`Linked desktop node_modules to workspace dependencies: ${desktopNodeModules}`);
  }

  try {
    return callback();
  } finally {
    if (removeLinkAfterBuild && fs.existsSync(desktopNodeModules)) {
      const linkedPath = fs.lstatSync(desktopNodeModules);
      if (!linkedPath.isSymbolicLink() || !sameRealPath(desktopNodeModules, rootNodeModules)) {
        throw new Error(`Refusing to remove changed desktop node_modules link: ${desktopNodeModules}`);
      }
      fs.unlinkSync(desktopNodeModules);
      console.log(`Removed temporary desktop node_modules link: ${desktopNodeModules}`);
    }
  }
}

function resolveElectronBuilderCli(options = {}) {
  return require.resolve('electron-builder/out/cli/cli.js', {
    paths: options.searchPaths ?? [desktopRoot, repoRoot],
  });
}

function runElectronBuilder(builderArgs, options = {}) {
  return withWorkspaceNodeModules(() => {
    const builderCli = resolveElectronBuilderCli(options);
    const result = spawnSync(process.execPath, [builderCli, ...builderArgs], {
      cwd: desktopRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: 'inherit',
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`electron-builder ${builderArgs.join(' ')} failed with exit code ${result.status}`);
    }
  }, options);
}

if (require.main === module) {
  try {
    runElectronBuilder(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  resolveElectronBuilderCli,
  runElectronBuilder,
  withWorkspaceNodeModules,
};
