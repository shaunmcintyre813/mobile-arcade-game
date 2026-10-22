param(
    [string] $SdkRoot = "$env:USERPROFILE\AppData\Local\Android\Sdk",
    [string] $JavaRoot = 'C:\Program Files\Android\Android Studio\jbr',
    [string] $Version = '1.1.0',
    [int] $VersionCode = 2
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$build = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build'))
$expected = [System.IO.Path]::GetFullPath((Join-Path $repo 'android\build'))
if ($build -ne $expected -or !$build.StartsWith("$repo\android\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Build output is outside this checkout.'
}

$tools = Join-Path $SdkRoot 'build-tools\36.0.0'
$platform = Join-Path $SdkRoot 'platforms\android-37.0\android.jar'
$java = Join-Path $JavaRoot 'bin'
foreach ($required in @($platform, (Join-Path $tools 'aapt.exe'), (Join-Path $java 'javac.exe'))) {
    if (!(Test-Path -LiteralPath $required)) { throw "Missing Android build dependency: $required" }
}
$env:JAVA_HOME = $JavaRoot
$env:PATH = "$java;$env:PATH"

function Check-Exit([string] $step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

if (Test-Path -LiteralPath $build) {
    Remove-Item -LiteralPath $build -Recurse -Force
}
$assets = Join-Path $build 'assets\www'
$sourceAssets = Join-Path $assets 'src'
$iconAssets = Join-Path $assets 'icons'
$res = Join-Path $build 'res\drawable-nodpi'
$classes = Join-Path $build 'classes'
$dex = Join-Path $build 'dex'
$unsigned = Join-Path $build 'unsigned.apk'
$aligned = Join-Path $build 'aligned.apk'
$keystore = Join-Path $repo 'release\antigravity-neon-pulse.jks'
$passwordFile = Join-Path $repo 'release\keystore-pass.txt'
$output = Join-Path $repo "downloads\AntiGravity-Neon-Pulse-v$Version.apk"
foreach ($path in @($assets, $sourceAssets, $iconAssets, $res, $classes, $dex, (Split-Path $keystore), (Split-Path $output))) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

foreach ($name in @('index.html', 'style.css', 'manifest.webmanifest')) {
    Copy-Item -LiteralPath (Join-Path $repo $name) -Destination $assets -Force
}
Get-ChildItem -LiteralPath (Join-Path $repo 'src') -File -Filter '*.js' | Copy-Item -Destination $sourceAssets -Force
Get-ChildItem -LiteralPath (Join-Path $repo 'icons') -File | Copy-Item -Destination $iconAssets -Force
Copy-Item -LiteralPath (Join-Path $repo 'icons\icon-192.png') -Destination (Join-Path $res 'icon.png') -Force

& (Join-Path $java 'javac.exe') -source 8 -target 8 -classpath $platform -d $classes `
    (Join-Path $PSScriptRoot 'src\com\shaunmcintyre\antigravity\neonpulse\MainActivity.java')
Check-Exit 'Java compilation'

& (Join-Path $tools 'aapt.exe') package -f -M (Join-Path $PSScriptRoot 'AndroidManifest.xml') `
    -S (Join-Path $build 'res') -A (Join-Path $build 'assets') -I $platform -F $unsigned
Check-Exit 'Android resource packaging'

$classFiles = @(Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' | ForEach-Object FullName)
& (Join-Path $tools 'd8.bat') --lib $platform --output $dex $classFiles
Check-Exit 'DEX compilation'

Push-Location $dex
try {
    & (Join-Path $tools 'aapt.exe') add $unsigned 'classes.dex'
    Check-Exit 'DEX packaging'
} finally { Pop-Location }

& (Join-Path $tools 'zipalign.exe') -f 4 $unsigned $aligned
Check-Exit 'APK alignment'

if (!(Test-Path -LiteralPath $keystore) -or !(Test-Path -LiteralPath $passwordFile)) {
    throw 'The signing key and password must both be present for updates to preserve the signature.'
}

$password = (Get-Content -Raw -LiteralPath $passwordFile).Trim()
& (Join-Path $tools 'apksigner.bat') sign --ks $keystore --ks-type PKCS12 `
    --ks-key-alias antigravity-neon-pulse --ks-pass "file:$passwordFile" `
    --v4-signing-enabled false --out $output $aligned
Check-Exit 'APK signing'
& (Join-Path $tools 'apksigner.bat') verify --verbose $output
Check-Exit 'APK signature verification'

$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$output.sha256" -Value "$sha256  AntiGravity-Neon-Pulse-v$Version.apk" -Encoding Ascii
& (Join-Path $tools 'aapt.exe') dump badging $output | Select-Object -First 5
Write-Output "Built $output"
