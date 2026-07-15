const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

function color(seed, offset) {
  return `hsl(${(seed * 47 + offset) % 360}, 58%, ${38 + (seed % 20)}%)`;
}

function renderPhoto(seed, options = {}) {
  const width = options.width ?? 640;
  const height = options.height ?? 480;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = color(seed, options.variant ?? 0);
  context.fillRect(0, 0, width, height);
  context.fillStyle = color(seed, 140);
  context.fillRect(width * 0.08, height * 0.12, width * 0.42, height * 0.64);
  context.fillStyle = 'rgba(255,255,255,0.86)';
  context.beginPath();
  context.arc(width * 0.7, height * 0.45, Math.min(width, height) * 0.18, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#071b39';
  context.font = `${Math.max(18, Math.round(width / 22))}px sans-serif`;
  context.fillText(`AlbumDone ${seed}-${options.variant ?? 0}`, width * 0.1, height * 0.88);
  return canvas.toBuffer('image/jpeg', 82);
}

function renderScreenshot(seed) {
  const canvas = createCanvas(720, 1280);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7f9fc';
  context.fillRect(0, 0, 720, 1280);
  context.fillStyle = '#071b39';
  context.fillRect(0, 0, 720, 96);
  context.fillStyle = '#10b8a7';
  context.fillRect(42, 148, 636, 72);
  context.fillStyle = '#132b4c';
  context.font = '32px sans-serif';
  for (let line = 0; line < 12; line += 1) {
    context.fillText(`Screenshot row ${seed}-${line}`, 48, 290 + line * 70);
  }
  return canvas.toBuffer('image/png');
}

function createPerformanceGallery(outputDirectory, requestedCount) {
  const count = Number.parseInt(String(requestedCount), 10);
  if (![100, 1000, 3000, 5000].includes(count)) {
    throw new Error('Performance gallery size must be 100, 1000, 3000, or 5000.');
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  let previousBuffer = null;
  const manifest = {
    count,
    exactDuplicates: 0,
    nearDuplicates: 0,
    screenshots: 0,
    corrupt: 0,
    large: 0,
    noExif: count,
  };

  for (let index = 0; index < count; index += 1) {
    const serial = String(index).padStart(5, '0');
    let filename = `photo-${serial}.jpg`;
    let buffer;
    if (index > 0 && index % 40 === 0 && previousBuffer) {
      buffer = previousBuffer;
      manifest.exactDuplicates += 1;
    } else if (index % 50 === 7) {
      filename = `Screenshot_${serial}.png`;
      buffer = renderScreenshot(index);
      manifest.screenshots += 1;
    } else if (index % 125 === 13) {
      buffer = Buffer.from('corrupt image fixture');
      manifest.corrupt += 1;
    } else if (index % 1000 === 23) {
      buffer = renderPhoto(index, { width: 6000, height: 4000 });
      manifest.large += 1;
    } else if (index > 0 && index % 40 === 1) {
      buffer = renderPhoto(index - 1, { variant: 1 });
      manifest.nearDuplicates += 1;
    } else {
      buffer = renderPhoto(index);
    }
    fs.writeFileSync(path.join(outputDirectory, filename), buffer);
    previousBuffer = buffer;
    const timestamp = new Date(2025 + Math.floor((index % 18) / 12), index % 12, (index % 24) + 1, 12);
    fs.utimesSync(path.join(outputDirectory, filename), timestamp, timestamp);
  }

  fs.writeFileSync(
    path.join(outputDirectory, 'fixture-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (require.main === module) {
  const outputDirectory = process.argv[2];
  const count = process.argv[3];
  if (!outputDirectory || !count) {
    throw new Error('Usage: node generate-performance-gallery.cjs <output-directory> <count>');
  }
  const manifest = createPerformanceGallery(path.resolve(outputDirectory), count);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

module.exports = { createPerformanceGallery };
