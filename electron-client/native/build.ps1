# ============================================================
# ghostly-audio NAPI-RS Build Script (Windows)
# ============================================================
#
# Requirements:
#   1. Rust (MSVC toolchain): rustup default stable-msvc
#   2. Node.js + npm
#   3. Windows SDK (included with Visual Studio Build Tools)
#
# Usage (from PowerShell as Administrator not required):
#   cd native
#   .\build.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== ghostly-audio NAPI-RS Build ===" -ForegroundColor Cyan

# Check for Rust
try {
    $rustVer = rustc --version
    Write-Host "Rust: $rustVer" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Rust is not installed. Install from https://rustup.rs" -ForegroundColor Red
    exit 1
}

# Check for MSVC toolchain
$toolchain = rustup show active-toolchain
if ($toolchain -notmatch "msvc") {
    Write-Host "WARNING: Active toolchain is not MSVC: $toolchain" -ForegroundColor Yellow
    Write-Host "WASAPI requires MSVC. Run: rustup default stable-msvc" -ForegroundColor Yellow
}

# Check for Node.js
try {
    $nodeVer = node --version
    Write-Host "Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is not installed." -ForegroundColor Red
    exit 1
}

# Install npm deps
Write-Host "`n[1/3] Installing npm dependencies..." -ForegroundColor Cyan
npm install

# Build NAPI-RS addon
Write-Host "`n[2/3] Building native addon (release)..." -ForegroundColor Cyan
npx napi build --platform --release

# Verify output
Write-Host "`n[3/3] Verifying build output..." -ForegroundColor Cyan
$nodeFile = Get-ChildItem -Path . -Filter "ghostly-audio.*.node" | Select-Object -First 1
if ($nodeFile) {
    $sizeKB = [math]::Round($nodeFile.Length / 1024, 1)
    Write-Host "SUCCESS: $($nodeFile.Name) ($sizeKB KB)" -ForegroundColor Green
    
    # Quick smoke test: list devices
    Write-Host "`nSmoke test: listDevices()" -ForegroundColor Cyan
    node -e "const m=require('./$($nodeFile.Name)'); console.log('Version:', m.getVersion()); const d=m.listDevices(); console.log(d.length, 'devices found'); d.forEach(x=>console.log(' -', x.deviceType, ':', x.name))"
} else {
    Write-Host "ERROR: No .node file found. Build failed." -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Build Complete ===" -ForegroundColor Cyan
Write-Host "Output: $($nodeFile.FullName)" -ForegroundColor White
