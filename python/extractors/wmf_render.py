"""WMF/EMF → PNG 的 GDI+ 渲染后端（ctypes 直调 gdiplus.dll，只用标准库）。

为什么要另开一条路：Pillow 在 Windows 上读 WMF 走的是 GDI 的 PlayMetaFile，Word 显示
同一份 WMF 走的是 GDI+。两者对 SetWindowExt / SetWindowOrg 与笔宽的解释不一样，落到
像素上就是几何被非等比压扁（占位头宽高比 0.714 的图渲成 0.23）、矢量笔画被拆成几段
粗虚线。让 GDI+ 自己解释同一份记录，才和 Word 看到的一致。

对外只有两个口子：`is_available()` 与 `render_to_png()`。渲染走
GdipLoadImageFromFile → GdipCreateBitmapFromScan0 → GdipDrawImageRectRectI →
GdipSaveImageToFile，目标长边 1440（给调用方裁墨迹留余量），宽高按共享比例算，
不独立拉伸。

两处踩过的坑，别改：
  * 结构体必须按真实布局声明 GUID / ImageCodecInfo（手动算偏移会 access violation）。
  * attrs 里要调 GdipSetImageAttributesWrapMode(attr, WrapModeTileFlipXY, 0xFF000000, 0)，
    否则缩放取样会把边缘的黑拉进来。
"""
from __future__ import annotations

import ctypes
import os
import sys
import threading

__all__ = ["is_available", "render_to_png"]

# GDI+ 的魔数（GdiplusEnums.h / GdiplusImaging.h）
_PIXEL_FORMAT_32BPP_ARGB = 0x0026200A
_SMOOTHING_MODE_ANTIALIAS = 4
_INTERPOLATION_HIGH_QUALITY_BICUBIC = 7
_COMPOSITING_QUALITY_HIGH = 4
_WRAP_MODE_TILE_FLIP_XY = 3
_UNIT_PIXEL = 2
_WHITE = 0xFFFFFFFF
_OPAQUE_MASK = 0xFF000000


class _GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", ctypes.c_uint32),
        ("Data2", ctypes.c_uint16),
        ("Data3", ctypes.c_uint16),
        ("Data4", ctypes.c_ubyte * 8),
    ]


class _ImageCodecInfo(ctypes.Structure):
    _fields_ = [
        ("Clsid", _GUID),
        ("FormatID", _GUID),
        ("CodecName", ctypes.c_wchar_p),
        ("DllName", ctypes.c_wchar_p),
        ("FormatDescription", ctypes.c_wchar_p),
        ("FilenameExtension", ctypes.c_wchar_p),
        ("MimeType", ctypes.c_wchar_p),
        ("Flags", ctypes.c_uint32),
        ("Version", ctypes.c_uint32),
        ("SigCount", ctypes.c_uint32),
        ("SigSize", ctypes.c_uint32),
        ("SigPattern", ctypes.c_void_p),
        ("SigMask", ctypes.c_void_p),
    ]


class _StartupInput(ctypes.Structure):
    _fields_ = [
        ("GdiplusVersion", ctypes.c_uint32),
        ("DebugEventCallback", ctypes.c_void_p),
        ("SuppressBackgroundThread", ctypes.c_int),
        ("SuppressExternalCodecs", ctypes.c_int),
    ]


# gdiplus.dll 句柄、启动令牌、编码器 CLSID：三样都只取一次，之后复用。
# 全部是惰性的 —— import 这个模块不碰任何 DLL（非 Windows 上也不该碰）。
_lock = threading.Lock()
_dll = None
_dll_loaded = False
_token = None
_png_clsid = None


def _declare(lib) -> None:
    """声明参数类型。64 位下不声明就是把指针当 int 传，句柄会被截断。"""
    P = ctypes.c_void_p
    lib.GdiplusStartup.restype = ctypes.c_int
    lib.GdiplusStartup.argtypes = [ctypes.POINTER(P), ctypes.POINTER(_StartupInput), P]
    lib.GdipLoadImageFromFile.restype = ctypes.c_int
    lib.GdipLoadImageFromFile.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(P)]
    lib.GdipGetImageWidth.restype = ctypes.c_int
    lib.GdipGetImageWidth.argtypes = [P, ctypes.POINTER(ctypes.c_uint32)]
    lib.GdipGetImageHeight.restype = ctypes.c_int
    lib.GdipGetImageHeight.argtypes = [P, ctypes.POINTER(ctypes.c_uint32)]
    lib.GdipCreateBitmapFromScan0.restype = ctypes.c_int
    lib.GdipCreateBitmapFromScan0.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        P,
        ctypes.POINTER(P),
    ]
    lib.GdipGetImageGraphicsContext.restype = ctypes.c_int
    lib.GdipGetImageGraphicsContext.argtypes = [P, ctypes.POINTER(P)]
    lib.GdipGraphicsClear.restype = ctypes.c_int
    lib.GdipGraphicsClear.argtypes = [P, ctypes.c_uint32]
    lib.GdipSetSmoothingMode.restype = ctypes.c_int
    lib.GdipSetSmoothingMode.argtypes = [P, ctypes.c_int]
    lib.GdipSetInterpolationMode.restype = ctypes.c_int
    lib.GdipSetInterpolationMode.argtypes = [P, ctypes.c_int]
    lib.GdipSetCompositingQuality.restype = ctypes.c_int
    lib.GdipSetCompositingQuality.argtypes = [P, ctypes.c_int]
    lib.GdipCreateImageAttributes.restype = ctypes.c_int
    lib.GdipCreateImageAttributes.argtypes = [ctypes.POINTER(P)]
    lib.GdipSetImageAttributesWrapMode.restype = ctypes.c_int
    lib.GdipSetImageAttributesWrapMode.argtypes = [P, ctypes.c_int, ctypes.c_uint32, ctypes.c_int]
    lib.GdipDrawImageRectRectI.restype = ctypes.c_int
    lib.GdipDrawImageRectRectI.argtypes = [
        P,
        P,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        P,
        P,
        P,
    ]
    lib.GdipSaveImageToFile.restype = ctypes.c_int
    lib.GdipSaveImageToFile.argtypes = [P, ctypes.c_wchar_p, ctypes.POINTER(_GUID), P]
    lib.GdipDisposeImage.restype = ctypes.c_int
    lib.GdipDisposeImage.argtypes = [P]
    lib.GdipDisposeImageAttributes.restype = ctypes.c_int
    lib.GdipDisposeImageAttributes.argtypes = [P]
    lib.GdipDeleteGraphics.restype = ctypes.c_int
    lib.GdipDeleteGraphics.argtypes = [P]
    lib.GdipGetImageEncodersSize.restype = ctypes.c_int
    lib.GdipGetImageEncodersSize.argtypes = [ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint32)]
    lib.GdipGetImageEncoders.restype = ctypes.c_int
    lib.GdipGetImageEncoders.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.POINTER(_ImageCodecInfo)]


def _load():
    """加载 gdiplus.dll 并声明参数类型。非 Windows / 加载失败返回 None。"""
    global _dll, _dll_loaded
    if _dll_loaded:
        return _dll
    with _lock:
        if _dll_loaded:
            return _dll
        if sys.platform != "win32":
            _dll_loaded = True
            return None
        try:
            lib = ctypes.WinDLL("gdiplus")
            _declare(lib)
        except Exception:
            _dll_loaded = True
            return None
        _dll = lib
        _dll_loaded = True
        return _dll


def _startup(lib) -> bool:
    """GdiplusStartup 全局只做一次，令牌复用。"""
    global _token
    if _token is not None:
        return True
    with _lock:
        if _token is not None:
            return True
        token = ctypes.c_void_p()
        inp = _StartupInput(1, None, 0, 0)
        if lib.GdiplusStartup(ctypes.byref(token), ctypes.byref(inp), None) != 0 or not token.value:
            return False
        _token = token
        return True


def _encoder_clsid(lib):
    """遍历 GDI+ 的编码器表，取 mime == image/png 的 CLSID。缓存一次。"""
    global _png_clsid
    if _png_clsid is not None:
        return _png_clsid
    num, size = ctypes.c_uint32(), ctypes.c_uint32()
    if lib.GdipGetImageEncodersSize(ctypes.byref(num), ctypes.byref(size)) != 0 or not size.value:
        return None
    buf = ctypes.create_string_buffer(size.value)
    # 传数给 DLL 时得是 ImageCodecInfo*,读回来还得用同一块内存（from_buffer 不拷），
    # 所以先 cast 调用、再按数组解一遍。
    if lib.GdipGetImageEncoders(num, size, ctypes.cast(buf, ctypes.POINTER(_ImageCodecInfo))) != 0:
        return None
    for info in (_ImageCodecInfo * num.value).from_buffer(buf):
        if (info.MimeType or "").lower() == "image/png":
            _png_clsid = info.Clsid
            return _png_clsid
    return None


def is_available() -> bool:
    """Windows 且 gdiplus.dll 能加载。第一次问会真去 LoadLibrary，之后看缓存。"""
    return _load() is not None


def render_to_png(src: str, dst: str, long_side: int = 1440) -> bool:
    """把 WMF/EMF（GDI+ 能打开的任何图片其实都行）渲成 PNG。成功 True，失败 False，不抛。"""
    lib = _load()
    if lib is None or not _startup(lib):
        return False
    ok = False
    try:
        ok = _render(lib, src, dst, long_side)
    except Exception:
        ok = False
    if not ok:
        # 失败可能留下一截写坏的文件，删掉；调用方只该看到一个干净的 False。
        try:
            os.unlink(dst)
        except OSError:
            pass
    return ok


def _render(lib, src: str, dst: str, long_side: int) -> bool:
    if not src or not dst or long_side <= 0:
        return False
    image = ctypes.c_void_p()
    if lib.GdipLoadImageFromFile(str(src), ctypes.byref(image)) != 0 or not image.value:
        return False
    try:
        iw, ih = ctypes.c_uint32(), ctypes.c_uint32()
        if lib.GdipGetImageWidth(image, ctypes.byref(iw)) != 0 or iw.value == 0:
            return False
        if lib.GdipGetImageHeight(image, ctypes.byref(ih)) != 0 or ih.value == 0:
            return False

        # 长边定到 long_side，另一边按同一比例算 —— 不独立拉伸。
        scale = long_side / max(iw.value, ih.value)
        width = max(1, round(iw.value * scale))
        height = max(1, round(ih.value * scale))

        bitmap = ctypes.c_void_p()
        if lib.GdipCreateBitmapFromScan0(
            width, height, 0, _PIXEL_FORMAT_32BPP_ARGB, None, ctypes.byref(bitmap)
        ) != 0 or not bitmap.value:
            return False
        try:
            graphics = ctypes.c_void_p()
            if lib.GdipGetImageGraphicsContext(bitmap, ctypes.byref(graphics)) != 0 or not graphics.value:
                return False
            try:
                lib.GdipGraphicsClear(graphics, ctypes.c_uint32(_WHITE))
                lib.GdipSetSmoothingMode(graphics, _SMOOTHING_MODE_ANTIALIAS)
                lib.GdipSetInterpolationMode(graphics, _INTERPOLATION_HIGH_QUALITY_BICUBIC)
                lib.GdipSetCompositingQuality(graphics, _COMPOSITING_QUALITY_HIGH)

                attrs = ctypes.c_void_p()
                if lib.GdipCreateImageAttributes(ctypes.byref(attrs)) != 0 or not attrs.value:
                    return False
                try:
                    lib.GdipSetImageAttributesWrapMode(
                        attrs, _WRAP_MODE_TILE_FLIP_XY, ctypes.c_uint32(_OPAQUE_MASK), 0
                    )
                    if lib.GdipDrawImageRectRectI(
                        graphics,
                        image,
                        0,
                        0,
                        width,
                        height,
                        0,
                        0,
                        iw.value,
                        ih.value,
                        _UNIT_PIXEL,
                        attrs,
                        None,
                        None,
                    ) != 0:
                        return False
                finally:
                    lib.GdipDisposeImageAttributes(attrs)

                clsid = _encoder_clsid(lib)
                if clsid is None:
                    return False
                if lib.GdipSaveImageToFile(bitmap, str(dst), ctypes.byref(clsid), None) != 0:
                    return False
            finally:
                lib.GdipDeleteGraphics(graphics)
        finally:
            lib.GdipDisposeImage(bitmap)
    finally:
        lib.GdipDisposeImage(image)
    return os.path.isfile(dst) and os.path.getsize(dst) > 0
