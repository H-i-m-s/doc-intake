#requires -Version 5.1
<#
Doc Intake 出包与发版脚本（结构对齐 git-save-load/scripts/release.ps1）

用法:
  .\scripts\release.ps1                                          # 只出包（默认）：跑完就有 dist 三件，不联网
  .\scripts\release.ps1 -Publish                                 # 出包并发布到 GitHub Release
  .\scripts\release.ps1 -Publish -Notes "- 修复xxx`n- 新增yyy"   # 发布并附带说明（支持多行）

默认（不带 -Publish）是纯本地操作：不查工作区、不联网、不碰 gh，出包必定完成。
-Publish 在出包之后才走发布门禁，任一条没过就停在发布之前（包已出好，不受影响）:
  - 工作区干净（-SkipCleanCheck 可跳）
  - 本地提交已推送到 origin/master
  - gh 已登录（gh auth login）
  - 该 tag 的 Release 不存在（重名会拦下，避免同版本发两次不同内容）
  - manifest.json 的 version 就是本次要发的版本号（tag 与它强绑定）

出包统一交给 scripts/pack.mjs，产物落 <repo>\dist：
  <id>-v<version>.zip / .zip.sha256 / .entry.json
-PackageOnly 是 -Publish 的补集写法，等同于默认的「只出包」。

自检：pack.mjs 里留了挂载点——scripts/selfcheck.mjs 存在就先跑它，不存在则跳过。
当前未提供 selfcheck.mjs，所以出包不会跑自检；以后补上即自动生效。
#>
param(
  [string]$Notes = "",
  [switch]$Publish,
  [switch]$PackageOnly,
  [switch]$SkipCleanCheck
)

$ErrorActionPreference = "Stop"
$RepoSlug = "H-i-m-s/doc-intake"
$repoRoot = Split-Path -Parent $PSScriptRoot

# PS 5.1 默认未加载 System.IO.Compression.FileSystem，[System.IO.Compression.ZipFile] 会 TypeNotFound；
# pwsh 7 已内建该类型，此处是一次幂等的保险。
if (-not ("System.IO.Compression.ZipFile" -as [type])) { Add-Type -AssemblyName System.IO.Compression.FileSystem }

# ---------- 1. 版本号以 manifest.json 为唯一事实源 ----------
$manifestPath = Join-Path $repoRoot "manifest.json"
# PS5.1 的 Get-Content 默认按 ANSI 读无 BOM 的 UTF-8 文件会乱码，必须显式指定 UTF-8
$manifest = [System.IO.File]::ReadAllText($manifestPath, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json
$version = $manifest.version
$tag = "v$version"
Write-Host "==> 发布版本: $tag"

# ---------- 出包：统一交给 scripts/pack.mjs ----------
# 与手动出包（node scripts/pack.mjs）走同一条路，产物落 <repo>\dist。
function Invoke-Pack {
  $packScript = Join-Path $PSScriptRoot "pack.mjs"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "未找到 node，无法出包（scripts/pack.mjs 需要 Node）" }
  if (-not (Test-Path $packScript)) { throw "未找到 scripts/pack.mjs，无法出包" }
  # node 的输出去 host 通道（Write-Host），避免被当成函数返回值的一部分：
  # 若直接写 & node $packScript，它的 stdout 会混进 return 的结果里。
  & node $packScript 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0) { throw "scripts/pack.mjs 出包失败（exit $LASTEXITCODE）" }
  $zipPath = Join-Path $repoRoot ("dist\{0}-{1}.zip" -f $manifest.id, $tag)
  if (-not (Test-Path $zipPath)) { throw "pack.mjs 未产出预期文件：$zipPath" }
  return $zipPath
}

# ---------- 2. 出包：调 scripts/pack.mjs，产物落 dist（包根平铺，正斜杠条目） ----------
# 出包排在发布门禁之前：不管后面发布成不成，包都先出好，不会白跑一趟。
$asset = Invoke-Pack

# ---------- 3. 校验 zip：条目必须是正斜杠（yauzl 拒绝反斜杠条目），manifest 版本一致 ----------
$zip = [System.IO.Compression.ZipFile]::OpenRead($asset)
try {
  $bad = @($zip.Entries | Where-Object { $_.FullName.Contains("\") })
  if ($bad.Count -gt 0) { throw "zip 条目含反斜杠（yauzl 会拒绝）: $($bad[0].FullName)" }
  $mf = $zip.Entries | Where-Object { $_.FullName -eq "manifest.json" }
  if (-not $mf) { throw "zip 中缺少 manifest.json" }
  $sr = New-Object System.IO.StreamReader($mf.Open())
  $zipVersion = ($sr.ReadToEnd() | ConvertFrom-Json).version
  $sr.Close()
  if ($zipVersion -ne $version) { throw "zip 内 manifest version ($zipVersion) 与发布版本 ($version) 不一致" }
  $sizeKB = [math]::Round((Get-Item $asset).Length / 1KB)
  Write-Host "==> 打包完成: $asset ($sizeKB KB, $($zip.Entries.Count) 个条目)"
} finally { $zip.Dispose() }

$sha256 = (Get-FileHash $asset -Algorithm SHA256).Hash.ToLower()
Write-Host "==> sha256: $sha256"

# ---------- 4. 不带 -Publish 就到此为止（默认行为，纯本地） ----------
if ($PackageOnly -or -not $Publish) {
  Write-Host ""
  Write-Host "==> 只出包，未发布。要发布到 GitHub Release 加 -Publish。"
  Write-Host "    zip:    $asset"
  Write-Host "    sha256: $asset.sha256  （校验值侧车文件）"
  Write-Host "    entry:  $(Join-Path $repoRoot ('dist\{0}-{1}.entry.json' -f $manifest.id, $tag))  （市场条目）"
  return
}

# ---------- 5. 发布门禁（只有 -Publish 才校验） ----------
if (-not $SkipCleanCheck) {
  $dirty = & git -C $repoRoot status --porcelain
  if ($dirty) { throw "工作区有未提交变更，先 commit + push 再发版（或加 -SkipCleanCheck）" }
}
cmd /c "git -C ""$repoRoot"" fetch origin --quiet >nul 2>&1"
$ahead = & git -C $repoRoot rev-list --count "origin/master..master"
if ("$ahead" -ne "0") { throw "本地有 $ahead 个提交未推送到 origin/master，先 git push" }
cmd /c "gh auth status >nul 2>&1"
if ($LASTEXITCODE -ne 0) { throw "gh CLI 未登录，先运行 gh auth login" }
cmd /c "gh release view $tag --repo $RepoSlug >nul 2>&1"
if ($LASTEXITCODE -eq 0) { throw "Release $tag 已存在，换版本号或先删除旧 Release" }

# ---------- 6. 创建 GitHub Release 并上传 ----------
$notesFile = Join-Path $env:TEMP "doc-intake-notes-$tag.md"
$notesText = "## Doc Intake $tag`n`n$Notes`n`n---`n`n安装：下载附件 zip 拖入 HanaAgent 设置 → 插件；提交到官方插件目录后可直接在市场更新。`n"
[System.IO.File]::WriteAllText($notesFile, $notesText, (New-Object System.Text.UTF8Encoding($false)))
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& gh release create $tag $asset --repo $RepoSlug --title "Doc Intake $tag" --notes-file $notesFile
$ErrorActionPreference = $prevEap
Remove-Item $notesFile -Force
if ($LASTEXITCODE -ne 0) { throw "gh release create 失败（zip 仍在 $asset，可到网页端手动上传）" }

Write-Host ""
Write-Host "==> 发布完成。市场条目需要的两个字段："
Write-Host "    packageUrl: https://github.com/$RepoSlug/releases/download/$tag/doc-intake-$tag.zip"
Write-Host "    sha256:     $sha256"
