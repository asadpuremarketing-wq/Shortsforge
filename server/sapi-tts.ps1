param(
  [string]$TextFile,
  [string]$Out,
  [string]$Voice = "",
  [int]$Rate = 1,
  [switch]$List
)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($List) {
  $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }
  $s.Dispose()
  exit 0
}
if ($Voice) { $s.SelectVoice($Voice) }
$s.Rate = $Rate
$s.SetOutputToWaveFile($Out)
$s.Speak([System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8))
$s.Dispose()
