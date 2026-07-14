const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const android = fs.readFileSync(path.join(
  mobileRoot,
  'android/app/src/main/java/com/photomanager/app/AppDeviceModule.kt',
), 'utf8');
const ios = fs.readFileSync(path.join(
  mobileRoot,
  'ios/HelloWorld/AppDevice.m',
), 'utf8');

for (const method of ['readImageAsBase64', 'computeContentHashes', 'computeVisualHashes']) {
  assert(android.includes(method), `Android native bridge is missing ${method}`);
  assert(ios.includes(method), `iOS native bridge is missing ${method}`);
}

assert(!android.includes('.readBytes()'), 'Android must not load complete source images with readBytes()');
assert(android.includes('decodeSampledBitmap(uri, 1536)'), 'Android preview must use sampled decoding');
assert(android.includes('ByteArray(64 * 1024)'), 'Android content hashing must stream bounded chunks');
assert(android.includes('visual-v2'), 'Android must invalidate legacy visual hash cache entries');
assert(android.includes('"v2:${'), 'Android visual hashes must use the shared v2 signature format');

assert(!ios.includes('dataWithContentsOfFile'), 'iOS must not load complete source images into NSData');
assert(ios.includes('sampledImageAtPath:path maxPixelSize:1536'), 'iOS preview must use sampled decoding');
assert(ios.includes('requestDataForAssetResource'), 'iOS PHAsset hashing must use the streaming resource API');
assert(ios.includes('uint8_t buffer[64 * 1024]'), 'iOS file hashing must stream bounded chunks');
assert(ios.includes('@"v2:%016llx:%@"'), 'iOS visual hashes must use the shared v2 signature format');

console.log('mobile native bridge parity tests passed');
