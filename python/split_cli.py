"""JS spawn 用的 PDF preflight CLI。

输入参数(命令行):
    --sources  源 PDF 路径(JSON 数组字符串,绝对路径)
    --pages    分割阈值(默认 180)
    --output-dir  临时 chunk 输出根目录(每个 source 一个子目录)

输出 JSON 到 stdout:
    {
        "<source1>": ["<source1>", ...],         # 未拆分,返回原路径作为单元素列表
        "<source2>": ["<chunk2_001>", "<chunk2_002>", ...]  # 已拆分
    }

错误: 以非零退出码退出,stderr 给原因。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pdf_splitter import split_pdf


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sources", required=True, help="JSON 数组,源 PDF 路径列表")
    p.add_argument("--pages", type=int, default=180)
    p.add_argument("--output-dir", default=None, help="临时 chunk 输出根目录(可选)")
    args = p.parse_args()

    try:
        sources: list[str] = json.loads(args.sources)
    except json.JSONDecodeError as e:
        print(f"[split_cli] sources JSON 解析失败: {e}", file=sys.stderr)
        sys.exit(2)

    result: dict[str, list[str]] = {}
    for src in sources:
        try:
            chunks = split_pdf(src, args.output_dir or ".", args.pages)
            result[src] = [str(p) for p in chunks]
        except FileNotFoundError as e:
            print(f"[split_cli] {e}", file=sys.stderr)
            sys.exit(3)
        except Exception as e:
            print(f"[split_cli] split 失败 {src}: {e}", file=sys.stderr)
            sys.exit(4)

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
