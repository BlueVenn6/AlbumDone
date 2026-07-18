import { computeVisualHashSignature } from '@photo-manager/shared';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';

const VISUAL_HASH_SIZE = 32;
const MAX_VISUAL_HASH_INPUT_PIXELS = 512 * 1024 * 1024;

type VisualHashWorkerRequest = {
  filePaths: string[];
};

type VisualHashWorkerResponse =
  | { type: 'result'; filePath: string; hash: string }
  | { type: 'result'; filePath: string; error: string }
  | { type: 'done' };

function sendResponse(response: VisualHashWorkerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Visual hash worker IPC is unavailable.'));
      return;
    }
    process.send(response, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function computeVisualHash(filePath: string): Promise<string> {
  try {
    const data = await sharp(filePath, {
      failOn: 'none',
      limitInputPixels: MAX_VISUAL_HASH_INPUT_PIXELS,
    })
      .rotate()
      .resize(VISUAL_HASH_SIZE, VISUAL_HASH_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    return computeVisualHashSignature(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      VISUAL_HASH_SIZE,
      VISUAL_HASH_SIZE,
    );
  } catch (sharpError) {
    try {
      const image = await loadImage(filePath);
      const canvas = createCanvas(VISUAL_HASH_SIZE, VISUAL_HASH_SIZE);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, VISUAL_HASH_SIZE, VISUAL_HASH_SIZE);
      const data = context.getImageData(0, 0, VISUAL_HASH_SIZE, VISUAL_HASH_SIZE).data;
      canvas.width = 0;
      canvas.height = 0;
      return computeVisualHashSignature(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        VISUAL_HASH_SIZE,
        VISUAL_HASH_SIZE,
      );
    } catch (canvasError) {
      throw new Error(
        `Sharp failed: ${sharpError instanceof Error ? sharpError.message : String(sharpError)}; `
        + `Canvas failed: ${canvasError instanceof Error ? canvasError.message : String(canvasError)}`,
      );
    }
  }
}

process.once('message', (request: VisualHashWorkerRequest) => {
  void (async () => {
    for (const filePath of request.filePaths) {
      try {
        const hash = await computeVisualHash(filePath);
        await sendResponse({ type: 'result', filePath, hash });
      } catch (error) {
        await sendResponse({
          type: 'result',
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await sendResponse({ type: 'done' });
    process.exit(0);
  })().catch((error) => {
    void sendResponse({
      type: 'result',
      filePath: '__worker',
      error: error instanceof Error ? error.message : String(error),
    }).finally(() => process.exit(1));
  });
});
