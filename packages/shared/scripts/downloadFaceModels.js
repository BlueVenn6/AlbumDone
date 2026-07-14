const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
const MODELS = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
];

const OUT = path.join(__dirname, '../public/models');
fs.mkdirSync(OUT, { recursive: true });

function download(fileName) {
  return new Promise((resolve, reject) => {
    const url = BASE + fileName;
    const dest = path.join(OUT, fileName);
    const file = fs.createWriteStream(dest);

    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          file.close();
          fs.unlink(dest, () => reject(new Error(`HTTP ${res.statusCode} for ${fileName}`)));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlink(dest, () => reject(err));
      });
  });
}

async function main() {
  for (const fileName of MODELS) {
    const dest = path.join(OUT, fileName);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      continue;
    }
    console.log('Downloading', fileName);
    await download(fileName);
  }
  console.log('Face models ready at:', OUT);
}

main().catch((err) => {
  console.error('Failed downloading face models:', err);
  process.exitCode = 1;
});
