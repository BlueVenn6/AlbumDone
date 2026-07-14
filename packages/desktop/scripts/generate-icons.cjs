// Generate every platform icon from one tracked master image. The generated
// Desktop PNG is the visual reference used by the consistency audit.
//
// Usage: node scripts/generate-icons.cjs
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const pngToIco = require('png-to-ico');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const mobileRoot = path.join(repoRoot, 'packages', 'mobile');
const SOURCE = path.join(repoRoot, 'assets', 'branding', 'app-icon-master.png');
const ADAPTIVE_BACKGROUND = '#051B3A';

async function resizePng(image, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}

async function resizePngOpaqueRgb(image, size, background) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);

  return canvas.toBuffer('image/png');
}

function transparentPng(size) {
  return createCanvas(size, size).toBuffer('image/png');
}

// Round-masked variant for Android ic_launcher_round
async function resizePngRound(image, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, 0, 0, size, size);
  ctx.restore();
  return canvas.toBuffer('image/png');
}

async function writePng(buf, outPath) {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, buf);
  console.log('  wrote', path.relative(repoRoot, outPath));
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Source icon not found: ${SOURCE}`);
  }
  const image = await loadImage(SOURCE);
  console.log(`Source: ${image.width}x${image.height}`);

  // ---- 1. Desktop Windows .ico (multi-size) ----
  console.log('\n[Desktop] generating build/icon.ico');
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = await Promise.all(icoSizes.map((s) => resizePng(image, s)));
  const icoBuf = await pngToIco(icoPngs);
  await fs.promises.writeFile(path.join(desktopRoot, 'build', 'icon.ico'), icoBuf);
  console.log('  wrote packages/desktop/build/icon.ico');
  // Also keep a 512 png (electron-builder linux / fallback)
  await writePng(await resizePng(image, 512), path.join(desktopRoot, 'build', 'icon.png'));

  // ---- 2. Android mipmap densities ----
  console.log('\n[Android] generating mipmap launcher icons');
  const androidDensities = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
  };
  const androidResRoot = path.join(mobileRoot, 'android', 'app', 'src', 'main', 'res');
  for (const [dir, size] of Object.entries(androidDensities)) {
    await writePng(await resizePng(image, size), path.join(androidResRoot, dir, 'ic_launcher.png'));
    await writePng(await resizePngRound(image, size), path.join(androidResRoot, dir, 'ic_launcher_round.png'));
  }

  // Android 8+ adaptive icon. The complete master is the background layer so
  // launcher safe-zone scaling cannot shrink the logo a second time.
  console.log('\n[Android] generating adaptive icon layers');
  await writePng(
    await resizePngOpaqueRgb(image, 432, ADAPTIVE_BACKGROUND),
    path.join(androidResRoot, 'drawable-nodpi', 'ic_launcher_background.png'),
  );
  await writePng(
    transparentPng(432),
    path.join(androidResRoot, 'drawable-nodpi', 'ic_launcher_foreground.png'),
  );
  const adaptiveXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@drawable/ic_launcher_background" />',
    '    <foreground android:drawable="@drawable/ic_launcher_foreground" />',
    '</adaptive-icon>',
    '',
  ].join('\n');
  const adaptiveDir = path.join(androidResRoot, 'mipmap-anydpi-v26');
  await fs.promises.mkdir(adaptiveDir, { recursive: true });
  await fs.promises.writeFile(path.join(adaptiveDir, 'ic_launcher.xml'), adaptiveXml);
  await fs.promises.writeFile(path.join(adaptiveDir, 'ic_launcher_round.xml'), adaptiveXml);
  console.log('  wrote Android adaptive icon XML resources');

  // ---- 3. iOS AppIcon assets ----
  // iOS launcher icons must be opaque. Drawing the same full-canvas master on
  // the brand background preserves the Desktop subject scale and centering.
  console.log('\n[iOS] generating AppIcon assets');
  const iosAppIconRoot = path.join(
    mobileRoot,
    'ios',
    'HelloWorld',
    'Images.xcassets',
    'AppIcon.appiconset',
  );
  const iosIcons = {
    'Icon-20x20@2x.png': 40,
    'Icon-20x20@3x.png': 60,
    'Icon-29x29@2x.png': 58,
    'Icon-29x29@3x.png': 87,
    'Icon-40x40@2x.png': 80,
    'Icon-40x40@3x.png': 120,
    'Icon-60x60@2x.png': 120,
    'Icon-60x60@3x.png': 180,
    'Icon-1024x1024@1x.png': 1024,
  };
  for (const [fileName, size] of Object.entries(iosIcons)) {
    await writePng(
      await resizePngOpaqueRgb(image, size, ADAPTIVE_BACKGROUND),
      path.join(iosAppIconRoot, fileName),
    );
  }

  console.log('\nAll Desktop, Android, and iOS icons generated.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
