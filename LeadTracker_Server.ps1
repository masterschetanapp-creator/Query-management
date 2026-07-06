param([int]$Port = 8788)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootGuard = [IO.Path]::GetFullPath($Root)
if (-not $RootGuard.EndsWith([IO.Path]::DirectorySeparatorChar)) { $RootGuard += [IO.Path]::DirectorySeparatorChar }
$DbPath = Join-Path $Root 'leadtracker_db.json'
$BackupDir = Join-Path $Root 'db_backups'
if (-not (Test-Path -LiteralPath $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

function Get-Type($Path) {
  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.js' { 'text/javascript; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.webmanifest' { 'application/manifest+json; charset=utf-8' }
    '.svg' { 'image/svg+xml; charset=utf-8' }
    '.txt' { 'text/plain; charset=utf-8' }
    default { 'application/octet-stream' }
  }
}

function Send-Bytes($Stream, [int]$Status, [string]$StatusText, [byte[]]$Body, [string]$Type) {
  $head = "HTTP/1.1 $Status $StatusText`r`nContent-Type: $Type`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($hb, 0, $hb.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

function Send-Text($Stream, [int]$Status, [string]$StatusText, [string]$Text, [string]$Type = 'text/plain; charset=utf-8') {
  Send-Bytes $Stream $Status $StatusText ([Text.Encoding]::UTF8.GetBytes($Text)) $Type
}

function Save-Db([string]$Body) {
  $null = $Body | ConvertFrom-Json
  if (Test-Path -LiteralPath $DbPath) {
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    Copy-Item -LiteralPath $DbPath -Destination (Join-Path $BackupDir "leadtracker_db_$stamp.json") -Force
  }
  $tmp = "$DbPath.tmp"
  [IO.File]::WriteAllText($tmp, $Body, [Text.Encoding]::UTF8)
  Move-Item -LiteralPath $tmp -Destination $DbPath -Force
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), $Port)
$listener.Start()
Write-Host "Lead Tracker running at http://127.0.0.1:$Port/index.html"
Write-Host "Shared database file: $DbPath"

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $false, 8192, $true)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { continue }
      $parts = $requestLine.Split(' ')
      $method = $parts[0]
      $url = $parts[1]
      $contentLength = 0
      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') { break }
        if ($line -match '^Content-Length:\s*(\d+)') { $contentLength = [int]$matches[1] }
      }
      $body = ''
      if ($contentLength -gt 0) {
        $buf = New-Object char[] $contentLength
        $read = $reader.ReadBlock($buf, 0, $contentLength)
        $body = -join $buf[0..($read-1)]
      }

      $path = [Uri]::UnescapeDataString(($url -split '\?')[0])
      if ($path -eq '/api/db') {
        if ($method -eq 'GET') {
          if (Test-Path -LiteralPath $DbPath) {
            Send-Text $stream 200 'OK' ([IO.File]::ReadAllText($DbPath, [Text.Encoding]::UTF8)) 'application/json; charset=utf-8'
          } else {
            Send-Text $stream 200 'OK' '{"version":1,"leads":[]}' 'application/json; charset=utf-8'
          }
          continue
        }
        if ($method -eq 'POST') {
          try {
            Save-Db $body
            Send-Text $stream 200 'OK' '{"ok":true}' 'application/json; charset=utf-8'
          } catch {
            Send-Text $stream 400 'Bad Request' '{"ok":false}' 'application/json; charset=utf-8'
          }
          continue
        }
      }

      if ($path -eq '/') { $path = '/index.html' }
      $relative = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
      $file = Join-Path $Root $relative
      $full = [IO.Path]::GetFullPath($file)
      if (-not $full.StartsWith($RootGuard, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Text $stream 403 'Forbidden' 'Forbidden'
        continue
      }
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Text $stream 404 'Not Found' 'Not found'
        continue
      }
      Send-Bytes $stream 200 'OK' ([IO.File]::ReadAllBytes($full)) (Get-Type $full)
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
