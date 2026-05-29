$ErrorActionPreference = 'Stop'
$packageName = 'netdesign-ai'

Uninstall-ChocolateyPackage $packageName 'EXE' '/S' `
  "${env:ProgramFiles}\NetDesign AI\Uninstall NetDesign AI.exe"
