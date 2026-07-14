const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const sharedPackageRoot = path.resolve(workspaceRoot, 'packages/shared');
const sharedEntry = path.resolve(sharedPackageRoot, 'src/index.ts');
const sharedRoot = path.resolve(sharedPackageRoot, 'src');
const mobileNodeModules = path.resolve(projectRoot, 'node_modules');
const workspaceNodeModules = path.resolve(workspaceRoot, 'node_modules');

function resolvePackageRoot(packageName) {
  try {
    return path.dirname(require.resolve(path.join(packageName, 'package.json'), {
      paths: [mobileNodeModules, workspaceNodeModules],
    }));
  } catch {
    return null;
  }
}

const reactNativePackageJson = path.join(mobileNodeModules, 'react-native', 'package.json');
const reactNativeDependencyNames = fs.existsSync(reactNativePackageJson)
  ? Object.keys(require(reactNativePackageJson).dependencies ?? {})
  : [];
const mobilePackageJson = path.join(projectRoot, 'package.json');
const mobileDependencyNames = fs.existsSync(mobilePackageJson)
  ? [
      ...Object.keys(require(mobilePackageJson).dependencies ?? {}),
      ...Object.keys(require(mobilePackageJson).devDependencies ?? {}),
    ]
  : [];

function collectInstalledDependencyRoots(seedNames) {
  const roots = {};
  const queue = [...new Set(seedNames)];

  while (queue.length > 0) {
    const packageName = queue.shift();
    if (!packageName || roots[packageName]) {
      continue;
    }

    const packageRoot = resolvePackageRoot(packageName);
    if (!packageRoot) {
      continue;
    }

    roots[packageName] = packageRoot;
    const packageJsonPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = require(packageJsonPath);
    for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
      if (!roots[dependencyName]) {
        queue.push(dependencyName);
      }
    }
  }

  return roots;
}

const hoistedModules = Object.fromEntries(
  Object.entries(collectInstalledDependencyRoots([
    ...mobileDependencyNames,
    ...reactNativeDependencyNames,
    '@babel/runtime',
  ])),
);
const hoistedWorkspaceModuleRoots = Object.keys(hoistedModules)
  .map((packageName) => path.join(workspaceNodeModules, packageName))
  .filter((packageRoot) => fs.existsSync(packageRoot));

const singletonModules = {
  ...hoistedModules,
  react: path.join(mobileNodeModules, 'react'),
  'react-native': path.join(mobileNodeModules, 'react-native'),
  'react-i18next': path.join(workspaceNodeModules, 'react-i18next'),
  i18next: path.join(workspaceNodeModules, 'i18next'),
  zustand: path.join(workspaceNodeModules, 'zustand'),
  immer: path.join(workspaceNodeModules, 'immer'),
  '@react-native-async-storage/async-storage': path.join(
    mobileNodeModules,
    '@react-native-async-storage/async-storage',
  ),
};

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 */
const config = {
  watchFolders: [
    sharedPackageRoot,
    ...Object.values(singletonModules),
    ...hoistedWorkspaceModuleRoots,
  ],
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (Object.prototype.hasOwnProperty.call(singletonModules, moduleName)) {
        return context.resolveRequest(
          context,
          singletonModules[moduleName],
          platform,
        );
      }

      if (moduleName.startsWith('@babel/runtime/')) {
        const runtimePath = path.join(workspaceNodeModules, `${moduleName}.js`);
        return {
          type: 'sourceFile',
          filePath: runtimePath,
        };
      }

      if (moduleName === '@photo-manager/shared') {
        return {
          type: 'sourceFile',
          filePath: sharedEntry,
        };
      }

      if (moduleName.startsWith('@photo-manager/shared/')) {
        const relativePath = moduleName.replace('@photo-manager/shared/', '');
        return context.resolveRequest(
          context,
          path.join(sharedRoot, relativePath),
          platform,
        );
      }

      return context.resolveRequest(context, moduleName, platform);
    },
    nodeModulesPaths: [
      mobileNodeModules,
      workspaceNodeModules,
    ],
    extraNodeModules: {
      '@photo-manager/shared': sharedRoot,
      ...singletonModules,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
