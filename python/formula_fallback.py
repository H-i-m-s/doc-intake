"""公式预览图 → LaTeX 的兜底识别链。

背景：DOCX/PPTX 里的公式对象有两条本地路径，OMML 走 omml_converter，MathType 的
OLE 对象走 mathtype_converter。两条都转不出来时，正文里会留下一张公式预览图
（WMF/EMF，经 emf_converter 渲成 PNG）。这一层就是给这张图再试一次：本地小模型
认出 LaTeX 就用它换掉图片，认不出就照旧保留图片。

设置项 `formulaChain` 是有序的后端 id 列表，顺序即优先级：
  local    现有的 OMML + MathType 转换器。它不是一个可选后端，是前置条件：
           它已经跑过（失败）才轮到这里，因此永远在首位、不可取消。
  texo     本地小模型 Texo（encoder + decoder ONNX）。
  plus-m   本地小模型 PP-FormulaNet-Plus-M。

本模块只做「识别」这一件事：给定一张图，返回 LaTeX 或 None。绝不抛异常——这条链
是兜底，失败的含义是「跟以前一样留一张图」，不是「整个提取坏掉」。

依赖纪律：只用 onnxruntime + numpy + Pillow（plus-m 另需 tokenizers + PyYAML，都从
模型目录的 yml 里读参数与字符表）。不引入 torch / transformers / paddle。权重不进
仓库、不进分发包，由用户显式点击安装（见 python/formula_models.py）。
"""

from __future__ import annotations

import os
import shutil
import tempfile
import threading
from pathlib import Path

from logger import get_logger

logger = get_logger("formula_fallback")

LOCAL = "local"
TEXO = "texo"
PLUS_M = "plus-m"
BACKENDS = (TEXO, PLUS_M)
DEFAULT_CHAIN = [LOCAL]

# 模型目录里的布局。只认文件，不看标记文件：卸载就是删目录，装到一半也有明确判据。
MODEL_FILES = {
    TEXO: ("onnx/encoder_model.onnx", "onnx/decoder_model.onnx", "onnx/tokenizer.json"),
    PLUS_M: ("PP-FormulaNet_plus-M.onnx", "PP-FormulaNet_plus-M_inference.yml"),
}
MODEL_DIRS = {TEXO: "texo", PLUS_M: "plus-m"}

# Texo 的三条实测结论（见 eval_texo.py）：
#   1. decoder_with_past / decoder_model_merged 的 KV 缓存是坏的，必须整序列重算；
#   2. 必须给 max_new_tokens 上限（512）；同一个 token 连续出现超过 50 次就中止，
#      否则会撞上 2053 个 "~" 的死循环（实测单张 19.9 秒）；
#   3. 预处理照 EvalMERImageProcessor：去白边 → 短边 384 → 居中补黑边 384×384 →
#      灰度复制 3 通道 → (x/255-0.7931)/0.1738。
_TEXO_SIZE = 384
_TEXO_MEAN = 0.7931
_TEXO_STD = 0.1738
_TEXO_MAX_NEW_TOKENS = 512
_TEXO_REPEAT_LIMIT = 50
_TEXO_DECODER_START = 0
_TEXO_EOS = 2

# PP-FormulaNet-Plus-M：导出图里自回归循环已经烘进计算图，一次前向直接得到 token
# 序列（int64），不是 logits。所以这边没有逐 token 的循环，只有「前向 + 解码」。
_PLUS_M_EOS = 2
_PLUS_M_SIZE = 384
_PLUS_M_MAX_TOKENS = 2560
# 归一化均值/方差与 Texo 相同（同一个 PaddleOCR 系训练口径），单独命名以免以后
# 其中一个变了另一个被顺手改掉。
_PLUS_M_MEAN = 0.7931
_PLUS_M_STD = 0.1738

_state = {
    "model_dir": "",
    "sessions": {},   # backend -> 已加载的 session 对象
    "failed": set(),  # backend：加载失败过，别每次都重试
}
_lock = threading.Lock()


# ---------------------------------------------------------------- 目录与安装状态

def models_root(settings: dict | None = None) -> str:
    """模型根目录。设置里给了就用，其次环境变量，最后空串（= 没装）。"""
    if settings:
        value = settings.get("formulaModelDir")
        if isinstance(value, str) and value.strip():
            return value.strip()
    env = os.environ.get("DOC_INTAKE_MODEL_DIR", "")
    return env.strip()


def backend_dir(backend: str, root: str | None = None) -> Path:
    base = root if root is not None else _state["model_dir"]
    return Path(base) / MODEL_DIRS.get(backend, backend)


def is_installed(backend: str, root: str | None = None) -> bool:
    """两个必需文件都在才算装了。加载失败不在这里判——那是调用时的事。"""
    if backend not in MODEL_FILES:
        return False
    directory = backend_dir(backend, root)
    if not str(directory).strip() or not directory.is_dir():
        return False
    return all((directory / rel).is_file() for rel in MODEL_FILES[backend])


def installed_bytes(backend: str, root: str | None = None) -> int:
    """目录实际占用（只统计文件），给设置页显示「已装 xx MB」。"""
    directory = backend_dir(backend, root)
    if not directory.is_dir():
        return 0
    total = 0
    for path in directory.rglob("*"):
        try:
            if path.is_file():
                total += path.stat().st_size
        except OSError:
            continue
    return total


def _normalize_chain(raw) -> list[str]:
    """设置值 → 后端 id 列表。数组是正式形态，字符串（"a>b;c"）也认，方便手改配置。"""
    if isinstance(raw, list):
        items = [str(item).strip() for item in raw]
    elif isinstance(raw, str):
        items = [part.strip() for part in raw.replace(">", ";").replace(",", ";").split(";")]
    else:
        items = []
    chain: list[str] = []
    for item in items:
        if item and item not in chain:
            chain.append(item)
    return chain


def chain_from_settings(settings: dict | None) -> list[str]:
    """`formulaChain` → 有序、已装、非 local 的后端列表。

    未安装的静默剔除（只记一条 debug）：这个链的语义是「能不能多试一次」，
    少一个后端不该让提取失败，也不该在正文里留一行没用的警告。
    `local` 是前置条件，不在这里返回——它已经跑过了。
    """
    settings = settings or {}
    chain = _normalize_chain(settings.get("formulaChain"))
    root = models_root(settings)
    _state["model_dir"] = root

    picked: list[str] = []
    for backend in chain:
        if backend == LOCAL:
            continue
        if backend not in MODEL_FILES:
            logger.debug("公式兜底链里有未知后端，已跳过", backend=backend)
            continue
        if not is_installed(backend, root):
            logger.debug("公式兜底后端未安装，已跳过", backend=backend, model_dir=root or "(未配置)")
            continue
        picked.append(backend)
    return picked


# ---------------------------------------------------------------- 识别入口

def recognize(image_path: str, backend: str) -> str | None:
    """一张图 → LaTeX。任何失败都返回 None，并记下原因。

    签名保持 (路径, 后端)：模型目录来自 chain_from_settings 时落下的模块状态，
    这样调用方（两个 extractor）不需要各自维护一份目录。
    """
    try:
        if backend == TEXO:
            return _recognize_texo(image_path)
        if backend == PLUS_M:
            return _recognize_plus_m(image_path)
        logger.debug("未知的公式兜底后端", backend=backend)
        return None
    except Exception as exc:  # noqa: BLE001 —— 兜底链绝不能把异常抛出去
        logger.warning("公式兜底识别失败", backend=backend, reason=f"{type(exc).__name__}: {exc}")
        return None


def _clean_latex(text: str | None) -> str | None:
    """模型输出 → 能直接进 $...$ 的 LaTeX。空串/纯空白一律当没认出来。"""
    if not isinstance(text, str):
        return None
    value = text.strip()
    if value.startswith("$$") and value.endswith("$$") and len(value) > 4:
        value = value[2:-2].strip()
    elif value.startswith("$") and value.endswith("$") and len(value) > 2:
        value = value[1:-1].strip()
    value = " ".join(value.split())
    return value or None


def _get_session(backend: str):
    """进程内单例：第一次调用才加载，加载失败当作未安装（记住，不反复重试）。"""
    with _lock:
        if backend in _state["failed"]:
            return None
        if backend in _state["sessions"]:
            return _state["sessions"][backend]
    try:
        if backend == TEXO:
            session = _load_texo(_state["model_dir"])
        elif backend == PLUS_M:
            session = _load_plus_m(_state["model_dir"])
        else:
            return None
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "公式兜底模型加载失败，按未安装处理",
            backend=backend,
            reason=f"{type(exc).__name__}: {exc}",
        )
        with _lock:
            _state["failed"].add(backend)
        return None
    with _lock:
        _state["sessions"][backend] = session
    return session


def reset_cache() -> None:
    """丢掉已加载的 session。测试与「卸载后立刻重装」用；正常运行不需要。"""
    with _lock:
        _state["sessions"].clear()
        _state["failed"].clear()


# ---------------------------------------------------------------- Texo

def _load_texo(root: str):
    import onnxruntime as ort
    from tokenizers import Tokenizer

    directory = backend_dir(TEXO, root)
    if not is_installed(TEXO, root):
        raise FileNotFoundError(f"Texo 权重不完整：{directory}")

    ort.set_default_logger_severity(3)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 0
    provider = ["CPUExecutionProvider"]
    encoder = ort.InferenceSession(str(directory / "onnx" / "encoder_model.onnx"), options, providers=provider)
    # 只用 decoder_model.onnx：带 past 的那两个导出 KV 缓存是坏的（见文件头的实测结论）。
    decoder = ort.InferenceSession(str(directory / "onnx" / "decoder_model.onnx"), options, providers=provider)
    tokenizer = Tokenizer.from_file(str(directory / "onnx" / "tokenizer.json"))
    tokenizer.no_padding()
    tokenizer.no_truncation()

    encoder_input = encoder.get_inputs()[0].name
    decoder_inputs = [item.name for item in decoder.get_inputs()]
    ids_name = next((name for name in decoder_inputs if "input_ids" in name), decoder_inputs[0])
    states_name = next(
        (name for name in decoder_inputs if "encoder" in name),
        decoder_inputs[1] if len(decoder_inputs) > 1 else decoder_inputs[0],
    )
    return {
        "encoder": encoder,
        "decoder": decoder,
        "tokenizer": tokenizer,
        "encoder_input": encoder_input,
        "ids_name": ids_name,
        "states_name": states_name,
    }


def _texo_preprocess(image_path: str):
    """EvalMERImageProcessor 的等价实现（numpy + Pillow，不引 albumentations）。"""
    import numpy as np
    from PIL import Image, ImageOps

    with Image.open(image_path) as raw:
        image = raw.convert("RGB")

    # 去白边：先归一化灰度到 0-255，再把 <200 的像素当墨迹取外接框。
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    highest, lowest = float(gray.max()), float(gray.min())
    if highest != lowest:
        scaled = (gray - lowest) / (highest - lowest) * 255.0
        ys, xs = np.nonzero(scaled < 200)
        if len(xs):
            image = image.crop(
                (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
            )

    # 短边缩到 384（torchvision F.resize(img, 384) 的口径：短边等于目标值）。
    width, height = image.size
    if width <= height:
        new_w, new_h = max(1, round(_TEXO_SIZE * width / height)), _TEXO_SIZE
    else:
        new_w, new_h = _TEXO_SIZE, max(1, round(_TEXO_SIZE * height / width))
    image = image.resize((new_w, new_h), Image.BILINEAR)
    image.thumbnail((_TEXO_SIZE, _TEXO_SIZE))

    # 居中补黑边到 384×384
    delta_w = _TEXO_SIZE - image.width
    delta_h = _TEXO_SIZE - image.height
    image = ImageOps.expand(
        image,
        (delta_w // 2, delta_h // 2, delta_w - delta_w // 2, delta_h - delta_h // 2),
    )

    # 灰度复制 3 通道，再按均值/方差归一化
    values = np.asarray(image.convert("L"), dtype=np.float32)
    values = np.stack([values, values, values], axis=-1)
    values = (values / 255.0 - _TEXO_MEAN) / _TEXO_STD
    return values.transpose(2, 0, 1)[None].astype(np.float32)


def _texo_decode(session, pixel) -> str | None:
    """整序列重算的贪心解码，带上限与重复检测。重复中止时返 None（见下面的理由）。"""
    import numpy as np

    hidden = session["encoder"].run(None, {session["encoder_input"]: pixel})[0]
    ids = [_TEXO_DECODER_START]
    produced: list[int] = []
    last_token = None
    repeats = 0

    for _ in range(_TEXO_MAX_NEW_TOKENS):
        logits = session["decoder"].run(
            None,
            {
                session["ids_name"]: np.array([ids], dtype=np.int64),
                session["states_name"]: hidden,
            },
        )[0]
        token = int(logits[0, -1].argmax())
        if token == _TEXO_EOS:
            break
        produced.append(token)
        if token == last_token:
            repeats += 1
            if repeats >= _TEXO_REPEAT_LIMIT:
                # 同一个 token 一路刷下去就是死循环（实测过一张图刷出 2053 个 "~"，
                # 单张 19.9 秒）。中止之后不把这段残文当结果：拿 60 个 "~" 去替换一张
                # 本来正确的公式图，比保留图片更糟。
                logger.debug("Texo 解码遇到重复 token，放弃这次结果", token=token, repeats=repeats)
                return None
        else:
            last_token = token
            repeats = 1
        ids.append(token)

    return session["tokenizer"].decode(produced, skip_special_tokens=True)


def _recognize_texo(image_path: str) -> str | None:
    if not image_path or not Path(image_path).is_file():
        logger.debug("Texo 识别失败", reason="图片不存在", path=image_path)
        return None
    session = _get_session(TEXO)
    if session is None:
        logger.debug("Texo 识别失败", reason="模型未就绪")
        return None
    try:
        latex = _texo_decode(session, _texo_preprocess(image_path))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Texo 前向失败", reason=f"{type(exc).__name__}: {exc}")
        return None
    return _clean_latex(latex)


# ---------------------------------------------------------------- PP-FormulaNet-Plus-M

def _load_plus_m(root: str):
    """权重 + yml 都在才加载；预处理参数与字符表全部从 yml 读，不抄 MinerU 的代码。"""
    import onnxruntime as ort
    import yaml
    from tokenizers import Tokenizer

    directory = backend_dir(PLUS_M, root)
    if not is_installed(PLUS_M, root):
        raise FileNotFoundError(f"PP-FormulaNet-Plus-M 权重不完整：{directory}")

    with open(directory / "PP-FormulaNet_plus-M_inference.yml", encoding="utf-8") as handle:
        config = yaml.safe_load(handle) or {}

    # yml 里的字符表本身就是一份 fast tokenizer 的配置；直接交给 tokenizers 还原，
    # 不在本仓库里另存一张字符表（那张表跟权重版本绑死，抄出来就会漂）。
    character_dict = ((config.get("PostProcess") or {}).get("character_dict") or {})
    tokenizer_json = character_dict.get("fast_tokenizer_file")
    if tokenizer_json is None:
        raise ValueError("yml 里没有 PostProcess.character_dict.fast_tokenizer_file")
    if isinstance(tokenizer_json, dict):
        import json

        tokenizer = Tokenizer.from_str(json.dumps(tokenizer_json, ensure_ascii=False))
    else:
        tokenizer = Tokenizer.from_str(str(tokenizer_json))

    size = _PLUS_M_SIZE
    for op in (((config.get("PreProcess") or {}).get("transform_ops")) or []):
        if not isinstance(op, dict):
            continue
        spec = op.get("UniMERNetImgDecode")
        if isinstance(spec, dict) and spec.get("input_size"):
            values = spec["input_size"]
            if isinstance(values, (list, tuple)) and len(values) == 2:
                size = (int(values[0]), int(values[1]))
    max_tokens = ((config.get("PostProcess") or {}).get("max_text_length")) or _PLUS_M_MAX_TOKENS

    ort.set_default_logger_severity(3)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 0
    providers = ["CPUExecutionProvider"]
    try:  # DirectML 可选：装了就用，没装照 CPU 跑
        available = ort.get_available_providers()
        if "DmlExecutionProvider" in available:
            providers = ["DmlExecutionProvider", "CPUExecutionProvider"]
    except Exception:  # noqa: BLE001
        providers = ["CPUExecutionProvider"]

    session = ort.InferenceSession(
        str(directory / "PP-FormulaNet_plus-M.onnx"), options, providers=providers
    )
    return {
        "session": session,
        "input_name": session.get_inputs()[0].name,
        "tokenizer": tokenizer,
        "size": size,
        "max_tokens": int(max_tokens),
    }


def _plus_m_preprocess(image_path: str, size) -> "object":
    """与 yml 里 UniMERNetImgDecode + UniMERNetTestTransform 同口径：去边、缩放、居中补边、归一化。"""
    import numpy as np
    from PIL import Image, ImageOps

    target_h, target_w = int(size[0]), int(size[1])

    with Image.open(image_path) as raw:
        image = raw.convert("RGB")

    gray = np.asarray(image.convert("L"), dtype=np.float32)
    highest, lowest = float(gray.max()), float(gray.min())
    if highest != lowest:
        scaled = (gray - lowest) / (highest - lowest) * 255.0
        ys, xs = np.nonzero(scaled < 200)
        if len(xs):
            image = image.crop(
                (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
            )

    short = min(target_h, target_w)
    width, height = image.size
    if width <= height:
        new_w, new_h = max(1, int(short * width / height)), short
    else:
        new_w, new_h = short, max(1, int(short * height / width))
    image = image.resize((new_w, new_h), Image.BILINEAR)
    image.thumbnail((target_w, target_h))

    delta_w = target_w - image.width
    delta_h = target_h - image.height
    image = ImageOps.expand(
        image,
        (delta_w // 2, delta_h // 2, delta_w - delta_w // 2, delta_h - delta_h // 2),
    )

    values = np.asarray(image, dtype=np.float32) / 255.0
    values = (values - np.array([_PLUS_M_MEAN] * 3, dtype=np.float32)) / np.array(
        [_PLUS_M_STD] * 3, dtype=np.float32
    )
    return values.transpose(2, 0, 1)[None].astype(np.float32)


def _recognize_plus_m(image_path: str) -> str | None:
    if not image_path or not Path(image_path).is_file():
        logger.debug("PP-FormulaNet-Plus-M 识别失败", reason="图片不存在", path=image_path)
        return None
    session = _get_session(PLUS_M)
    if session is None:
        logger.debug("PP-FormulaNet-Plus-M 识别失败", reason="模型未就绪")
        return None

    tensor = _plus_m_preprocess(image_path, session["size"])
    output = session["session"].run(None, {session["input_name"]: tensor})[0]

    try:
        import numpy as np

        array = np.asarray(output)
        ids = array[0].tolist() if array.ndim == 2 else array.tolist()
        # 导出图输出的是 token id（整数），不是 logits；万一是 logits 就说明装错了模型。
        if not ids or not all(isinstance(item, (int, np.integer)) for item in ids):
            logger.warning("PP-FormulaNet-Plus-M 输出不是 token 序列", shape=str(array.shape), dtype=str(array.dtype))
            return None
        ids = [int(item) for item in ids][: session["max_tokens"]]
        if _PLUS_M_EOS in ids:
            ids = ids[: ids.index(_PLUS_M_EOS) + 1]
        latex = session["tokenizer"].decode(ids, skip_special_tokens=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("PP-FormulaNet-Plus-M 解码失败", reason=f"{type(exc).__name__}: {exc}")
        return None
    return _clean_latex(latex)


# ---------------------------------------------------------------- 一次提取的链

class FormulaFallback:
    """一次文件提取内的链执行器：持有链、编号、临时文件，成功时记账。

    编号是「文档里第几个公式对象」，从 1 开始，与正文顺序一致。链没启用时一个号
    也不发（没有记账就没有编号需求），启用时每个公式对象都发号。
    """

    def __init__(self, settings: dict | None):
        self.chain = chain_from_settings(settings)
        self.entries: list[dict] = []
        self._seq = 0
        self._temp_dir: str | None = None

    @property
    def active(self) -> bool:
        return bool(self.chain)

    def next_index(self) -> int:
        self._seq += 1
        return self._seq

    def recover(self, image_path: str | None, index: int):
        """按链顺序试。返回 (latex, backend) 或 (None, None)。

        每个后端单独兜异常：`recognize` 自己已经是「绝不抛」，但这层仍要防一手——
        链是兜底，任何一个后端出意外都不该让整个文件的提取挂掉。
        """
        if not self.active or not image_path:
            return None, None
        for backend in self.chain:
            try:
                latex = recognize(image_path, backend)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "公式兜底后端抛异常，已跳过",
                    backend=backend,
                    reason=f"{type(exc).__name__}: {exc}",
                )
                continue
            if not latex:
                continue
            self.entries.append({"index": index, "backend": backend})
            return latex, backend
        return None, None

    def materialize(self, zf, media_path: str) -> str | None:
        """把 zip 里的预览图落成临时文件（EMF/WMF 顺手转 PNG）供识别。

        DOCX 有输出目录时预览图早就落盘了，用不上这一条；PPTX 与「只返回不落盘」
        的场景要临时取一份。
        """
        if not media_path:
            return None
        suffix = Path(media_path).suffix.lower()
        try:
            if self._temp_dir is None:
                self._temp_dir = tempfile.mkdtemp(prefix="docintake-formula-")
            stem = Path(media_path).stem
            raw_path = Path(self._temp_dir) / f"{stem}{suffix}"
            with zf.open(media_path) as src, open(raw_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            if suffix in (".emf", ".wmf"):
                from extractors.emf_converter import convert_emf_to_png

                png_path = Path(self._temp_dir) / f"{stem}.png"
                if not convert_emf_to_png(str(raw_path), str(png_path)):
                    return None
                return str(png_path)
            return str(raw_path)
        except Exception as exc:  # noqa: BLE001
            logger.debug("公式预览图取不出来", reason=f"{type(exc).__name__}: {exc}", path=media_path)
            return None

    def close(self) -> None:
        if self._temp_dir:
            shutil.rmtree(self._temp_dir, ignore_errors=True)
            self._temp_dir = None
