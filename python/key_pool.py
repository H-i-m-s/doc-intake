"""统一 KeyPool - 多 credential 轮询 + 失败跳过 + 可选告警。

使用：
    pool = KeyPool(["t1", "t2", "t3"], logger=my_logger)
    ak = pool.get_next()      # 拿到一个未失败的
    pool.mark_failed("t1")     # 标记失败
    ak = pool.get_next()       # 跳到 t2

设计原则：
- 线程/异步安全（无锁，Python GIL 足够单线程异步场景）
- 失败状态可重置
- 告警通过 logger.warning 注入，方便测试
"""
from __future__ import annotations

import threading
from typing import Optional

from logger import get_logger


def _mask(key: str) -> str:
    if not key or len(key) < 8:
        return "***"
    return key[:4] + "..." + key[-4:]


class KeyPool:
    """多 credential 轮询池。

    Attributes:
        credentials: 传入的 credential 列表（字符串或 dict {accessKey, secretKey}）。
        failed: 已失败 key 集合。
        on_failure: 失败告警回调，签名 (masked_key, available, total) -> None。
    """

    def __init__(self, credentials: Optional[list] = None, *, on_failure=None, logger_name: str = "key_pool"):
        self._lock = threading.Lock()
        self.credentials: list = list(credentials) if credentials else []
        self.failed: set[str] = set()
        self._index = 0
        self._notified: set[str] = set()
        self.on_failure = on_failure
        self._log = get_logger(logger_name)

    def reset(self) -> None:
        """清空失败状态。"""
        with self._lock:
            self.failed.clear()
            self._notified.clear()
            self._index = 0

    def set_credentials(self, credentials: list) -> None:
        """整体替换 credentials（保留当前 failed 状态）。"""
        with self._lock:
            self.credentials = list(credentials) if credentials else []
            self._index = 0

    @staticmethod
    def _cred_key(cred) -> str:
        """归一化凭证为 token 字符串。"""
        if isinstance(cred, dict):
            return str(cred.get("accessKey", "") or "")
        if isinstance(cred, str):
            return cred
        return ""

    def get_next(self) -> Optional[object]:
        """获取下一个未失败的凭证。

        Returns:
            原始 credential 对象（str 或 dict），或 None 表示池空或全部失败。
        """
        with self._lock:
            n = len(self.credentials)
            if n == 0:
                return None
            attempts = 0
            while attempts < n:
                cred = self.credentials[self._index % n]
                self._index += 1
                attempts += 1
                if self._cred_key(cred) not in self.failed:
                    return cred
            return None

    def mark_failed(self, cred_or_token) -> bool:
        """标记 credential 失败。返回是否新增失败。"""
        token = cred_or_token if isinstance(cred_or_token, str) else self._cred_key(cred_or_token)
        if not token:
            return False
        with self._lock:
            if token in self.failed:
                return False
            self.failed.add(token)
            self._notify_failure(token)
            return True

    def _notify_failure(self, token: str) -> None:
        if token in self._notified:
            return
        self._notified.add(token)
        if self.on_failure is not None:
            try:
                self.on_failure(_mask(token), self.available, self.total)
                return
            except Exception:
                pass
        # fallback: 直接 log warning
        self._log.warning(
            "Key 失效已自动跳过",
            key=_mask(token),
            available=f"{self.available}/{self.total}",
        )

    @property
    def total(self) -> int:
        return len(self.credentials)

    @property
    def available(self) -> int:
        return len(self.credentials) - len(self.failed)

    def stats(self) -> dict:
        return {"total": self.total, "failed": len(self.failed), "available": self.available}