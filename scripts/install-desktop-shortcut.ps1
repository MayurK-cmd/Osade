# Puts an Osade shortcut on this machine's Desktop so the window opens without `pnpm start`.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'apps\desktop'
$electron = Join-Path $appDir 'node_modules\electron\dist\electron.exe'
$png = Join-Path $root 'assets\osade.png'
$ico = Join-Path $root 'build\icon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Osade.lnk'

if (-not (Test-Path $electron)) {
  throw "Electron is not installed at $electron. Run pnpm install first."
}
if (-not (Test-Path (Join-Path $appDir 'dist\main\electron.js'))) {
  throw "The desktop app is not built. Run pnpm --filter @osade/desktop build first."
}

New-Item -ItemType Directory -Force -Path (Join-Path $root 'build') | Out-Null
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($png)
$bmp = New-Object System.Drawing.Bitmap 32, 32
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, 32, 32)
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Create($ico)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
$src.Dispose()

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = $electron
$shortcut.Arguments = '"' + $appDir + '"'
$shortcut.WorkingDirectory = $appDir
$shortcut.WindowStyle = 1
$shortcut.Description = 'Osade'
$shortcut.IconLocation = $ico
$shortcut.Save()

Write-Output $lnk
