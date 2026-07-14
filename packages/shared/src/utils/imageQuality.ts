import type { PhotoQuality } from '../types';

/**
 * Calculate image sharpness using Laplacian variance.
 * Higher values indicate sharper images.
 * - < 100: Very blurry
 * - 100-500: Slightly blurry
 * - > 500: Sharp
 */
export function calculateSharpness(
  imageData: Uint8Array,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;

  // Convert to grayscale if needed (assume RGBA input)
  const gray = new Float32Array(width * height);
  const stride = imageData.length / (width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * stride;
    if (stride >= 3) {
      // Luminance formula: 0.299R + 0.587G + 0.114B
      gray[i] =
        0.299 * (imageData[idx] ?? 0) +
        0.587 * (imageData[idx + 1] ?? 0) +
        0.114 * (imageData[idx + 2] ?? 0);
    } else {
      gray[i] = imageData[idx] ?? 0;
    }
  }

  // Apply Laplacian kernel: [0,1,0; 1,-4,1; 0,1,0]
  let variance = 0;
  let count = 0;
  const laplacianValues: number[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian =
        (gray[idx - width] ?? 0) +
        (gray[idx + width] ?? 0) +
        (gray[idx - 1] ?? 0) +
        (gray[idx + 1] ?? 0) -
        4 * (gray[idx] ?? 0);
      laplacianValues.push(laplacian);
      count++;
    }
  }

  if (count === 0) return 0;

  // Calculate variance of Laplacian values
  const mean = laplacianValues.reduce((sum, v) => sum + v, 0) / count;
  variance =
    laplacianValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;

  return variance;
}

/**
 * Analyze exposure using histogram analysis.
 * Checks the distribution of pixel brightness values.
 */
export function analyzeExposure(
  imageData: Uint8Array,
): 'normal' | 'overexposed' | 'underexposed' {
  const histogram = new Float32Array(256).fill(0);
  const stride = imageData.length > 0 ? Math.max(1, Math.floor(imageData.length / (imageData.length / 4))) : 4;
  const pixelCount = Math.floor(imageData.length / stride);

  if (pixelCount === 0) return 'normal';

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * stride;
    const r = imageData[idx] ?? 0;
    const g = imageData[idx + 1] ?? 0;
    const b = imageData[idx + 2] ?? 0;
    const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    histogram[Math.min(255, Math.max(0, luminance))]! += 1;
  }

  // Normalize histogram
  for (let i = 0; i < 256; i++) {
    histogram[i] = (histogram[i] ?? 0) / pixelCount;
  }

  // Calculate mean luminance
  let meanLuminance = 0;
  for (let i = 0; i < 256; i++) {
    meanLuminance += i * (histogram[i] ?? 0);
  }

  // Calculate percentage of very bright (>240) and very dark (<15) pixels
  const brightPixels = histogram.slice(240).reduce((sum, v) => sum + v, 0);
  const darkPixels = histogram.slice(0, 15).reduce((sum, v) => sum + v, 0);

  // Overexposed: high mean luminance and many bright pixels
  if (meanLuminance > 200 && brightPixels > 0.2) return 'overexposed';

  // Underexposed: low mean luminance and many dark pixels
  if (meanLuminance < 80 && darkPixels > 0.2) return 'underexposed';

  return 'normal';
}

/**
 * Estimate image noise using local variance analysis.
 * Returns a value between 0 (no noise) and 1 (very noisy).
 */
export function estimateNoise(
  imageData: Uint8Array,
  width: number,
  height: number,
): number {
  if (width < 4 || height < 4) return 0;

  const stride = Math.floor(imageData.length / (width * height));
  const gray = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * stride;
    if (stride >= 3) {
      gray[i] =
        0.299 * (imageData[idx] ?? 0) +
        0.587 * (imageData[idx + 1] ?? 0) +
        0.114 * (imageData[idx + 2] ?? 0);
    } else {
      gray[i] = imageData[idx] ?? 0;
    }
  }

  // Calculate local variance in 4x4 blocks
  const blockSize = 4;
  let totalNoise = 0;
  let blockCount = 0;

  for (let y = 0; y < height - blockSize; y += blockSize) {
    for (let x = 0; x < width - blockSize; x += blockSize) {
      const block: number[] = [];
      for (let by = 0; by < blockSize; by++) {
        for (let bx = 0; bx < blockSize; bx++) {
          block.push(gray[(y + by) * width + (x + bx)] ?? 0);
        }
      }

      const mean = block.reduce((s, v) => s + v, 0) / block.length;
      const variance =
        block.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / block.length;

      totalNoise += Math.sqrt(variance);
      blockCount++;
    }
  }

  if (blockCount === 0) return 0;

  // Normalize: raw noise values typically range 0-50 in an 8-bit image
  const rawNoise = totalNoise / blockCount;
  return Math.min(1, rawNoise / 50);
}

/**
 * Calculate overall quality score from PhotoQuality metrics.
 * Returns a value from 0 to 100.
 */
export function scorePhoto(quality: PhotoQuality): number {
  let score = 0;

  // Sharpness: 0-40 points (Laplacian variance, target > 500 for full score)
  const sharpnessScore = Math.min(40, (quality.sharpness / 500) * 40);
  score += sharpnessScore;

  // Exposure: 0-20 points
  if (quality.exposure === 'normal') {
    score += 20;
  } else {
    score += 5; // partial score for any exposed photo
  }

  // Noise: 0-15 points (lower noise = higher score)
  const noiseScore = (1 - quality.noise) * 15;
  score += noiseScore;

  // Face quality: 0-15 points
  if (quality.hasFace) {
    score += quality.faceScore * 15;
  } else {
    score += 10; // non-face photos are neutral
  }

  // Composition: 0-10 points
  score += quality.compositionScore * 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Compute a simple perceptual hash (dHash) from grayscale pixel data.
 * Returns a 64-bit hash as a BigInt.
 */
export function computeDHash(
  imageData: Uint8Array,
  width: number,
  height: number,
): bigint {
  // We need a 9x8 grid (64 comparisons for 64-bit hash)
  const targetW = 9;
  const targetH = 8;
  const stride = Math.floor(imageData.length / (width * height));

  // Simple box-filter resize to targetW x targetH
  const resized = new Float32Array(targetW * targetH);
  const scaleX = width / targetW;
  const scaleY = height / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    for (let tx = 0; tx < targetW; tx++) {
      const sx = Math.floor(tx * scaleX);
      const sy = Math.floor(ty * scaleY);
      const idx = (sy * width + sx) * stride;
      if (stride >= 3) {
        resized[ty * targetW + tx] =
          0.299 * (imageData[idx] ?? 0) +
          0.587 * (imageData[idx + 1] ?? 0) +
          0.114 * (imageData[idx + 2] ?? 0);
      } else {
        resized[ty * targetW + tx] = imageData[idx] ?? 0;
      }
    }
  }

  // Build hash: compare adjacent pixels horizontally
  let hash = 0n;
  for (let ty = 0; ty < targetH; ty++) {
    for (let tx = 0; tx < targetW - 1; tx++) {
      const left = resized[ty * targetW + tx] ?? 0;
      const right = resized[ty * targetW + tx + 1] ?? 0;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }

  return hash;
}

const VISUAL_SIGNATURE_SIZE = 24;

export function computeVisualHashSignature(
  imageData: Uint8Array,
  width: number,
  height: number,
): string {
  const stride = Math.floor(imageData.length / Math.max(1, width * height));
  const bytes = new Uint8Array(VISUAL_SIGNATURE_SIZE * VISUAL_SIGNATURE_SIZE * 3);
  let outputIndex = 0;
  for (let y = 0; y < VISUAL_SIGNATURE_SIZE; y += 1) {
    for (let x = 0; x < VISUAL_SIGNATURE_SIZE; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / VISUAL_SIGNATURE_SIZE));
      const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / VISUAL_SIGNATURE_SIZE));
      const sourceIndex = (sourceY * width + sourceX) * stride;
      bytes[outputIndex++] = imageData[sourceIndex] ?? 0;
      bytes[outputIndex++] = imageData[sourceIndex + 1] ?? imageData[sourceIndex] ?? 0;
      bytes[outputIndex++] = imageData[sourceIndex + 2] ?? imageData[sourceIndex] ?? 0;
    }
  }
  let encoded = '';
  for (const byte of bytes) {
    encoded += byte.toString(16).padStart(2, '0');
  }
  const dHash = computeDHash(imageData, width, height).toString(16).padStart(16, '0');
  return `v2:${dHash}:${encoded}`;
}

/**
 * Calculate Hamming distance between two perceptual hashes.
 * Lower = more similar. Threshold of ~10 is considered duplicate.
 */
export function hammingDistance(hash1: bigint, hash2: bigint): number {
  let diff = hash1 ^ hash2;
  let distance = 0;
  while (diff > 0n) {
    let chunk = Number(diff & 0xffffffffn) >>> 0;
    chunk -= (chunk >>> 1) & 0x55555555;
    chunk = (chunk & 0x33333333) + ((chunk >>> 2) & 0x33333333);
    distance += ((((chunk + (chunk >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24);
    diff >>= 32n;
  }
  return distance;
}
