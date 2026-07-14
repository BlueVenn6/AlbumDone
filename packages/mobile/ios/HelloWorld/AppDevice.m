#import "AppDevice.h"

#import <CommonCrypto/CommonDigest.h>
#import <ImageIO/ImageIO.h>
#import <math.h>
#import <MobileCoreServices/MobileCoreServices.h>
#import <Photos/Photos.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@implementation AppDevice

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(getPreferredLocaleTags:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSArray<NSString *> *languages = [NSLocale preferredLanguages];
  resolve(languages ?: @[@"en"]);
}

RCT_EXPORT_METHOD(readImageAsBase64:(NSString *)uriString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (uriString.length == 0) {
    reject(@"APP_DEVICE_IMAGE", @"Image URI is empty.", nil);
    return;
  }

  NSURL *url = [NSURL URLWithString:uriString];
  NSString *scheme = url.scheme.lowercaseString;
  if ([scheme isEqualToString:@"ph"]) {
    [self readPhotoAsset:uriString resolver:resolve rejecter:reject];
    return;
  }

  if ([scheme isEqualToString:@"file"] || scheme.length == 0) {
    NSString *path = url.isFileURL ? url.path : uriString;
    UIImage *image = [self sampledImageAtPath:path maxPixelSize:1536];
    NSData *data = image ? UIImageJPEGRepresentation(image, 0.86) : nil;
    if (!data) {
      reject(@"APP_DEVICE_IMAGE", @"Could not read image file.", nil);
      return;
    }
    resolve(@{
      @"base64": [data base64EncodedStringWithOptions:0],
      @"mimeType": @"image/jpeg",
      @"size": @(data.length),
      @"filename": path.lastPathComponent ?: @""
    });
    return;
  }

  reject(@"APP_DEVICE_IMAGE", @"Unsupported image URI scheme.", nil);
}

RCT_EXPORT_METHOD(computeContentHashes:(NSArray<NSString *> *)uriStrings
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![uriStrings isKindOfClass:[NSArray class]] || uriStrings.count == 0) {
    resolve(@{});
    return;
  }

  NSMutableDictionary<NSString *, NSString *> *hashes = [NSMutableDictionary dictionary];
  [self computeContentHashes:uriStrings index:0 output:hashes completion:^{
    resolve(hashes);
  }];
}

RCT_EXPORT_METHOD(computeVisualHashes:(NSArray<NSString *> *)uriStrings
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![uriStrings isKindOfClass:[NSArray class]] || uriStrings.count == 0) {
    resolve(@{});
    return;
  }

  NSMutableDictionary<NSString *, NSString *> *hashes = [NSMutableDictionary dictionary];
  dispatch_group_t group = dispatch_group_create();

  for (NSString *uriString in uriStrings) {
    if (![uriString isKindOfClass:[NSString class]] || uriString.length == 0) {
      continue;
    }

    dispatch_group_enter(group);
    [self computeVisualHashForUri:uriString completion:^(NSString * _Nullable hash) {
      if (hash.length > 0) {
        @synchronized (hashes) {
          hashes[uriString] = hash;
        }
      }
      dispatch_group_leave(group);
    }];
  }

  dispatch_group_notify(group, dispatch_get_main_queue(), ^{
    resolve(hashes);
  });
}

- (void)readPhotoAsset:(NSString *)uriString
              resolver:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject
{
  NSString *assetId = [self assetIdentifierFromUri:uriString];
  PHFetchResult<PHAsset *> *assets = [PHAsset fetchAssetsWithLocalIdentifiers:@[assetId] options:nil];
  PHAsset *asset = assets.firstObject;
  if (!asset) {
    reject(@"APP_DEVICE_IMAGE", @"Could not find photo asset.", nil);
    return;
  }

  PHImageRequestOptions *options = [[PHImageRequestOptions alloc] init];
  options.networkAccessAllowed = YES;
  options.resizeMode = PHImageRequestOptionsResizeModeFast;
  options.deliveryMode = PHImageRequestOptionsDeliveryModeFastFormat;

  [[PHImageManager defaultManager] requestImageForAsset:asset
                                             targetSize:CGSizeMake(1536, 1536)
                                            contentMode:PHImageContentModeAspectFit
                                                options:options
                                          resultHandler:^(UIImage * _Nullable image,
                                                          NSDictionary * _Nullable info) {
    NSError *error = info[PHImageErrorKey];
    NSNumber *isCancelled = info[PHImageCancelledKey];
    if (!image || error || isCancelled.boolValue) {
      reject(@"APP_DEVICE_IMAGE", @"Could not read photo asset data.", nil);
      return;
    }
    NSData *imageData = UIImageJPEGRepresentation(image, 0.86);
    if (!imageData) {
      reject(@"APP_DEVICE_IMAGE", @"Could not encode image preview.", nil);
      return;
    }
    resolve(@{
      @"base64": [imageData base64EncodedStringWithOptions:0],
      @"mimeType": @"image/jpeg",
      @"size": @(imageData.length),
      @"filename": [asset valueForKey:@"filename"] ?: @""
    });
  }];
}

- (void)computeContentHashes:(NSArray<NSString *> *)uriStrings
                        index:(NSUInteger)index
                       output:(NSMutableDictionary<NSString *, NSString *> *)hashes
                   completion:(dispatch_block_t)completion
{
  if (index >= uriStrings.count) {
    completion();
    return;
  }

  NSString *uriString = uriStrings[index];
  if (![uriString isKindOfClass:[NSString class]] || uriString.length == 0) {
    [self computeContentHashes:uriStrings index:index + 1 output:hashes completion:completion];
    return;
  }

  NSString *cachedHash = [self cachedContentHashForUri:uriString];
  if (cachedHash.length > 0) {
    hashes[uriString] = cachedHash;
    [self computeContentHashes:uriStrings index:index + 1 output:hashes completion:completion];
    return;
  }

  [self computeContentHashForUri:uriString completion:^(NSString * _Nullable hash) {
    if (hash.length > 0) {
      hashes[uriString] = hash;
      [self cacheContentHash:hash forUri:uriString];
    }
    [self computeContentHashes:uriStrings index:index + 1 output:hashes completion:completion];
  }];
}

- (void)computeContentHashForUri:(NSString *)uriString
                      completion:(void (^)(NSString * _Nullable hash))completion
{
  NSURL *url = [NSURL URLWithString:uriString];
  NSString *scheme = url.scheme.lowercaseString;
  if ([scheme isEqualToString:@"ph"]) {
    NSString *assetId = [self assetIdentifierFromUri:uriString];
    PHAsset *asset = [PHAsset fetchAssetsWithLocalIdentifiers:@[assetId] options:nil].firstObject;
    if (!asset) {
      completion(nil);
      return;
    }

    PHAssetResource *resource = [self primaryPhotoResourceForAsset:asset];
    if (!resource) {
      completion(nil);
      return;
    }

    PHAssetResourceRequestOptions *options = [[PHAssetResourceRequestOptions alloc] init];
    options.networkAccessAllowed = YES;
    CC_SHA256_CTX *context = malloc(sizeof(CC_SHA256_CTX));
    if (!context) {
      completion(nil);
      return;
    }
    CC_SHA256_Init(context);
    [[PHAssetResourceManager defaultManager]
      requestDataForAssetResource:resource
      options:options
      dataReceivedHandler:^(NSData * _Nonnull data) {
        CC_SHA256_Update(context, data.bytes, (CC_LONG)data.length);
      }
      completionHandler:^(NSError * _Nullable error) {
        if (error) {
          free(context);
          completion(nil);
          return;
        }
        unsigned char digest[CC_SHA256_DIGEST_LENGTH];
        CC_SHA256_Final(digest, context);
        free(context);
        completion([self hexStringForDigest:digest length:CC_SHA256_DIGEST_LENGTH]);
      }];
    return;
  }

  if ([scheme isEqualToString:@"file"] || scheme.length == 0) {
    NSString *path = url.isFileURL ? url.path : uriString;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      completion([self contentHashForFileAtPath:path]);
    });
    return;
  }

  completion(nil);
}

- (NSString *)contentHashForFileAtPath:(NSString *)path
{
  NSInputStream *stream = [NSInputStream inputStreamWithFileAtPath:path];
  if (!stream) return nil;
  [stream open];

  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  uint8_t buffer[64 * 1024];
  NSInteger bytesRead = 0;
  while ((bytesRead = [stream read:buffer maxLength:sizeof(buffer)]) > 0) {
    CC_SHA256_Update(&context, buffer, (CC_LONG)bytesRead);
  }
  [stream close];
  if (bytesRead < 0) return nil;

  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  return [self hexStringForDigest:digest length:CC_SHA256_DIGEST_LENGTH];
}

- (PHAssetResource *)primaryPhotoResourceForAsset:(PHAsset *)asset
{
  NSArray<PHAssetResource *> *resources = [PHAssetResource assetResourcesForAsset:asset];
  for (PHAssetResource *resource in resources) {
    if (resource.type == PHAssetResourceTypeFullSizePhoto || resource.type == PHAssetResourceTypePhoto) {
      return resource;
    }
  }
  return resources.firstObject;
}

- (NSString *)hexStringForDigest:(const unsigned char *)digest length:(NSUInteger)length
{
  NSMutableString *result = [NSMutableString stringWithCapacity:length * 2];
  for (NSUInteger index = 0; index < length; index += 1) {
    [result appendFormat:@"%02x", digest[index]];
  }
  return result;
}

- (NSString *)cacheKeyForUri:(NSString *)uriString
{
  NSData *data = [uriString dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  return [@"albumdone.content-v1." stringByAppendingString:[self hexStringForDigest:digest length:CC_SHA256_DIGEST_LENGTH]];
}

- (NSString *)assetVersionForUri:(NSString *)uriString
{
  NSURL *url = [NSURL URLWithString:uriString];
  NSString *scheme = url.scheme.lowercaseString;
  if ([scheme isEqualToString:@"ph"]) {
    NSString *assetId = [self assetIdentifierFromUri:uriString];
    PHAsset *asset = [PHAsset fetchAssetsWithLocalIdentifiers:@[assetId] options:nil].firstObject;
    if (!asset) return nil;
    return [NSString stringWithFormat:@"%.0f:%ld:%ld",
      asset.modificationDate.timeIntervalSince1970,
      (long)asset.pixelWidth,
      (long)asset.pixelHeight];
  }

  NSString *path = url.isFileURL ? url.path : uriString;
  NSDictionary<NSFileAttributeKey, id> *attributes = [[NSFileManager defaultManager]
    attributesOfItemAtPath:path error:nil];
  if (!attributes) return nil;
  return [NSString stringWithFormat:@"%.0f:%llu",
    [attributes fileModificationDate].timeIntervalSince1970,
    [attributes fileSize]];
}

- (NSString *)cachedContentHashForUri:(NSString *)uriString
{
  NSString *version = [self assetVersionForUri:uriString];
  if (version.length == 0) return nil;
  NSString *cached = [[NSUserDefaults standardUserDefaults] stringForKey:[self cacheKeyForUri:uriString]];
  NSString *prefix = [version stringByAppendingString:@"|"];
  return [cached hasPrefix:prefix] ? [cached substringFromIndex:prefix.length] : nil;
}

- (void)cacheContentHash:(NSString *)hash forUri:(NSString *)uriString
{
  NSString *version = [self assetVersionForUri:uriString];
  if (version.length == 0 || hash.length == 0) return;
  NSString *value = [NSString stringWithFormat:@"%@|%@", version, hash];
  [[NSUserDefaults standardUserDefaults] setObject:value forKey:[self cacheKeyForUri:uriString]];
}

- (void)computeVisualHashForUri:(NSString *)uriString
                     completion:(void (^)(NSString * _Nullable hash))completion
{
  NSURL *url = [NSURL URLWithString:uriString];
  NSString *scheme = url.scheme.lowercaseString;
  if ([scheme isEqualToString:@"ph"]) {
    NSString *assetId = [self assetIdentifierFromUri:uriString];
    PHFetchResult<PHAsset *> *assets = [PHAsset fetchAssetsWithLocalIdentifiers:@[assetId] options:nil];
    PHAsset *asset = assets.firstObject;
    if (!asset) {
      completion(nil);
      return;
    }

    PHImageRequestOptions *options = [[PHImageRequestOptions alloc] init];
    options.networkAccessAllowed = YES;
    options.resizeMode = PHImageRequestOptionsResizeModeFast;
    options.deliveryMode = PHImageRequestOptionsDeliveryModeFastFormat;
    options.synchronous = NO;

    __block BOOL didComplete = NO;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (!didComplete) {
        didComplete = YES;
        completion(nil);
      }
    });
    [[PHImageManager defaultManager] requestImageForAsset:asset
                                               targetSize:CGSizeMake(9, 8)
                                              contentMode:PHImageContentModeFill
                                                  options:options
                                            resultHandler:^(UIImage * _Nullable image, NSDictionary * _Nullable info) {
      if (didComplete) {
        return;
      }
      NSError *error = info[PHImageErrorKey];
      NSNumber *isCancelled = info[PHImageCancelledKey];
      if (error || isCancelled.boolValue) {
        didComplete = YES;
        completion(nil);
        return;
      }
      NSNumber *isDegraded = info[PHImageResultIsDegradedKey];
      if (isDegraded.boolValue) {
        return;
      }
      didComplete = YES;
      completion([self visualHashForImage:image]);
    }];
    return;
  }

  if ([scheme isEqualToString:@"file"] || scheme.length == 0) {
    NSString *path = url.isFileURL ? url.path : uriString;
    UIImage *image = [self sampledImageAtPath:path maxPixelSize:256];
    completion([self visualHashForImage:image]);
    return;
  }

  completion(nil);
}

- (NSString *)visualHashForImage:(UIImage *)image
{
  if (!image) return nil;

  const size_t width = 32;
  const size_t height = 32;
  const size_t bytesPerPixel = 4;
  const size_t bytesPerRow = width * bytesPerPixel;
  unsigned char pixels[width * height * bytesPerPixel];
  memset(pixels, 0, sizeof(pixels));

  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
    pixels,
    width,
    height,
    8,
    bytesPerRow,
    colorSpace,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
  );
  CGColorSpaceRelease(colorSpace);

  if (!context) return nil;

  CGContextDrawImage(context, CGRectMake(0, 0, width, height), image.CGImage);
  CGContextRelease(context);

  uint64_t hash = 0;
  for (size_t y = 0; y < 8; y++) {
    for (size_t x = 0; x < 8; x++) {
      size_t sourceY = MIN(31, (y * width) / 8);
      size_t leftX = MIN(31, (x * width) / 9);
      size_t rightX = MIN(31, ((x + 1) * width) / 9);
      size_t leftIndex = (sourceY * width + leftX) * bytesPerPixel;
      size_t rightIndex = (sourceY * width + rightX) * bytesPerPixel;
      double left = 0.299 * pixels[leftIndex] + 0.587 * pixels[leftIndex + 1] + 0.114 * pixels[leftIndex + 2];
      double right = 0.299 * pixels[rightIndex] + 0.587 * pixels[rightIndex + 1] + 0.114 * pixels[rightIndex + 2];
      hash = (hash << 1) | (left > right ? 1 : 0);
    }
  }

  NSMutableString *signature = [NSMutableString stringWithCapacity:24 * 24 * 6];
  for (size_t y = 0; y < 24; y++) {
    for (size_t x = 0; x < 24; x++) {
      size_t sourceX = MIN(31, (size_t)floor(((x + 0.5) * width) / 24.0));
      size_t sourceY = MIN(31, (size_t)floor(((y + 0.5) * height) / 24.0));
      size_t index = (sourceY * width + sourceX) * bytesPerPixel;
      [signature appendFormat:@"%02x%02x%02x", pixels[index], pixels[index + 1], pixels[index + 2]];
    }
  }

  return [NSString stringWithFormat:@"v2:%016llx:%@", (unsigned long long)hash, signature];
}

- (UIImage *)sampledImageAtPath:(NSString *)path maxPixelSize:(CGFloat)maxPixelSize
{
  if (path.length == 0) return nil;
  NSURL *url = [NSURL fileURLWithPath:path];
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
  if (!source) return nil;

  NSDictionary *options = @{
    (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
    (__bridge NSString *)kCGImageSourceShouldCacheImmediately: @NO,
    (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
    (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @(maxPixelSize)
  };
  CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  CFRelease(source);
  if (!thumbnail) return nil;

  UIImage *image = [UIImage imageWithCGImage:thumbnail];
  CGImageRelease(thumbnail);
  return image;
}

- (NSString *)assetIdentifierFromUri:(NSString *)uriString
{
  NSString *prefix = @"ph://";
  if ([uriString hasPrefix:prefix]) {
    return [uriString substringFromIndex:prefix.length];
  }
  return uriString;
}

- (NSString *)mimeTypeForPath:(NSString *)path
{
  NSString *extension = path.pathExtension.lowercaseString;
  if ([extension isEqualToString:@"png"]) return @"image/png";
  if ([extension isEqualToString:@"webp"]) return @"image/webp";
  if ([extension isEqualToString:@"gif"]) return @"image/gif";
  if ([extension isEqualToString:@"heic"]) return @"image/heic";
  if ([extension isEqualToString:@"heif"]) return @"image/heif";
  return @"image/jpeg";
}

- (NSString *)mimeTypeForUTI:(NSString *)uti
{
  if (uti.length == 0) return @"image/jpeg";
  if (@available(iOS 14.0, *)) {
    UTType *type = [UTType typeWithIdentifier:uti];
    if (type.preferredMIMEType.length > 0) {
      return type.preferredMIMEType;
    }
  }
  NSString *mimeType = (__bridge_transfer NSString *)UTTypeCopyPreferredTagWithClass(
    (__bridge CFStringRef)uti,
    kUTTagClassMIMEType
  );
  return mimeType ?: @"image/jpeg";
}

@end
