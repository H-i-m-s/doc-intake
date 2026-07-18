"""统一日志模块"""
from __future__ import annotations

import functools
import logging
import os
import sys
from datetime import datetime
from typing import Optional, Any


class DocIntakeLogger:
    """doc-intake 统一日志记录器"""
    
    def __init__(self, name: str = "doc-intake"):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.DEBUG)
        
        # 避免重复添加 handler
        if not self.logger.handlers:
            # 控制台输出（用 stderr，避免污染 stdout 的 JSON 输出）
            console = logging.StreamHandler(sys.stderr)
            console.setLevel(self._get_console_level())
            formatter = logging.Formatter(
                '[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
                datefmt='%Y-%m-%dT%H:%M:%S'
            )
            console.setFormatter(formatter)
            self.logger.addHandler(console)
            
            # 文件输出（可选）
            log_file = os.environ.get("DOC_INTAKE_LOG_FILE")
            if log_file:
                try:
                    file_handler = logging.FileHandler(log_file, encoding='utf-8')
                    file_handler.setLevel(logging.DEBUG)
                    file_handler.setFormatter(formatter)
                    self.logger.addHandler(file_handler)
                except Exception as e:
                    self.logger.warning(f"无法创建日志文件 {log_file}: {e}")
    
    def _get_console_level(self) -> int:
        """从环境变量获取控制台日志级别"""
        level_str = os.environ.get("DOC_INTAKE_LOG_LEVEL", "INFO").upper()
        level_map = {
            "DEBUG": logging.DEBUG,
            "INFO": logging.INFO,
            "WARNING": logging.WARNING,
            "ERROR": logging.ERROR,
            "CRITICAL": logging.CRITICAL
        }
        return level_map.get(level_str, logging.INFO)
    
    def debug(self, msg: str, **kwargs: Any) -> None:
        """记录 DEBUG 级别日志"""
        if kwargs:
            extra_info = " ".join(f"{k}={v}" for k, v in kwargs.items())
            self.logger.debug(f"{msg} [{extra_info}]")
        else:
            self.logger.debug(msg)
    
    def info(self, msg: str, **kwargs: Any) -> None:
        """记录 INFO 级别日志"""
        if kwargs:
            extra_info = " ".join(f"{k}={v}" for k, v in kwargs.items())
            self.logger.info(f"{msg} [{extra_info}]")
        else:
            self.logger.info(msg)
    
    def warning(self, msg: str, **kwargs: Any) -> None:
        """记录 WARNING 级别日志"""
        if kwargs:
            extra_info = " ".join(f"{k}={v}" for k, v in kwargs.items())
            self.logger.warning(f"{msg} [{extra_info}]")
        else:
            self.logger.warning(msg)
    
    def error(self, msg: str, **kwargs: Any) -> None:
        """记录 ERROR 级别日志"""
        if kwargs:
            extra_info = " ".join(f"{k}={v}" for k, v in kwargs.items())
            self.logger.error(f"{msg} [{extra_info}]")
        else:
            self.logger.error(msg)
    
    def exception(self, msg: str, exc_info: bool = True, **kwargs: Any) -> None:
        """记录异常日志（包含堆栈信息）"""
        if kwargs:
            extra_info = " ".join(f"{k}={v}" for k, v in kwargs.items())
            self.logger.error(f"{msg} [{extra_info}]", exc_info=exc_info)
        else:
            self.logger.error(msg, exc_info=exc_info)
    
    def log_request(self, source: str, backend: str, output_dir: Optional[str] = None) -> None:
        """记录请求开始"""
        self.info("请求开始", 
                  source=source, 
                  backend=backend, 
                  output_dir=output_dir or "None")
    
    def log_response(self, markdown_length: int, image_count: int, duration: float) -> None:
        """记录响应结果"""
        self.info("请求完成",
                  markdown_length=markdown_length,
                  image_count=image_count,
                  duration_ms=f"{duration*1000:.1f}")
    
    def log_fallback(self, from_backend: str, to_backend: str, reason: str) -> None:
        """记录后端降级"""
        self.warning("后端降级",
                     from_backend=from_backend,
                     to_backend=to_backend,
                     reason=reason)
    
    def log_api_call(self, api_name: str, success: bool, duration: float, error: Optional[str] = None) -> None:
        """记录 API 调用"""
        if success:
            self.info(f"{api_name} 调用成功", duration_ms=f"{duration*1000:.1f}")
        else:
            self.error(f"{api_name} 调用失败", duration_ms=f"{duration*1000:.1f}", error=error or "未知错误")
    
    def log_file_operation(self, operation: str, path: str, success: bool, size: Optional[int] = None) -> None:
        """记录文件操作"""
        if success:
            size_info = f", size={size}" if size else ""
            self.info(f"文件{operation}成功", path=path, size_info=size_info)
        else:
            self.error(f"文件{operation}失败", path=path)


# 全局日志实例（默认实例，使用 doc-intake 作为 logger 名）
log = DocIntakeLogger()


@functools.lru_cache(maxsize=None)
def get_logger(name: Optional[str] = None) -> DocIntakeLogger:
    """获取日志实例。同名调用返回同一实例，避免 handler 重复添加。

    Args:
        name: logger 名字，None 时返回默认实例。

    Returns:
        DocIntakeLogger 实例。
    """
    if name is None:
        return log
    return DocIntakeLogger(name)