"""API retry - 指数退避,自动区分可重试 / 不可重试错误。

用法:
    response = request_with_retry(
        "POST",
        "https://api.example.com/endpoint",
        json={"k": "v"},
        headers={"Authorization": f"bearer {token}"},
        max_retries=3,
        base_delay_ms=1000,
    )

行为:
- 200 / 2xx / 3xx: 立即返回 response
- 429 (rate limit): wait 8s, 16s, 32s (独立累计)
- 5xx: wait 1s, 2s, 4s (指数退避)
- 401 / 403 / 400 / 业务错: 立即抛 RetryExhausted,让上游降级
- 网络 Timeout / ConnectionError: wait 同 5xx
- max_retries 用尽: 把最后一次 response/exception 抛出,标记 RetryExhausted

调用方拿到 Response 后,200 正常用,其它 status_code 自己决定怎么处理
(例如 raise PaddleAuthError 等),但**不会再触发重试**。
"""
from __future__ import annotations

import time
from typing import Any, Optional

import requests

from logger import get_logger

logger = get_logger("api_retry")


# 不可重试的 status code（应作为业务错误立即抛出）
NON_RETRYABLE_STATUS = frozenset({400, 401, 403, 404, 410, 422})

# 重试 5xx 范围
RETRYABLE_5XX = frozenset({500, 502, 503, 504})

# 429 特殊: 更长的 wait window
RETRYABLE_429 = frozenset({429})


class RetryExhausted(Exception):
    """重试耗尽后抛出,携带最后一次 response 或 exception。"""

    def __init__(
        self,
        message: str,
        response: Optional[requests.Response] = None,
        cause: Optional[BaseException] = None,
    ) -> None:
        super().__init__(message)
        self.response = response
        self.cause = cause


def request_with_retry(
    method: str,
    url: str,
    *,
    max_retries: int = 3,
    base_delay_ms: int = 1000,
    logger_name: str = "api_retry",
    **kwargs: Any,
) -> requests.Response:
    """带指数退避的 HTTP 请求。

    Parameters:
        method: GET / POST / PUT / DELETE ...
        url: 完整 URL
        max_retries: 最多重试次数 (不含首请求)
        base_delay_ms: 基础 wait 毫秒,每次乘 2
        logger_name: 日志来源
        **kwargs: 透传给 requests.request

    Returns:
        成功 200 时返回 Response;否则最后一次的 Response(由调用方决定如何处理)。
    """
    kwargs.setdefault("timeout", 30)
    log = get_logger(logger_name)

    last_response: Optional[requests.Response] = None
    last_exception: Optional[BaseException] = None

    # 累计 retry count = max_retries + 1 次 attempts
    for attempt in range(max_retries + 1):
        is_retry = attempt > 0
        try:
            response = requests.request(method, url, **kwargs)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_exception = e
            if attempt >= max_retries:
                break
            delay_s = (base_delay_ms / 1000.0) * (2 ** (attempt - 1))
            log.warning(
                "HTTP 网络错误,准备重试",
                attempt=attempt + 1,
                max_retries=max_retries,
                error=str(e),
                next_delay_s=f"{delay_s:.1f}",
            )
            time.sleep(delay_s)
            continue
        except Exception as e:
            # 其它异常(编程错误)不重试,直接抛
            raise

        last_response = response
        status = response.status_code

        # 200 / 2xx / 3xx: 直接返回
        if 200 <= status < 400:
            if is_retry:
                log.info("重试后成功", attempt=attempt + 1, status=status)
            return response

        # 业务错（非重试）
        if status in NON_RETRYABLE_STATUS:
            log.info(
                "HTTP 业务错,不重试",
                status=status,
                attempt=attempt + 1,
            )
            return response

        # 是否走重试逻辑
        should_retry_429 = status in RETRYABLE_429
        should_retry_5xx = status in RETRYABLE_5XX
        if not (should_retry_429 or should_retry_5xx):
            # 未知 status code 也直接返回（不重试未知错误）
            return response

        if attempt >= max_retries:
            break

        if should_retry_429:
            # 429 rate limit: 长 wait base (8s) × 2^attempt
            delay_s = 8.0 * (2 ** attempt)
        else:
            # 5xx: base × 2^attempt
            delay_s = (base_delay_ms / 1000.0) * (2 ** attempt)

        log.warning(
            "HTTP 临时错误,准备重试",
            status=status,
            attempt=attempt + 1,
            max_retries=max_retries,
            next_delay_s=f"{delay_s:.1f}",
        )
        time.sleep(delay_s)

    if last_exception is not None:
        raise RetryExhausted(
            f"网络错误重试 {max_retries} 次后仍失败: {last_exception}",
            response=None,
            cause=last_exception,
        ) from last_exception

    # 有最后的 response 但都是非成功 status code
    raise RetryExhausted(
        f"HTTP 重试 {max_retries} 次后仍返回 {last_response.status_code if last_response else 'N/A'}",
        response=last_response,
    )
