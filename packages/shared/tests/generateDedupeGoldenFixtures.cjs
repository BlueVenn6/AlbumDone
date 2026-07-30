const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const outputDir = path.join(__dirname, 'fixtures', 'dedupe-golden');

function makeScene(width = 960, height = 640) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#dceef2';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#5a8f62';
  context.fillRect(0, height * 0.58, width, height * 0.42);
  context.fillStyle = '#f6c453';
  context.beginPath();
  context.arc(width * 0.78, height * 0.2, width * 0.08, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#39546b';
  context.fillRect(width * 0.12, height * 0.34, width * 0.25, height * 0.3);
  context.fillStyle = '#f7f7f2';
  context.fillRect(width * 0.17, height * 0.4, width * 0.07, height * 0.1);
  context.fillRect(width * 0.27, height * 0.4, width * 0.06, height * 0.1);
  return canvas;
}

function makeBurst(offset) {
  const canvas = makeScene();
  const context = canvas.getContext('2d');
  context.fillStyle = '#7c3548';
  context.beginPath();
  context.arc(420 + offset, 410, 44, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#20252a';
  context.fillRect(408 + offset, 450, 24, 105);
  context.fillRect(370 + offset, 480, 62, 18);
  context.fillRect(430 + offset, 480, 62, 18);
  return canvas;
}

function makeScreenshot(changed) {
  const canvas = createCanvas(720, 1280);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8fafc';
  context.fillRect(0, 0, 720, 1280);
  context.fillStyle = '#0b2545';
  context.fillRect(0, 0, 720, 110);
  context.fillStyle = '#d7e2ec';
  for (let row = 0; row < 12; row += 1) {
    context.fillRect(54, 160 + row * 80, 500 - (row % 3) * 70, 18);
    context.fillRect(54, 190 + row * 80, 340 + (row % 2) * 90, 12);
  }
  context.fillStyle = changed ? '#c43d3d' : '#1f8a70';
  context.fillRect(520, 160 + 5 * 80, 120, 50);
  return canvas;
}

function makePose(raisedArm) {
  const canvas = createCanvas(640, 960);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ece5da';
  context.fillRect(0, 0, 640, 960);
  context.fillStyle = '#3f6c82';
  context.beginPath();
  context.arc(320, 250, 78, 0, Math.PI * 2);
  context.fill();
  context.fillRect(270, 330, 100, 310);
  context.fillRect(240, 620, 42, 220);
  context.fillRect(358, 620, 42, 220);
  if (raisedArm) {
    context.save();
    context.translate(280, 380);
    context.rotate(-0.85);
    context.fillRect(-22, -210, 44, 230);
    context.restore();
    context.fillRect(362, 380, 190, 44);
  } else {
    context.fillRect(78, 380, 212, 44);
    context.fillRect(350, 380, 212, 44);
  }
  return canvas;
}

function makeDifferentDocument() {
  const canvas = createCanvas(720, 960);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 720, 960);
  context.fillStyle = '#111827';
  context.fillRect(80, 90, 560, 62);
  context.fillStyle = '#64748b';
  for (let row = 0; row < 13; row += 1) {
    context.fillRect(80, 210 + row * 48, 480 - (row % 4) * 45, 14);
  }
  return canvas;
}

function png(canvas) {
  return canvas.toBuffer('image/png');
}

function jpeg(canvas, quality) {
  return canvas.toBuffer('image/jpeg', quality);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const basePng = png(makeScene());
  const baseJpeg = jpeg(makeScene(), 94);
  const recompressedJpeg = jpeg(makeScene(), 68);

  const decodedBase = await loadImage(basePng);
  const resized = createCanvas(480, 320);
  resized.getContext('2d').drawImage(decodedBase, 0, 0, 480, 320);
  const rotated = createCanvas(640, 960);
  const rotatedContext = rotated.getContext('2d');
  rotatedContext.translate(640, 0);
  rotatedContext.rotate(Math.PI / 2);
  rotatedContext.drawImage(decodedBase, 0, 0, 960, 640);
  const cropped = createCanvas(720, 480);
  cropped.getContext('2d').drawImage(decodedBase, 120, 80, 720, 480, 0, 0, 720, 480);

  const files = new Map([
    ['base-scene.png', basePng],
    ['base-scene-copy.png', basePng],
    ['renamed-copy.png', basePng],
    ['base-scene-q94.jpg', baseJpeg],
    ['base-scene-q68.jpg', recompressedJpeg],
    ['base-scene-resized.png', png(resized)],
    ['base-scene-rotated.png', png(rotated)],
    ['base-scene-cropped.png', png(cropped)],
    ['burst-a.png', png(makeBurst(-18))],
    ['burst-b.png', png(makeBurst(18))],
    ['screenshot-text-a.png', png(makeScreenshot(false))],
    ['screenshot-text-b.png', png(makeScreenshot(true))],
    ['person-pose-a.png', png(makePose(false))],
    ['person-pose-b.png', png(makePose(true))],
    ['different-document.png', png(makeDifferentDocument())],
  ]);

  for (const [filename, buffer] of files) {
    fs.writeFileSync(path.join(outputDir, filename), buffer);
  }

  const manifest = {
    version: 1,
    generatedBy: 'packages/shared/tests/generateDedupeGoldenFixtures.cjs',
    policy: 'Only byte-identical files may be selected automatically for deletion.',
    cases: [
      { id: 'base', file: 'base-scene.png', family: 'exact', timestampOffsetMs: 0 },
      { id: 'exact-copy', file: 'base-scene-copy.png', family: 'exact', timestampOffsetMs: 1000 },
      { id: 'renamed-copy', file: 'renamed-copy.png', family: 'exact', timestampOffsetMs: 2000 },
      { id: 'jpeg-q94', file: 'base-scene-q94.jpg', family: 'recompressed', timestampOffsetMs: 3000 },
      { id: 'jpeg-q68', file: 'base-scene-q68.jpg', family: 'recompressed', timestampOffsetMs: 4000 },
      { id: 'resized', file: 'base-scene-resized.png', family: 'resized', timestampOffsetMs: 5000 },
      { id: 'rotated', file: 'base-scene-rotated.png', family: 'rotated', timestampOffsetMs: 6000 },
      { id: 'cropped', file: 'base-scene-cropped.png', family: 'cropped', timestampOffsetMs: 7000 },
      { id: 'burst-a', file: 'burst-a.png', family: 'burst', timestampOffsetMs: 8000 },
      { id: 'burst-b', file: 'burst-b.png', family: 'burst', timestampOffsetMs: 9000 },
      { id: 'screenshot-a', file: 'screenshot-text-a.png', family: 'screenshot-different-text', timestampOffsetMs: 10000 },
      { id: 'screenshot-b', file: 'screenshot-text-b.png', family: 'screenshot-different-text', timestampOffsetMs: 11000 },
      { id: 'pose-a', file: 'person-pose-a.png', family: 'pose', timestampOffsetMs: 12000 },
      { id: 'pose-b', file: 'person-pose-b.png', family: 'pose', timestampOffsetMs: 13000 },
      { id: 'different', file: 'different-document.png', family: 'different', timestampOffsetMs: 14000 },
    ],
    exactContentGroups: [['base', 'exact-copy', 'renamed-copy']],
    neverAutoDeleteFamilies: ['recompressed', 'resized', 'rotated', 'cropped', 'burst', 'screenshot-different-text', 'pose', 'different'],
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
