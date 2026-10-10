# Opens a workbook in Microsoft Excel (hidden, read-only), recalculates every formula, and reports:
#   - formula cells that evaluate to an error (#REF!, #NAME?, #VALUE!, #DIV/0!, #N/A ...)
#   - formula cells whose Excel result differs from the value Food Hub computed (expected-values JSON)
# Usage: powershell -NoProfile -File scripts/finance/verify-xlsx.ps1 -Path <workbook.xlsx> [-Expected <expected.json>]
param([Parameter(Mandatory = $true)][string]$Path, [string]$Expected = '')

$ErrorActionPreference = 'Stop'
$codes = @{ -2146826281 = '#DIV/0!'; -2146826246 = '#N/A'; -2146826259 = '#NAME?'; -2146826288 = '#NULL!'; -2146826252 = '#NUM!'; -2146826265 = '#REF!'; -2146826273 = '#VALUE!' }
$exp = @{}
if ($Expected -and (Test-Path $Expected)) {
  $json = Get-Content -Raw -Encoding UTF8 $Expected | ConvertFrom-Json
  foreach ($p in $json.PSObject.Properties) { $exp[$p.Name] = $p.Value }
}
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$result = [ordered]@{ path = $Path; sheets = @(); formulas = 0; errors = @(); mismatches = @(); checked = 0 }
try {
  $wb = $xl.Workbooks.Open((Resolve-Path $Path).Path, 0, $true)
  $xl.CalculateFull()
  foreach ($ws in $wb.Worksheets) {
    $name = $ws.Name
    $ur = $ws.UsedRange
    $rows = $ur.Rows.Count; $cols = $ur.Columns.Count
    $r0 = $ur.Row; $c0 = $ur.Column
    $vals = $ur.Value2
    $hasF = $ur.HasFormula
    $result.sheets += "$name ($rows x $cols)"
    if ($hasF -eq $false) { continue }
    $forms = $ur.Formula
    for ($r = 1; $r -le $rows; $r++) {
      for ($c = 1; $c -le $cols; $c++) {
        if ($rows -eq 1 -and $cols -eq 1) { $f = $forms; $v = $vals } else { $f = $forms[$r, $c]; $v = $vals[$r, $c] }
        if (-not ($f -is [string]) -or -not $f.StartsWith('=')) { continue }
        $result.formulas++
        $addr = $ws.Cells($r0 + $r - 1, $c0 + $c - 1).Address($false, $false)
        $key = "$name!$addr"
        if ($v -is [int] -and $codes.ContainsKey($v)) { $result.errors += "$key $($codes[$v]) $f"; continue }
        if ($exp.ContainsKey($key)) {
          $result.checked++
          $e = $exp[$key]
          if ($e -is [string]) { if ([string]$v -ne $e) { $result.mismatches += "$key excel='$v' expected='$e' $f" } }
          elseif ($null -ne $e) {
            $num = 0.0
            if ($null -eq $v) { $num = 0.0 } else { $num = [double]$v }
            if ([math]::Abs($num - [double]$e) -gt 0.005) { $result.mismatches += "$key excel=$num expected=$e $f" }
          }
        }
      }
    }
  }
  $wb.Close($false)
} finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
$result.errorCount = $result.errors.Count
$result.mismatchCount = $result.mismatches.Count
$result.errors = @($result.errors | Select-Object -First 50)
$result.mismatches = @($result.mismatches | Select-Object -First 50)
$result | ConvertTo-Json -Depth 4
