const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function normalizeBounds(bounds, width, height) {
  if (!bounds) return null;
  const boxWidth = bounds.maxX - bounds.minX + 1;
  const boxHeight = bounds.maxY - bounds.minY + 1;
  return {
    pixels: bounds,
    widthRatio: boxWidth / width,
    heightRatio: boxHeight / height,
    centerX: (bounds.minX + bounds.maxX + 1) / 2 / width,
    centerY: (bounds.minY + bounds.maxY + 1) / 2 / height,
    margins: {
      left: bounds.minX / width,
      right: (width - bounds.maxX - 1) / width,
      top: bounds.minY / height,
      bottom: (height - bounds.maxY - 1) / height,
    },
  };
}

function findBounds(data, width, height, predicate) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!predicate(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= 0 ? { minX, minY, maxX, maxY } : null;
}

async function inspect(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const buffer = fs.readFileSync(absolutePath);
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  return {
    path: relativePath.replace(/\\/g, '/'),
    width: image.width,
    height: image.height,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    alphaBounds: normalizeBounds(
      findBounds(data, image.width, image.height, (_r, _g, _b, alpha) => alpha > 8),
      image.width,
      image.height,
    ),
    subjectBounds: normalizeBounds(
      findBounds(data, image.width, image.height, (red, green, blue, alpha) =>
        alpha > 80 && green > 90 && green > red * 1.3 && blue > red * 1.05),
      image.width,
      image.height,
    ),
  };
}

function assertClose(actual, expected, label, tolerance = 0.012) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} differs by ${Math.abs(actual - expected).toFixed(4)}`);
  }
}

function assertMatchesDesktop(asset, desktopSubject, label) {
  if (!asset.subjectBounds) throw new Error(`${label} subject could not be measured.`);
  const tolerance = Math.max(0.012, 1.5 / Math.min(asset.width, asset.height));
  assertClose(asset.subjectBounds.widthRatio, desktopSubject.widthRatio, `${label} subject width`, tolerance);
  assertClose(asset.subjectBounds.heightRatio, desktopSubject.heightRatio, `${label} subject height`, tolerance);
  assertClose(asset.subjectBounds.centerX, desktopSubject.centerX, `${label} subject centerX`, tolerance);
  assertClose(asset.subjectBounds.centerY, desktopSubject.centerY, `${label} subject centerY`, tolerance);
}

async function inspectCollection(paths) {
  return Promise.all(paths.map((relativePath) => inspect(relativePath)));
}

async function main() {
  const mobileAndroidRoot = path.join(repoRoot, 'packages/mobile/android/app/src/main/res');
  const mobileIosRoot = path.join(repoRoot, 'packages/mobile/ios/HelloWorld/Images.xcassets/AppIcon.appiconset');
  const hasMobileAssets = fs.existsSync(mobileAndroidRoot) && fs.existsSync(mobileIosRoot);
  const androidDensities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const androidLegacy = hasMobileAssets
    ? await inspectCollection(androidDensities.map((density) =>
      `packages/mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png`))
    : [];
  const androidRound = hasMobileAssets
    ? await inspectCollection(androidDensities.map((density) =>
      `packages/mobile/android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`))
    : [];
  const iosFileNames = [
    'Icon-20x20@2x.png',
    'Icon-20x20@3x.png',
    'Icon-29x29@2x.png',
    'Icon-29x29@3x.png',
    'Icon-40x40@2x.png',
    'Icon-40x40@3x.png',
    'Icon-60x60@2x.png',
    'Icon-60x60@3x.png',
    'Icon-1024x1024@1x.png',
  ];
  const ios = hasMobileAssets
    ? await inspectCollection(iosFileNames.map((fileName) =>
      `packages/mobile/ios/HelloWorld/Images.xcassets/AppIcon.appiconset/${fileName}`))
    : [];
  const assets = {
    master: await inspect('assets/branding/app-icon-master.png'),
    desktop: await inspect('packages/desktop/build/icon.png'),
    ...(hasMobileAssets ? {
      androidLegacy,
      androidRound,
      androidAdaptiveBackground: await inspect('packages/mobile/android/app/src/main/res/drawable-nodpi/ic_launcher_background.png'),
      androidAdaptiveForeground: await inspect('packages/mobile/android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png'),
      ios,
    } : {}),
  };
  const desktopSubject = assets.desktop.subjectBounds;
  if (!desktopSubject) throw new Error('Desktop icon subject could not be measured.');
  assertMatchesDesktop(assets.master, desktopSubject, 'master');
  let adaptiveSafeZone = null;
  if (hasMobileAssets) {
    assertMatchesDesktop(assets.androidAdaptiveBackground, desktopSubject, 'androidAdaptiveBackground');
    for (const [index, asset] of assets.androidLegacy.entries()) {
      assertMatchesDesktop(asset, desktopSubject, `androidLegacy.${androidDensities[index]}`);
    }
    for (const [index, asset] of assets.androidRound.entries()) {
      assertMatchesDesktop(asset, desktopSubject, `androidRound.${androidDensities[index]}`);
    }
    for (const asset of assets.ios) {
      assertMatchesDesktop(asset, desktopSubject, `ios.${path.basename(asset.path)}`);
      if (!asset.alphaBounds
        || asset.alphaBounds.pixels.minX !== 0
        || asset.alphaBounds.pixels.minY !== 0
        || asset.alphaBounds.pixels.maxX !== asset.width - 1
        || asset.alphaBounds.pixels.maxY !== asset.height - 1) {
        throw new Error(`${asset.path} is not fully opaque.`);
      }
    }
    const adaptiveSubject = assets.androidAdaptiveBackground.subjectBounds;
    adaptiveSafeZone = Boolean(
      adaptiveSubject
      && adaptiveSubject.margins.left >= 0.17
      && adaptiveSubject.margins.right >= 0.17
      && adaptiveSubject.margins.top >= 0.17
      && adaptiveSubject.margins.bottom >= 0.17,
    );
    if (!adaptiveSafeZone) {
      throw new Error('Android adaptive icon subject exceeds the central safe zone.');
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    masterSource: 'assets/branding/app-icon-master.png',
    visualReference: 'packages/desktop/build/icon.png',
    desktopBuildSource: 'packages/desktop/build/icon.ico',
    mobileAssetsIncluded: hasMobileAssets,
    androidManifest: hasMobileAssets ? {
      icon: '@mipmap/ic_launcher',
      roundIcon: '@mipmap/ic_launcher_round',
      adaptiveXmlPresent: fs.existsSync(path.join(
        repoRoot,
        'packages/mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
      )),
    } : null,
    iosAppIconSet: hasMobileAssets
      ? 'packages/mobile/ios/HelloWorld/Images.xcassets/AppIcon.appiconset/Contents.json'
      : null,
    adaptiveSafeZone,
    assets,
  };
  fs.writeFileSync(
    path.join(repoRoot, 'ICON_AUDIT.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log('icon consistency audit passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
