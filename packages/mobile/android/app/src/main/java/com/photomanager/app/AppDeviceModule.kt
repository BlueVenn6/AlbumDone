package com.photomanager.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Locale

class AppDeviceModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  private val hashCache by lazy {
    reactContext.getSharedPreferences("albumdone_hash_cache_v1", 0)
  }

  override fun getName(): String = "AppDevice"

  @ReactMethod
  fun getPreferredLocaleTags(promise: Promise) {
    try {
      val tags = Arguments.createArray()
      val locales = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        reactContext.resources.configuration.locales
      } else {
        null
      }

      if (locales != null) {
        for (index in 0 until locales.size()) {
          val tag = locales.get(index).toLanguageTag()
          if (tag.isNotBlank()) {
            tags.pushString(tag)
          }
        }
      } else {
        tags.pushString(Locale.getDefault().toLanguageTag())
      }

      promise.resolve(tags)
    } catch (err: Exception) {
      promise.reject("APP_DEVICE_LOCALE", err)
    }
  }

  @ReactMethod
  fun readImageAsBase64(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val bitmap = decodeSampledBitmap(uri, 1536)
      if (bitmap == null) {
        promise.reject("APP_DEVICE_IMAGE", "Could not decode image preview.")
        return
      }
      bitmap.use { source ->
        val output = ByteArrayOutputStream()
        source.compress(Bitmap.CompressFormat.JPEG, 86, output)
        val bytes = output.toByteArray()
        val result = Arguments.createMap()
        result.putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        result.putString("mimeType", "image/jpeg")
        result.putDouble("size", bytes.size.toDouble())
        result.putString("filename", getDisplayName(uri))
        promise.resolve(result)
      }
    } catch (err: Exception) {
      promise.reject("APP_DEVICE_IMAGE", err)
    }
  }

  @ReactMethod
  fun computeContentHashes(uriStrings: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    try {
      val result = Arguments.createMap()
      for (index in 0 until uriStrings.size()) {
        val uriString = uriStrings.getString(index) ?: continue
        try {
          val hash = getOrComputeCachedHash("content-v1", uriString) {
            computeContentHash(uriString)
          }
          if (hash != null) {
            result.putString(uriString, hash)
          }
        } catch (_: Exception) {
          // Unreadable assets remain review-only and are never default-selected for deletion.
        }
      }
      promise.resolve(result)
    } catch (err: Exception) {
      promise.reject("APP_DEVICE_CONTENT_HASH", err)
    }
  }

  @ReactMethod
  fun computeVisualHashes(uriStrings: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    try {
      val result = Arguments.createMap()
      for (index in 0 until uriStrings.size()) {
        val uriString = uriStrings.getString(index) ?: continue
        try {
          val hash = getOrComputeCachedHash("visual-v2", uriString) {
            computeVisualHash(uriString)
          }
          if (hash != null) {
            result.putString(uriString, hash)
          }
        } catch (_: Exception) {
          // Skip unreadable images; JS falls back to metadata-only matching.
        }
      }
      promise.resolve(result)
    } catch (err: Exception) {
      promise.reject("APP_DEVICE_VISUAL_HASH", err)
    }
  }

  private fun getDisplayName(uri: Uri): String? {
    reactContext.contentResolver.query(uri, null, null, null, null).use { cursor ->
      if (cursor != null && cursor.moveToFirst()) {
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0) {
          return cursor.getString(index)
        }
      }
    }
    return null
  }

  private fun getAssetVersion(uri: Uri): String? {
    val projection = arrayOf(
      MediaStore.MediaColumns.DATE_MODIFIED,
      MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.WIDTH,
      MediaStore.MediaColumns.HEIGHT,
    )
    return try {
      reactContext.contentResolver.query(uri, projection, null, null, null).use { cursor ->
        if (cursor == null || !cursor.moveToFirst()) {
          return null
        }
        projection.joinToString(":") { column ->
          val index = cursor.getColumnIndex(column)
          if (index >= 0 && !cursor.isNull(index)) cursor.getString(index) else ""
        }
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun cacheKey(kind: String, uriString: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(uriString.toByteArray(Charsets.UTF_8))
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    return "$kind:$digest"
  }

  private fun getOrComputeCachedHash(
    kind: String,
    uriString: String,
    compute: () -> String?,
  ): String? {
    val version = getAssetVersion(Uri.parse(uriString))
    val key = cacheKey(kind, uriString)
    if (version != null) {
      val cached = hashCache.getString(key, null)
      val prefix = "$version|"
      if (cached?.startsWith(prefix) == true) {
        return cached.removePrefix(prefix)
      }
    }

    val hash = compute() ?: return null
    if (version != null) {
      hashCache.edit().putString(key, "$version|$hash").apply()
    }
    return hash
  }

  private fun guessMimeType(uriString: String): String {
    val lower = uriString.lowercase(Locale.ROOT).substringBefore('?')
    return when {
      lower.endsWith(".png") -> "image/png"
      lower.endsWith(".webp") -> "image/webp"
      lower.endsWith(".gif") -> "image/gif"
      lower.endsWith(".heic") -> "image/heic"
      lower.endsWith(".heif") -> "image/heif"
      else -> "image/jpeg"
    }
  }

  private fun calculateInSampleSize(width: Int, height: Int, targetMax: Int): Int {
    var sampleSize = 1
    var halfWidth = width / 2
    var halfHeight = height / 2
    while (halfWidth / sampleSize >= targetMax || halfHeight / sampleSize >= targetMax) {
      sampleSize *= 2
    }
    return sampleSize.coerceAtLeast(1)
  }

  private fun decodeSampledBitmap(uri: Uri, targetMax: Int): Bitmap? {
    val resolver = reactContext.contentResolver
    val bounds = BitmapFactory.Options().apply {
      inJustDecodeBounds = true
    }
    resolver.openInputStream(uri).use { input ->
      if (input == null) {
        return null
      }
      BitmapFactory.decodeStream(input, null, bounds)
    }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      return null
    }
    val decodeOptions = BitmapFactory.Options().apply {
      inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, targetMax)
      inPreferredConfig = Bitmap.Config.RGB_565
    }
    resolver.openInputStream(uri).use { input ->
      if (input == null) {
        return null
      }
      return BitmapFactory.decodeStream(input, null, decodeOptions)
    }
  }

  private fun computeVisualHash(uriString: String): String? {
    val uri = Uri.parse(uriString)
    val bitmap = decodeSampledBitmap(uri, 256) ?: return null
    return bitmap.use { source ->
      val normalized = Bitmap.createScaledBitmap(source, 32, 32, true)
      try {
        var hash = 0L
        for (y in 0 until 8) {
          for (x in 0 until 8) {
            val sourceY = (y * 32 / 8).coerceAtMost(31)
            val leftX = (x * 32 / 9).coerceAtMost(31)
            val rightX = ((x + 1) * 32 / 9).coerceAtMost(31)
            val left = luminance(normalized.getPixel(leftX, sourceY))
            val right = luminance(normalized.getPixel(rightX, sourceY))
            hash = (hash shl 1) or if (left > right) 1L else 0L
          }
        }

        val signature = StringBuilder(24 * 24 * 6)
        for (y in 0 until 24) {
          for (x in 0 until 24) {
            val sourceX = (((x + 0.5) * 32) / 24).toInt().coerceAtMost(31)
            val sourceY = (((y + 0.5) * 32) / 24).toInt().coerceAtMost(31)
            val pixel = normalized.getPixel(sourceX, sourceY)
            signature.append("%02x".format((pixel shr 16) and 0xff))
            signature.append("%02x".format((pixel shr 8) and 0xff))
            signature.append("%02x".format(pixel and 0xff))
          }
        }
        "v2:${java.lang.Long.toUnsignedString(hash, 16).padStart(16, '0')}:$signature"
      } finally {
        normalized.recycle()
      }
    }
  }

  private fun computeContentHash(uriString: String): String? {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    reactContext.contentResolver.openInputStream(Uri.parse(uriString)).use { input ->
      if (input == null) {
        return null
      }
      while (true) {
        val read = input.read(buffer)
        if (read < 0) {
          break
        }
        if (read > 0) {
          digest.update(buffer, 0, read)
        }
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  private inline fun <T> Bitmap.use(block: (Bitmap) -> T): T {
    try {
      return block(this)
    } finally {
      recycle()
    }
  }

  private fun luminance(pixel: Int): Double {
    val red = (pixel shr 16) and 0xff
    val green = (pixel shr 8) and 0xff
    val blue = pixel and 0xff
    return 0.299 * red + 0.587 * green + 0.114 * blue
  }
}
