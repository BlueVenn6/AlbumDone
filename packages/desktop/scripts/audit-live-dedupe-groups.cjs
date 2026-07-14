const assert = require('assert');
const WebSocket = require('ws');
const {
  groupSimilarPhotosAsync,
  selectDedupeSignatureCandidates,
} = require('../../shared/dist/utils/deduplication.js');

const port = Number(process.argv[2]);
const albumPath = process.argv[3];

function hammingDistance(first, second) {
  const firstHash = first.startsWith('v2:') ? first.split(':', 3)[1] : first;
  const secondHash = second.startsWith('v2:') ? second.split(':', 3)[1] : second;
  let value = BigInt(`0x${firstHash}`) ^ BigInt(`0x${secondHash}`);
  let distance = 0;
  while (value > 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

function signatureRmse(first, second) {
  if (!first?.startsWith('v2:') || !second?.startsWith('v2:')) return null;
  const a = first.split(':', 3)[2];
  const b = second.split(':', 3)[2];
  if (!a || !b || a.length !== b.length) return null;
  let squared = 0;
  let count = 0;
  for (let index = 0; index < a.length; index += 2) {
    const difference = Number.parseInt(a.slice(index, index + 2), 16)
      - Number.parseInt(b.slice(index, index + 2), 16);
    squared += difference * difference;
    count += 1;
  }
  return Math.sqrt(squared / count);
}

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page' && item.title === 'AlbumDone');
  assert(target?.webSocketDebuggerUrl, 'AlbumDone renderer was not found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let commandId = 0;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  const response = await evaluate(`window.electronAPI.getPhotos(${JSON.stringify(albumPath)}, { mode: 'fast' })`);
  if (response.exceptionDetails) throw new Error('Photo IPC evaluation failed.');
  const photos = response.result.value;
  socket.terminate();

  let comparisons = 0;
  const signatureCandidates = selectDedupeSignatureCandidates(photos);
  const startedAt = performance.now();
  const groups = await groupSimilarPhotosAsync(photos, {
    onProgress: ({ stage, total }) => {
      if (stage !== 'exact') comparisons = Math.max(comparisons, total);
    },
  });
  const lobbyPhotos = photos.filter((photo) => [
    'the great hall of a antique hotel.JPG',
    'Luxurious_Hotel_Lobby_with_Wooden_Paneling_and_Reflective_Flooring.jpg',
  ].includes(photo.filename));
  const reasonCounts = {};
  let exactContentGroups = 0;
  let visuallyCloseGroups = 0;
  let metadataOnlyGroups = 0;
  const samples = [];
  for (const group of groups) {
    reasonCounts[group.reason] = (reasonCounts[group.reason] ?? 0) + 1;
    const hashes = group.photos.map((photo) => photo.contentHash).filter(Boolean);
    const exact = hashes.some((hash, index) => hashes.indexOf(hash) !== index);
    const visualDistances = [];
    for (let index = 0; index < group.photos.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < group.photos.length; nextIndex += 1) {
        const first = group.photos[index];
        const second = group.photos[nextIndex];
        if (first.visualHash && second.visualHash) {
          visualDistances.push(hammingDistance(first.visualHash, second.visualHash));
        }
      }
    }
    if (exact) exactContentGroups += 1;
    else if (visualDistances.length > 0) visuallyCloseGroups += 1;
    else metadataOnlyGroups += 1;
    if (samples.length < 25) {
      samples.push({
        reason: group.reason,
        exact,
        rejected: group.rejectedPhotoIds?.length ?? 0,
        visualDistances,
        photos: group.photos.map((photo) => ({
          filename: photo.filename,
          timestamp: photo.timestamp,
          width: photo.width,
          height: photo.height,
          fileSize: photo.fileSize,
          contentHash: photo.contentHash ?? null,
          visualHash: photo.visualHash ?? null,
        })),
      });
    }
  }
  process.stdout.write(`${JSON.stringify({
    input: photos.length,
    cachedContentHashes: photos.filter((photo) => photo.contentHash).length,
    cachedVisualHashes: photos.filter((photo) => photo.visualHash).length,
    currentVisualHashes: photos.filter((photo) => photo.visualHash?.startsWith('v2:')).length,
    legacyVisualHashes: photos.filter((photo) => photo.visualHash && !photo.visualHash.startsWith('v2:')).length,
    contentSignatureCandidates: signatureCandidates.content.length,
    visualSignatureCandidates: signatureCandidates.visual.length,
    comparisons,
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    groups: groups.length,
    exactContentGroups,
    visuallyCloseGroups,
    metadataOnlyGroups,
    reasonCounts,
    lobbyDiagnostic: {
      photos: lobbyPhotos.map((photo) => ({
        filename: photo.filename,
        width: photo.width,
        height: photo.height,
        hashPrefix: photo.visualHash?.slice(0, 24) ?? null,
        hashLength: photo.visualHash?.length ?? 0,
      })),
      dHashDistance: lobbyPhotos.length === 2
        ? hammingDistance(lobbyPhotos[0].visualHash, lobbyPhotos[1].visualHash)
        : null,
      signatureRmse: lobbyPhotos.length === 2
        ? signatureRmse(lobbyPhotos[0].visualHash, lobbyPhotos[1].visualHash)
        : null,
    },
    samples,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
