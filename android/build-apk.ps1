# Builds the ledger APK with the Android SDK command-line tools only.
# Native tools such as aapt2 cannot open absolute paths that contain
# non-ASCII characters, so every native command below runs from android/ with
# relative paths.

param(
    [string]$SdkRoot = "",
    [string]$BuildToolsVersion = "34.0.0",
    [string]$Platform = "android-34"
)

$ErrorActionPreference = "Stop"

$here = $PSScriptRoot
$projectRoot = Split-Path $here -Parent

if (-not $SdkRoot) {
    $SdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}

function Step([string]$message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

$androidJar = Join-Path $SdkRoot "platforms\$Platform\android.jar"
$buildTools = Join-Path $SdkRoot "build-tools\$BuildToolsVersion"
$requiredTools = @(
    $androidJar,
    (Join-Path $buildTools "aapt2.exe"),
    (Join-Path $buildTools "d8.bat"),
    (Join-Path $buildTools "zipalign.exe"),
    (Join-Path $buildTools "apksigner.bat")
)
foreach ($required in $requiredTools) {
    if (-not (Test-Path $required)) {
        throw "Missing SDK component: $required. Run android\setup-sdk.cmd first."
    }
}

$javaCommand = Get-Command java.exe -ErrorAction SilentlyContinue
if (-not $javaCommand) {
    throw "java.exe was not found on PATH."
}
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { Split-Path (Split-Path $javaCommand.Source) }
$env:JAVA_HOME = $javaHome
$javac = Join-Path $javaHome "bin\javac.exe"
$jar = Join-Path $javaHome "bin\jar.exe"
$keytool = Join-Path $javaHome "bin\keytool.exe"
foreach ($tool in @($javac, $jar, $keytool)) {
    if (-not (Test-Path $tool)) {
        throw "Missing JDK tool: $tool"
    }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw "node.exe was not found on PATH. It is required to bundle the web app."
}

Step "Building the web bundle (node build.mjs)"
Push-Location $projectRoot
try {
    & node build.mjs
    if ($LASTEXITCODE -ne 0) {
        throw "node build.mjs failed"
    }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path (Join-Path $here "assets") | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "index.html") -Destination (Join-Path $here "assets\index.html") -Force

$buildDir = Join-Path $here "build"
Remove-Item -LiteralPath $buildDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $buildDir, (Join-Path $buildDir "classes"), (Join-Path $buildDir "dex") | Out-Null

$now = Get-Date
$versionCode = [int]((($now - [datetime]"2026-01-01").TotalSeconds) + 1000)
$versionName = $now.ToString("yyyy.MM.dd.HHmmss")

Push-Location $here
try {
    Step "Compiling resources (aapt2)"
    & (Join-Path $buildTools "aapt2.exe") compile --dir "res" -o "build\res.zip"
    if ($LASTEXITCODE -ne 0) {
        throw "aapt2 compile failed"
    }

    Step "Linking manifest, resources and assets (aapt2)"
    & (Join-Path $buildTools "aapt2.exe") link `
        -o "build\app-unsigned.apk" `
        -I $androidJar `
        --manifest "AndroidManifest.xml" `
        -R "build\res.zip" `
        -A "assets" `
        --auto-add-overlay `
        --min-sdk-version 29 `
        --target-sdk-version 34 `
        --version-code $versionCode `
        --version-name $versionName `
        --replace-version
    if ($LASTEXITCODE -ne 0) {
        throw "aapt2 link failed"
    }

    Step "Compiling Java sources"
    $javaFiles = @(Get-ChildItem -Path "src" -Recurse -Filter "*.java" | ForEach-Object { Resolve-Path -Relative $_.FullName })
    if ($javaFiles.Count -eq 0) {
        throw "No Java sources were found under android\src"
    }
    & $javac --release 11 -encoding UTF-8 -classpath $androidJar -d "build\classes" $javaFiles
    if ($LASTEXITCODE -ne 0) {
        throw "javac failed"
    }

    Step "Dexing classes (d8)"
    $classFiles = @(Get-ChildItem -Path "build\classes" -Recurse -Filter "*.class" | ForEach-Object { Resolve-Path -Relative $_.FullName })
    & (Join-Path $buildTools "d8.bat") --release --min-api 29 --lib $androidJar --output "build\dex" $classFiles
    if ($LASTEXITCODE -ne 0) {
        throw "d8 failed"
    }

    Step "Adding classes.dex to the APK"
    & $jar uf "build\app-unsigned.apk" -C "build\dex" "classes.dex"
    if ($LASTEXITCODE -ne 0) {
        throw "jar failed to add classes.dex"
    }

    Step "Aligning the APK (zipalign)"
    & (Join-Path $buildTools "zipalign.exe") -f -p 4 "build\app-unsigned.apk" "build\app-aligned.apk"
    if ($LASTEXITCODE -ne 0) {
        throw "zipalign failed"
    }

    Step "Preparing the signing key"
    $keystoreFile = "keystore\sanyu-ledger.keystore"
    $propsFile = "keystore\keystore.properties"

    if (-not (Test-Path $keystoreFile)) {
        Write-Host "First build: creating a self-signed key. Keep the keystore folder forever." -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path "keystore" | Out-Null
        $storePass = [guid]::NewGuid().ToString("N")
        & $keytool -genkeypair `
            -keystore $keystoreFile `
            -storetype PKCS12 `
            -alias "sanyu" `
            -keyalg RSA `
            -keysize 2048 `
            -validity 10950 `
            -storepass $storePass `
            -keypass $storePass `
            -dname "CN=Sanyu Ledger,O=Personal,C=CN"
        if ($LASTEXITCODE -ne 0) {
            throw "keytool failed"
        }
        $content = @(
            "# Signing key for the personal ledger APK.",
            "# KEEP THIS FOLDER. Losing it means future builds cannot upgrade the installed app.",
            "storeFile=sanyu-ledger.keystore",
            "storePassword=$storePass",
            "keyAlias=sanyu",
            "keyPassword=$storePass"
        )
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllLines((Join-Path $here $propsFile), $content, $utf8NoBom)
    }
    if (-not (Test-Path $propsFile)) {
        throw "The keystore exists but keystore.properties is missing: $propsFile"
    }

    $props = @{}
    Get-Content -Path $propsFile | ForEach-Object {
        if ($_ -match "^\s*([^#=]+?)\s*=\s*(.*)$") {
            $props[$Matches[1]] = $Matches[2]
        }
    }
    $storePass = $props["storePassword"]
    $keyAlias = $props["keyAlias"]
    $keyPass = $props["keyPassword"]
    if (-not $storePass -or -not $keyAlias) {
        throw "keystore.properties is incomplete"
    }
    if (-not $keyPass) {
        $keyPass = $storePass
    }

    Step "Signing the APK"
    Remove-Item -LiteralPath "build\sanyu-ledger.apk" -Force -ErrorAction SilentlyContinue
    & (Join-Path $buildTools "apksigner.bat") sign `
        --ks $keystoreFile `
        --ks-key-alias $keyAlias `
        --ks-pass "pass:$storePass" `
        --key-pass "pass:$keyPass" `
        --v1-signing-enabled false `
        --v2-signing-enabled true `
        --v3-signing-enabled true `
        --out "build\sanyu-ledger.apk" `
        "build\app-aligned.apk"
    if ($LASTEXITCODE -ne 0) {
        throw "apksigner sign failed"
    }

    Step "Verifying the signature"
    & (Join-Path $buildTools "apksigner.bat") verify --verbose "build\sanyu-ledger.apk"
    if ($LASTEXITCODE -ne 0) {
        throw "apksigner verify failed"
    }
} finally {
    Pop-Location
}

$outputApk = Join-Path $projectRoot "sanyu-ledger.apk"
Copy-Item -LiteralPath (Join-Path $buildDir "sanyu-ledger.apk") -Destination $outputApk -Force

$sizeMb = [math]::Round((Get-Item -LiteralPath $outputApk).Length / 1MB, 2)
Write-Host ""
Write-Host "APK built: $outputApk ($sizeMb MB)" -ForegroundColor Green
Write-Host "versionCode=$versionCode versionName=$versionName"
