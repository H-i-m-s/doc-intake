#requires -Version 5.1
<#
release/ship.ps1 — 发布窗口。标题取 manifest.json 的 name，不写死插件名。

它本身不干活，只是 release/publish.mjs 的一层壳：收三样东西（做什么、发几号、这次改了什么），
把参数交给 publish.mjs，把它的输出实时刷到窗口里。

用法：
  双击 release\发布.cmd（推荐），或者
  pwsh -NoProfile -STA -File release\ship.ps1

调优/排障时可以用 -NoUI：把窗口搭到一半就停，不显示，也不会弹任何东西。

窗口本身不做任何 git / gh / 网络操作。真正干什么、怎么干、出错了怎么办，全看 release/publish.mjs
和 release/投稿规范.md。
#>
param([switch]$NoUI)

$ErrorActionPreference = "Stop"

$releaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $releaseDir
$publishScript = Join-Path $releaseDir "publish.mjs"
$manifestPath = Join-Path $appRoot "manifest.json"

# 标题跟着插件走，不写死：整个 release/ 是要整目录复制到别的插件去的。
# 放在 trap 之前算好，这样连 trap 弹的那个框也带着正确的名字。
$appTitle = "发布"
try {
  $mName = [regex]::Match(
    [System.IO.File]::ReadAllText($manifestPath, (New-Object System.Text.UTF8Encoding($false))),
    '"name"\s*:\s*"([^"]+)"')
  if ($mName.Success) { $appTitle = $mName.Groups[1].Value + " 发布" }
} catch { }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

trap {
  [System.Windows.Forms.MessageBox]::Show(
    ($_.Exception.Message + "`n`n" + $_.InvocationInfo.PositionMessage),
    $appTitle, "OK", "Error") | Out-Null
  exit 1
}

if (-not (Test-Path $publishScript)) {
  [System.Windows.Forms.MessageBox]::Show("找不到 release/publish.mjs，release 目录可能不完整。", $appTitle, "OK", "Error") | Out-Null
  exit 1
}

$script:notesFile = $null

function Read-ManifestVersion {
  try {
    $text = [System.IO.File]::ReadAllText($manifestPath, (New-Object System.Text.UTF8Encoding($false)))
    $m = [regex]::Match($text, '"version"\s*:\s*"([^"]+)"')
    if ($m.Success) { return $m.Groups[1].Value }
  } catch { }
  return $null
}

# ── 窗口 ─────────────────────────────────────────────────────────────────────
$fontUI = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$fontMono = New-Object System.Drawing.Font("Consolas", 9)

$form = New-Object System.Windows.Forms.Form
$form.Text = $appTitle
$form.ClientSize = New-Object System.Drawing.Size(624, 596)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = $fontUI

function Add-Label([string]$text, [int]$x, [int]$y, [int]$w) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, 18)
  $form.Controls.Add($l)
  return $l
}

Add-Label "做什么" 16 14 200 | Out-Null

$rbPack = New-Object System.Windows.Forms.RadioButton
$rbPack.Text = "只打包（不出网、不碰 git）"
$rbPack.Location = New-Object System.Drawing.Point(20, 36)
$rbPack.Size = New-Object System.Drawing.Size(320, 22)
$form.Controls.Add($rbPack)

$rbRelease = New-Object System.Windows.Forms.RadioButton
$rbRelease.Text = "发布 Release（写版本号、提交打 tag、推送到 GitHub）"
$rbRelease.Location = New-Object System.Drawing.Point(20, 60)
$rbRelease.Size = New-Object System.Drawing.Size(460, 22)
$form.Controls.Add($rbRelease)

$rbPublish = New-Object System.Windows.Forms.RadioButton
$rbPublish.Text = "发布并投稿到市场（在上面基础上，向市场仓库开一个 PR）"
$rbPublish.Location = New-Object System.Drawing.Point(20, 84)
$rbPublish.Size = New-Object System.Drawing.Size(500, 22)
$rbPublish.Checked = $true
$form.Controls.Add($rbPublish)

$lblCurrent = Add-Label ("manifest 里现在是 {0}" -f (Read-ManifestVersion)) 16 118 300
$verLabel = Add-Label "要发的版本" 16 140 100

$txtVersion = New-Object System.Windows.Forms.TextBox
$txtVersion.Location = New-Object System.Drawing.Point(122, 137)
$txtVersion.Size = New-Object System.Drawing.Size(140, 24)
# 默认就用 manifest 里写的版本，不自动加一：manifest 是版本的唯一出处。
# 自动推一格会在「重跑这一版补材料」时帮倒忙（本想补 PR，却成了要发新版）。
$txtVersion.Text = [string](Read-ManifestVersion)
$form.Controls.Add($txtVersion)

# 只打包时这一栏照样会写进 manifest.json（只是不提交），所以这句话只在那种模式下露出来。
$lblVersionHint = Add-Label "会写进 manifest.json，本次不提交" 270 140 340
$lblVersionHint.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 100)
$lblVersionHint.Visible = $false

$lblNotes = Add-Label "这次改了什么（会同时写进 Release 说明和 PR 正文）" 16 170 520
$txtNotes = New-Object System.Windows.Forms.TextBox
$txtNotes.Location = New-Object System.Drawing.Point(20, 192)
$txtNotes.Size = New-Object System.Drawing.Size(584, 88)
$txtNotes.Multiline = $true
$txtNotes.ScrollBars = "Vertical"
$txtNotes.AcceptsReturn = $true
$form.Controls.Add($txtNotes)

$chkDry = New-Object System.Windows.Forms.CheckBox
$chkDry.Text = "干跑（什么都不改，只做检查）"
$chkDry.Location = New-Object System.Drawing.Point(20, 288)
$chkDry.Size = New-Object System.Drawing.Size(260, 22)
$form.Controls.Add($chkDry)

$chkVerify = New-Object System.Windows.Forms.CheckBox
$chkVerify.Text = "投稿前先复核一遍我的数据"
$chkVerify.Location = New-Object System.Drawing.Point(300, 288)
$chkVerify.Size = New-Object System.Drawing.Size(300, 22)
$form.Controls.Add($chkVerify)

$btnRun = New-Object System.Windows.Forms.Button
$btnRun.Text = "发布并投稿"
$btnRun.Location = New-Object System.Drawing.Point(20, 318)
$btnRun.Size = New-Object System.Drawing.Size(150, 34)
$form.Controls.Add($btnRun)

$lblState = New-Object System.Windows.Forms.Label
$lblState.Text = ""
$lblState.Location = New-Object System.Drawing.Point(182, 327)
$lblState.Size = New-Object System.Drawing.Size(430, 20)
$lblState.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 100)
$form.Controls.Add($lblState)

Add-Label "运行日志" 16 360 200 | Out-Null
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(20, 380)
$txtLog.Size = New-Object System.Drawing.Size(584, 168)
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.WordWrap = $false
$txtLog.Font = $fontMono
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(27, 31, 39)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(213, 219, 229)
$form.Controls.Add($txtLog)

$btnRelease = New-Object System.Windows.Forms.Button
$btnRelease.Text = "打开 Release"
$btnRelease.Location = New-Object System.Drawing.Point(20, 556)
$btnRelease.Size = New-Object System.Drawing.Size(110, 30)
$btnRelease.Enabled = $false
$form.Controls.Add($btnRelease)

$btnPr = New-Object System.Windows.Forms.Button
$btnPr.Text = "打开 PR"
$btnPr.Location = New-Object System.Drawing.Point(138, 556)
$btnPr.Size = New-Object System.Drawing.Size(110, 30)
$btnPr.Enabled = $false
$form.Controls.Add($btnPr)

$btnOpenDir = New-Object System.Windows.Forms.Button
$btnOpenDir.Text = "打开 release 目录"
$btnOpenDir.Location = New-Object System.Drawing.Point(392, 556)
$btnOpenDir.Size = New-Object System.Drawing.Size(110, 30)
$form.Controls.Add($btnOpenDir)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "关闭"
$btnClose.Location = New-Object System.Drawing.Point(510, 556)
$btnClose.Size = New-Object System.Drawing.Size(94, 30)
$form.Controls.Add($btnClose)

# ── 模式切换 ─────────────────────────────────────────────────────────────────
# 版本号在三种模式下都要能用：它决定 zip 和条目附件的文件名。
# 真正只有发布才用得到的是「这次改了什么」那段文字。
# 只打包时版本号照样会写进 manifest.json（只是不提交），所以那一栏的标签要跟着模式换。
function Sync-Mode {
  $isPack = $rbPack.Checked
  $txtNotes.Enabled = -not $isPack
  $chkDry.Enabled = -not $isPack
  $chkVerify.Enabled = $rbPublish.Checked

  if ($isPack) {
    $verLabel.Text = "打包用的版本"
  } else {
    $verLabel.Text = "要发的版本"
  }
  $lblVersionHint.Visible = $isPack

  if ($isPack) {
    $btnRun.Text = "打包"
  } elseif ($rbRelease.Checked) {
    $btnRun.Text = "发布 Release"
  } else {
    $btnRun.Text = "发布并投稿"
  }
}

$rbPack.add_CheckedChanged({ Sync-Mode })
$rbRelease.add_CheckedChanged({ Sync-Mode })
$rbPublish.add_CheckedChanged({ Sync-Mode })
Sync-Mode

# ── 运行 ─────────────────────────────────────────────────────────────────────
$script:queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$script:proc = $null
$script:outTask = $null
$script:errTask = $null
$script:releaseUrl = $null
$script:prUrl = $null

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.add_Tick({
  # 收子进程的输出。不在 .NET 的事件回调里做：add_OutputDataReceived 的脚本块跑在 .NET
  # 的线程池线程上，那里没有 PowerShell 的 Runspace，一执行就抛
  # PSInvalidOperationException（“There is no Runspace available…”），窗口会直接消失。
  # 改成主线程轮询异步读；ReadLineAsync 没数据时不阻塞 UI。
  while ($script:outTask -and $script:outTask.IsCompleted) {
    $text = $null
    try { $text = $script:outTask.Result } catch { $text = $null }
    if ($null -eq $text) { $script:outTask = $null; break }
    $script:queue.Enqueue($text)
    if ($text -match '^RELEASE_URL=(.+)$') { $script:releaseUrl = $Matches[1].Trim() }
    if ($text -match '^PR_URL=(.+)$') { $script:prUrl = $Matches[1].Trim() }
    $script:outTask = $script:proc.StandardOutput.ReadLineAsync()
  }
  while ($script:errTask -and $script:errTask.IsCompleted) {
    $text = $null
    try { $text = $script:errTask.Result } catch { $text = $null }
    if ($null -eq $text) { $script:errTask = $null; break }
    $script:queue.Enqueue($text)
    $script:errTask = $script:proc.StandardError.ReadLineAsync()
  }

  $line = $null
  while ($script:queue.TryDequeue([ref]$line)) {
    $txtLog.AppendText($line + "`r`n")
  }
  # 等输出也收干净了再定格：进程刚退出的那一瞬间，管道里可能还留着没读完的行。
  if ($script:proc -and $script:proc.HasExited -and -not $script:outTask -and -not $script:errTask) {
    $code = $script:proc.ExitCode
    $script:proc = $null
    $timer.Stop()
    $btnRun.Enabled = $true
    $chkDry.Enabled = -not $rbPack.Checked
    $chkVerify.Enabled = $rbPublish.Checked
    $rbPack.Enabled = $true
    $rbRelease.Enabled = $true
    $rbPublish.Enabled = $true
    if ($code -eq 0) {
      $lblState.Text = "完成"
      $lblState.ForeColor = [System.Drawing.Color]::FromArgb(30, 130, 60)
      if ($script:releaseUrl) { $btnRelease.Enabled = $true }
      if ($script:prUrl) { $btnPr.Enabled = $true }
    } else {
      $lblState.Text = "没有跑完（退出码 $code），看上面的日志"
      $lblState.ForeColor = [System.Drawing.Color]::FromArgb(180, 40, 40)
    }
    $txtLog.SelectionStart = $txtLog.TextLength
    $txtLog.ScrollToCaret()
  }
})

function Quote-Arg([string]$value) {
  if ([string]::IsNullOrEmpty($value)) { return '""' }
  return '"' + ($value -replace '(\\*)"', '$1$1\"') + '"'
}

$btnRun.add_Click({
  if ($script:proc) { return }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    [System.Windows.Forms.MessageBox]::Show("找不到 node，无法出包。", $appTitle, "OK", "Error") | Out-Null
    return
  }

  $mode = if ($rbPack.Checked) { "pack" } elseif ($rbRelease.Checked) { "release" } else { "publish" }
  $wantsVersion = -not $rbPack.Checked
  $cliArgs = @((Quote-Arg $publishScript), "--mode=$mode")

  if ($wantsVersion) {
    $v = $txtVersion.Text.Trim()
    if ($v -notmatch '^\d+\.\d+\.\d+') {
      [System.Windows.Forms.MessageBox]::Show("版本号要写成 3.2.1 这样。", $appTitle, "OK", "Warn") | Out-Null
      return
    }
    if ([string]::IsNullOrWhiteSpace($txtNotes.Text)) {
      $ans = [System.Windows.Forms.MessageBox]::Show(
        "还没写「这次改了什么」。Release 说明和 PR 正文都会缺这块，确定继续吗？",
        $appTitle, "YesNo", "Question")
      if ($ans -ne "Yes") { return }
    }
    $cliArgs += "--version=$v"

    if (-not [string]::IsNullOrWhiteSpace($txtNotes.Text)) {
      $script:notesFile = Join-Path ([System.IO.Path]::GetTempPath()) ("gsl-notes-{0}.md" -f ([guid]::NewGuid().ToString("N")))
      [System.IO.File]::WriteAllText($script:notesFile, $txtNotes.Text, (New-Object System.Text.UTF8Encoding($false)))
      $cliArgs += "--notes-file=" + (Quote-Arg $script:notesFile)
    }
  }

  if ($chkDry.Checked -and -not $rbPack.Checked) { $cliArgs += "--dry-run" }
  if ($chkVerify.Checked -and $rbPublish.Checked) { $cliArgs += "--verify" }

  $txtLog.Clear()
  $script:queue.Clear()
  $script:releaseUrl = $null
  $script:prUrl = $null
  $btnRelease.Enabled = $false
  $btnPr.Enabled = $false
  $lblState.Text = "正在跑，别关窗口…"
  $lblState.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 100)

  $btnRun.Enabled = $false
  $chkDry.Enabled = $false
  $chkVerify.Enabled = $false
  $rbPack.Enabled = $false
  $rbRelease.Enabled = $false
  $rbPublish.Enabled = $false

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node.Source
  $psi.Arguments = ($cliArgs -join " ")
  $psi.WorkingDirectory = $appRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi

  $proc.Start() | Out-Null
  $script:proc = $proc
  # 两路异步读，交给主线程的 Timer 去收（理由见 Timer.Tick 里的注释）。
  $script:outTask = $proc.StandardOutput.ReadLineAsync()
  $script:errTask = $proc.StandardError.ReadLineAsync()
  $timer.Start()
})

$btnRelease.add_Click({ if ($script:releaseUrl) { Start-Process $script:releaseUrl } })
$btnPr.add_Click({ if ($script:prUrl) { Start-Process $script:prUrl } })
$btnOpenDir.add_Click({ Start-Process explorer.exe $releaseDir })

$btnClose.add_Click({
  if ($script:proc) {
    $ans = [System.Windows.Forms.MessageBox]::Show("还在跑，现在关掉会中断它。确定关吗？", $appTitle, "YesNo", "Warn")
    if ($ans -ne "Yes") { return }
  }
  $form.Close()
})

$form.add_FormClosing({
  param($sender, $e)
  if ($script:proc) {
    try { $script:proc.Kill() } catch { }
    $script:proc = $null
  }
  if ($script:notesFile -and (Test-Path -LiteralPath $script:notesFile)) {
    Remove-Item -LiteralPath $script:notesFile -Force -ErrorAction SilentlyContinue
  }
})

if ($NoUI) {
  Write-Output "ship.ps1: 界面搭好了，未显示（-NoUI）。"
  exit 0
}

[void]$form.ShowDialog()
