"""Token 验证脚本
验证 MinerU 和 PaddleOCR 的凭证是否有效。
支持多个 token 逐一验证。

用法:
  python validate.py --mineru-tokens "token1;token2" --paddle-tokens "token1;token2"
  python validate.py --mineru-creds '[{"accessKey":"ak","secretKey":"sk"}]'
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print(json.dumps({
        "ok": False,
        "error": "缺少 requests 库，请执行: pip install requests"
    }))
    sys.exit(1)


MINERU_TASK_URL = "https://mineru.net/api/v4/extract/task"
PADDLE_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"


def mask_key(key: str) -> str:
    if not key or len(key) < 8:
        return "***"
    return key[:4] + "..." + key[-4:]


def validate_mineru_token(token: str) -> dict:
    """验证单个 MinerU token"""
    if not token:
        return {"ok": False, "key": mask_key(token), "message": "空的 Token"}

    try:
        resp = requests.post(
            MINERU_TASK_URL,
            json={
                "url": "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
                "model_version": "vlm",
                "is_ocr": False,
                "enable_formula": False,
                "enable_table": False,
                "language": "ch",
                "page_ranges": "1",
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )

        if resp.status_code == 200:
            return {"ok": True, "key": mask_key(token), "message": "Token 有效"}

        body = resp.json() if resp.text else {}
        code = body.get("code", "") or body.get("error", {}).get("code", "")

        if code == "A0202" or resp.status_code == 401:
            return {"ok": False, "key": mask_key(token), "message": "Token 无效"}
        if code == "A0211":
            return {"ok": False, "key": mask_key(token), "message": "Token 已过期"}

        msg = body.get("msg") or body.get("error", {}).get("message") or resp.reason
        return {"ok": False, "key": mask_key(token), "message": f"{msg} ({resp.status_code})"}

    except requests.exceptions.Timeout:
        return {"ok": False, "key": mask_key(token), "message": "连接超时"}
    except requests.exceptions.ConnectionError:
        return {"ok": False, "key": mask_key(token), "message": "网络连接失败"}
    except Exception as e:
        return {"ok": False, "key": mask_key(token), "message": "验证异常（详细错误已隐藏）"}


def validate_paddle_token(token: str) -> dict:
    """验证单个 PaddleOCR token"""
    if not token:
        return {"ok": False, "key": mask_key(token), "message": "空的 Token"}

    try:
        resp = requests.post(
            PADDLE_JOB_URL,
            json={
                "model": "PaddleOCR-VL-1.6",
                "optionalPayload": json.dumps({}),
            },
            headers={"Authorization": f"bearer {token}"},
            timeout=15,
        )

        if resp.status_code == 200:
            return {"ok": True, "key": mask_key(token), "message": "Token 有效"}

        if resp.status_code in (401, 403):
            return {"ok": False, "key": mask_key(token), "message": "Token 无效"}

        if resp.status_code == 400:
            return {"ok": True, "key": mask_key(token), "message": "Token 有效（认证通过，但请求参数不完整）"}

        return {"ok": False, "key": mask_key(token), "message": f"{resp.reason} ({resp.status_code})"}

    except requests.exceptions.Timeout:
        return {"ok": False, "key": mask_key(token), "message": "连接超时"}
    except requests.exceptions.ConnectionError:
        return {"ok": False, "key": mask_key(token), "message": "网络连接失败"}
    except Exception as e:
        return {"ok": False, "key": mask_key(token), "message": "验证异常（详细错误已隐藏）"}


def _load_validation_settings() -> dict:
    """优先从 stdin 读取验证凭证，旧命令行参数作为兼容回退。"""
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read()
            if raw and raw.strip():
                value = json.loads(raw)
                if isinstance(value, dict):
                    return value
    except (EOFError, OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    return {}


def main():
    parser = argparse.ArgumentParser(description="验证 MinerU 和 PaddleOCR 凭证")
    parser.add_argument("--mineru-tokens", help="MinerU Tokens，分号分隔")
    parser.add_argument("--mineru-creds", help="MinerU credentials JSON 数组")
    parser.add_argument("--paddle-tokens", help="PaddleOCR Tokens，分号分隔")
    args = parser.parse_args()
    stdin_settings = _load_validation_settings()

    # 正式 JS 入口经 stdin 传递；命令行参数只保留给旧版手动调用。
    mineru_credentials = stdin_settings.get("mineruCredentials")
    if not isinstance(mineru_credentials, list):
        mineru_credentials = []
        if args.mineru_creds:
            try:
                parsed = json.loads(args.mineru_creds)
                if isinstance(parsed, list):
                    mineru_credentials = parsed
            except json.JSONDecodeError:
                pass
        elif args.mineru_tokens:
            mineru_credentials = [
                {"accessKey": t.strip(), "secretKey": ""}
                for t in args.mineru_tokens.split(";")
                if t.strip()
            ]

    paddle_tokens = stdin_settings.get("paddleTokens")
    if not isinstance(paddle_tokens, list):
        paddle_tokens = []
        if args.paddle_tokens:
            paddle_tokens = [t.strip() for t in args.paddle_tokens.split(";") if t.strip()]

    # 逐个验证
    mineru_results = []
    for cred in mineru_credentials:
        token = cred.get("accessKey") or cred.get("secretKey") or ""
        result = validate_mineru_token(token)
        mineru_results.append(result)

    paddle_results = []
    for token in paddle_tokens:
        result = validate_paddle_token(token)
        paddle_results.append(result)

    # 输出 JSON 结果
    output = {
        "mineru": mineru_results,
        "paddle": paddle_results,
        "summary": {
            "total": len(mineru_results) + len(paddle_results),
            "valid": sum(1 for r in mineru_results + paddle_results if r["ok"]),
            "invalid": sum(1 for r in mineru_results + paddle_results if not r["ok"]),
        },
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
