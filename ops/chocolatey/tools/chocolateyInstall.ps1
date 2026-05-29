$ErrorActionPreference = 'Stop'

$packageName = 'netdesign-ai'
$version     = '2.4.0'
$url64       = "https://github.com/Amit33-design/Network-Automation/releases/download/v$version/NetDesign-AI-Setup-$version.exe"
$checksum64  = ''   # updated by CI after each release

$packageArgs = @{
  packageName   = $packageName
  fileType      = 'EXE'
  url64bit      = $url64
  checksum64    = $checksum64
  checksumType64= 'sha256'
  silentArgs    = '/S'
  validExitCodes= @(0)
}

Install-ChocolateyPackage @packageArgs
