# Downloads the Android command-line tools and installs the SDK packages
# required to build the ledger APK. Safe to re-run; existing installs are kept.
param(
    [string]$SdkRoot = (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
    [string]$CmdToolsBuild = "16111833",
    [string]$CmdToolsSha1 = "57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Step([string]$message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

$javaCommand = Get-Command java.exe -ErrorAction SilentlyContinue
if (-not $javaCommand) {
    throw "java.exe was not found on PATH. Install JDK 17 first."
}
$javaHome = Split-Path (Split-Path $javaCommand.Source)
$env:JAVA_HOME = $javaHome
Write-Host "JDK: $javaHome"

$sdkManager = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"

if (-not (Test-Path $sdkManager)) {
    Step "Downloading Android command-line tools"
    New-Item -ItemType Directory -Force -Path $SdkRoot | Out-Null
    $zip = Join-Path $env:TEMP "commandlinetools-win-$CmdToolsBuild.zip"
    if (-not (Test-Path $zip)) {
        $url = "https://dl.google.com/android/repository/commandlinetools-win-${CmdToolsBuild}_latest.zip"
        Write-Host "URL: $url"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 1800
    }

    $hash = (Get-FileHash -Path $zip -Algorithm SHA1).Hash.ToLowerInvariant()
    if ($CmdToolsSha1 -and $hash -ne $CmdToolsSha1) {
        throw "Checksum mismatch for $zip (got $hash). Delete the file and retry."
    }

    Step "Extracting command-line tools"
    $extractDir = Join-Path $env:TEMP "sanyu-cmdline-tools"
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $extractDir -Force

    $target = Join-Path $SdkRoot "cmdline-tools\latest"
    Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Move-Item -Path (Join-Path $extractDir "cmdline-tools") -Destination $target
}

$androidCli = Join-Path $SdkRoot "cmdline-tools\latest\bin\android.exe"

Step "Installing platform 34, build-tools 34.0.0 and platform-tools"
if (Test-Path $androidCli) {
    # cmdline-tools 20+ ships the new Android CLI, whose package ids use "/".
    1..40 | ForEach-Object { "y" } | & $androidCli --sdk=$SdkRoot sdk install "platforms/android-34" "build-tools/34.0.0" "platform-tools"
} else {
    # Older cmdline-tools: accept licenses, then use sdkmanager ids with ";".
    1..80 | ForEach-Object { "y" } | & $sdkManager --sdk_root=$SdkRoot --licenses
    if ($LASTEXITCODE -ne 0) {
        throw "sdkmanager --licenses failed with exit code $LASTEXITCODE"
    }
    1..80 | ForEach-Object { "y" } | & $sdkManager --sdk_root=$SdkRoot "platforms;android-34" "build-tools;34.0.0" "platform-tools"
}
if ($LASTEXITCODE -ne 0) {
    throw "SDK package install failed with exit code $LASTEXITCODE"
}

$androidJar = Join-Path $SdkRoot "platforms\android-34\android.jar"
$aapt2 = Join-Path $SdkRoot "build-tools\34.0.0\aapt2.exe"
if (-not (Test-Path $androidJar)) {
    throw "android.jar is missing: $androidJar"
}
if (-not (Test-Path $aapt2)) {
    throw "aapt2 is missing: $aapt2"
}

Write-Host ""
Write-Host "SDK ready: $SdkRoot" -ForegroundColor Green
Write-Host "Next: run android\build-apk.cmd"
