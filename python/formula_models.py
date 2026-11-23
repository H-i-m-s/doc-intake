"""公式兜底小模型的权重下载器。

插件分发包里没有任何权重、也没有模型代码：用户显式点「安装」才跑这里。下载落在
插件数据目录（由设置页的路由传 --dir 进来），装完写一个清单，卸载就是删掉整个目录。

用法：
  python formula_models.py install texo --dir <模型根目录>
  python formula_models.py install plus-m --dir <模型根目录>
  python formula_models.py status --dir <模型根目录>

输出是一行 JSON（供 routes/settings.js 直接转发），过程日志走 stderr。

来源与许可：
  texo    alephpi/FormulaNet 的 ONNX 导出（约 76 MB：encoder 51.7 + decoder 24.7）。
          权重许可 AGPL-3.0。
  plus-m  opendatalab/MinerU-4_models_onnx 里的 PP-FormulaNet_plus-M ONNX（约 591 MB）。
          原始权重许可 Apache-2.0，但实际下载的这份 ONNX 转档出自 MinerU 的模型仓，
          那份是 AGPL-3.0。装它等于把这份转档带进来。
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# hf-mirror 优先：国内直连 huggingface.co 经常断在 TLS 上，两个都试一遍。
ENDPOINTS = ("https://hf-mirror.com", "https://huggingface.co")

# 每个后端的清单：仓库 + 目录里的相对路径。大小只用于「下完有没有缺」「装没装全」。
MODELS = {
    "texo": {
        "repo": "alephpi/FormulaNet",
        "dir": "texo",
        "license": "AGPL-3.0",
        # 第三个数字是「下完没下完」的下限，不是精确体积：实际体积随导出批次会差
        # 一点点，卡太死会让一次成功的下载被判成没下完。tokenizer.json 本来就只有
        # 十几 KB（小词表），下限只能当「不是零字节」用。
        "files": [
            ("onnx/encoder_model.onnx", 40_000_000),
            ("onnx/decoder_model.onnx", 20_000_000),
            ("onnx/tokenizer.json", 1_000),
            ("onnx/generation_config.json", 1),
            ("onnx/config.json", 1),
        ],
    },
    "plus-m": {
        "repo": "opendatalab/MinerU-4_models_onnx",
        "dir": "plus-m",
        "license": "Apache-2.0（原始权重）/ AGPL-3.0（本份 ONNX 转档）",
        "files": [
            ("MFR/pp_formulanet_plus_m/PP-FormulaNet_plus-M.onnx", 500_000_000),
            ("MFR/pp_formulanet_plus_m/PP-FormulaNet_plus-M_inference.yml", 100_000),
        ],
        # 仓库里这两个文件在子目录，落盘时摊平到模型目录（与 formula_fallback 的约定一致）
        "flatten": True,
    },
}


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def target_path(root: Path, model: dict, rel: str) -> Path:
    name = Path(rel).name if model.get("flatten") else rel
    return root / name


def _download(url: str, dest: Path, expected: int) -> bool:
    """带断点续传的下载。dest 已完整就不再下。"""
    if dest.is_file() and dest.stat().st_size >= expected:
        _log(f"  skip {dest.name}（已完整）")
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 9):
        have = dest.stat().st_size if dest.is_file() else 0
        request = urllib.request.Request(url, headers={"User-Agent": "doc-intake-formula-installer/1.0"})
        if have:
            request.add_header("Range", f"bytes={have}-")
        try:
            with urllib.request.urlopen(request, timeout=90) as response, open(dest, "ab") as handle:
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    handle.write(chunk)
            size = dest.stat().st_size
            if size >= expected:
                _log(f"  ok   {dest.name} {size / 1048576:.1f} MB")
                return True
            _log(f"  下完只有 {size} 字节（预期 ≥ {expected}），当作没下完，重试")
        except urllib.error.HTTPError as exc:
            # 416 = 服务端说「你要的区间不存在」：文件已经下完整了，别再重试。
            if exc.code == 416 and dest.is_file() and dest.stat().st_size > 0:
                _log(f"  ok   {dest.name}（已完整）")
                return True
            _log(f"  retry {attempt}/8: HTTP {exc.code}")
            time.sleep(2 + 2 * attempt)
        except Exception as exc:  # noqa: BLE001
            _log(f"  retry {attempt}/8: {type(exc).__name__}: {exc}")
            time.sleep(2 + 2 * attempt)
    return False


def install(model_id: str, root: Path) -> dict:
    model = MODELS.get(model_id)
    if not model:
        return {"ok": False, "error": f"未知模型：{model_id}"}

    model_root = root / model["dir"]
    model_root.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    for rel, expected in model["files"]:
        dest = target_path(model_root, model, rel)
        done = False
        for endpoint in ENDPOINTS:
            url = f"{endpoint}/{model['repo']}/resolve/main/{rel}"
            _log(f"get {rel} from {endpoint}")
            if _download(url, dest, expected):
                done = True
                break
        if not done:
            missing.append(rel)

    if missing:
        return {
            "ok": False,
            "error": f"有 {len(missing)} 个文件没下下来：{', '.join(missing)}",
            "dir": str(model_root),
        }

    total = sum(path.stat().st_size for path in model_root.rglob("*") if path.is_file())
    (model_root / "install.json").write_text(
        json.dumps(
            {
                "id": model_id,
                "repo": model["repo"],
                "license": model["license"],
                "files": [Path(rel).name for rel, _ in model["files"]],
                "bytes": total,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    _log(f"done {model_id} {total / 1048576:.1f} MB -> {model_root}")
    return {"ok": True, "id": model_id, "dir": str(model_root), "bytes": total}


def status(root: Path) -> dict:
    rows = []
    for model_id, model in MODELS.items():
        model_root = root / model["dir"]
        files = [
            {"name": target_path(model_root, model, rel).name, "present": target_path(model_root, model, rel).is_file()}
            for rel, _ in model["files"]
        ]
        total = sum(path.stat().st_size for path in model_root.rglob("*") if path.is_file()) if model_root.is_dir() else 0
        rows.append(
            {
                "id": model_id,
                "dir": str(model_root),
                "installed": all(item["present"] for item in files),
                "bytes": total,
                "license": model["license"],
                "files": files,
            }
        )
    return {"ok": True, "models": rows}


def main(argv: list[str]) -> int:
    args = list(argv[1:])
    if not args:
        print(json.dumps({"ok": False, "error": "用法：formula_models.py install|status <id?> --dir <目录>"}, ensure_ascii=False))
        return 2

    action = args.pop(0)
    model_id = ""
    if args and not args[0].startswith("--"):
        model_id = args.pop(0)

    directory = ""
    while args:
        item = args.pop(0)
        if item == "--dir" and args:
            directory = args.pop(0)
        elif item.startswith("--dir="):
            directory = item.split("=", 1)[1]

    if not directory:
        print(json.dumps({"ok": False, "error": "缺少 --dir（模型根目录）"}, ensure_ascii=False))
        return 2
    root = Path(directory)

    if action == "status":
        payload = status(root)
    elif action == "install":
        payload = install(model_id, root)
    else:
        payload = {"ok": False, "error": f"未知动作：{action}"}

    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
