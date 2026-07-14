$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mobileRoot = Resolve-Path (Join-Path $scriptDir "..")
$repoRoot = Resolve-Path (Join-Path $mobileRoot "..\..")
$androidRoot = Join-Path $mobileRoot "android"

$gradleHome = $env:GRADLE_USER_HOME
if ([string]::IsNullOrWhiteSpace($gradleHome)) {
  $gradleHome = "C:\pm-gradle"
}
New-Item -ItemType Directory -Path $gradleHome -Force | Out-Null
$env:GRADLE_USER_HOME = $gradleHome

if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) {
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
  $defaultJava = "C:\Dev\Java\jdk-17.0.19+10"
  if (Test-Path -LiteralPath $defaultJava) {
    $env:JAVA_HOME = $defaultJava
  }
}

if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
  throw "JAVA_HOME is not set and the default JDK was not found."
}

$javaPathForGradle = $env:JAVA_HOME -replace "\\", "/"
$env:CI = "true"
$env:NO_COLOR = "1"

Push-Location $androidRoot
try {
  .\gradlew.bat :app:assembleRelease `
    --no-daemon `
    --console=plain `
    --stacktrace `
    --max-workers=1 `
    "-Dorg.gradle.vfs.watch=false" `
    "-Dorg.gradle.java.installations.auto-detect=false" `
    "-Dorg.gradle.java.installations.paths=$javaPathForGradle"
} finally {
  Pop-Location
}

$apk = Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path -LiteralPath $apk)) {
  throw "Release APK was not created: $apk"
}

$downloads = Join-Path $HOME "Downloads"
if (Test-Path -LiteralPath $downloads) {
  $copy = Join-Path $downloads "photomanager-local-release.apk"
  Copy-Item -LiteralPath $apk -Destination $copy -Force
  Write-Host "Copied APK to $copy"
}

Get-Item -LiteralPath $apk | Select-Object FullName, Length, LastWriteTime
