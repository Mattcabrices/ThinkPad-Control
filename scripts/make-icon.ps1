$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$destination = Join-Path (Split-Path -Parent $PSScriptRoot) 'desktop\app.ico'
$images = @()
foreach ($size in @(16,32,48,64,128,256)) {
  $bitmap = [Drawing.Bitmap]::new($size,$size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([Drawing.Color]::Transparent)
  $background = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(39,44,39))
  $white = [Drawing.SolidBrush]::new([Drawing.Color]::White)
  $red = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(226,64,64))
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $inset = [single]($size*0.04); $corner = [single]($size*0.28); $extent = [single]($size-2*$inset)
  $path.AddArc($inset,$inset,$corner,$corner,180,90)
  $path.AddArc(($size-$inset-$corner),$inset,$corner,$corner,270,90)
  $path.AddArc(($size-$inset-$corner),($size-$inset-$corner),$corner,$corner,0,90)
  $path.AddArc($inset,($size-$inset-$corner),$corner,$corner,90,90); $path.CloseFigure()
  $graphics.FillPath($background,$path)
  $font = [Drawing.Font]::new('Segoe UI',[single]($size*0.75),[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
  $graphics.DrawString('t',$font,$white,[single]($size*0.24),[single]($size*-0.02))
  $graphics.FillEllipse($red,[single]($size*0.68),[single]($size*0.12),[single]($size*0.16),[single]($size*0.16))
  $stream = [IO.MemoryStream]::new();$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  $images += ,@{ Size=$size; Bytes=$stream.ToArray() }
  $stream.Dispose();$font.Dispose();$path.Dispose();$red.Dispose();$white.Dispose();$background.Dispose();$graphics.Dispose();$bitmap.Dispose()
}
$output = [IO.File]::Create($destination);$writer = [IO.BinaryWriter]::new($output)
try {
  $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
  $offset = 6+16*$images.Count
  foreach ($entry in $images) {
    $dimension = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
    $writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0)
    $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$entry.Bytes.Length);$writer.Write([uint32]$offset)
    $offset += $entry.Bytes.Length
  }
  foreach ($entry in $images) { $writer.Write([byte[]]$entry.Bytes) }
} finally { $writer.Dispose();$output.Dispose() }
