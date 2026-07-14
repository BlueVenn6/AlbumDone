const fs = require('fs');
const path = require('path');

const [sourceDir, targetDir] = process.argv.slice(2);

if (!sourceDir || !targetDir) {
  throw new Error('Usage: prepare-react-native-gradle-plugin.cjs <source> <target>');
}

const sourceBuildFile = path.join(sourceDir, 'build.gradle.kts');
const marker = 'kotlin { jvmToolchain(17) }';
const buildScript = fs.readFileSync(sourceBuildFile, 'utf8');

if (!buildScript.includes(marker)) {
  throw new Error(`Expected React Native Gradle plugin marker was not found: ${marker}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(sourceDir, targetDir, {
  recursive: true,
  filter(source) {
    const relative = path.relative(sourceDir, source);
    return relative !== '.gradle'
      && !relative.startsWith(`.gradle${path.sep}`)
      && relative !== 'build'
      && !relative.startsWith(`build${path.sep}`);
  },
});

const targetBuildFile = path.join(targetDir, 'build.gradle.kts');
fs.writeFileSync(
  targetBuildFile,
  buildScript.replace(
    marker,
    '// Windows ARM64 builds use the explicit JAVA_HOME JDK configured by the app build.',
  ),
);
