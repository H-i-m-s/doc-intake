"""MathType 公式转换器

支持从 DOCX/PPTX 中提取 MathType OLE 对象并转换为 LaTeX。
MTEF 两套各自独立：v5（MathType 4/6/7）走 mtef_v5 + mtef_v5_latex，v3（Equation
Editor 3.x）走 mtef_v3 + mtef_v3_latex，都按官方规范实现。
"""
from __future__ import annotations

import io
import re
import struct
import sys
import zipfile
from pathlib import Path
from typing import Optional

# 添加 mathtype 模块路径
_mathtype_dir = Path(__file__).parent / "mathtype"
if str(_mathtype_dir) not in sys.path:
    sys.path.insert(0, str(_mathtype_dir))

from extractors._utils import local_name as _local_name
from logger import get_logger


class MathTypeConverter:
    """MathType 公式转换器"""

    def __init__(self):
        self.logger = get_logger("mathtype")
        self._mtef_available = None
    
    def _check_mtef_available(self) -> bool:
        """检查 MTEF 解析与渲染模块是否可用"""
        if self._mtef_available is None:
            try:
                import mtef_v3          # noqa: F401
                import mtef_v3_latex    # noqa: F401
                import mtef_v5          # noqa: F401
                import mtef_v5_latex    # noqa: F401
                self._mtef_available = True
            except ImportError:
                self._mtef_available = False
        return self._mtef_available
    
    def extract_mathtype_from_docx(self, docx_path: str) -> list[dict]:
        """
        从 DOCX 文件中提取 MathType 公式
        
        Args:
            docx_path: DOCX 文件路径
            
        Returns:
            列表，每个元素包含：
            - index: 公式索引
            - latex: LaTeX 字符串
            - position: 公式在文档中的位置描述
        """
        if not self._check_mtef_available():
            return []
        
        equations = []
        
        try:
            with zipfile.ZipFile(docx_path) as zf:
                # 查找所有 OLE 对象
                ole_files = [f for f in zf.namelist() 
                            if f.startswith("word/embeddings/") and f.endswith(".bin")]
                
                for ole_file in ole_files:
                    try:
                        ole_data = zf.read(ole_file)
                        self.logger.debug(f"处理 OLE", file=ole_file, size=len(ole_data))
                        latex = self._parse_ole_to_latex(ole_data)
                        self.logger.debug("OLE 转 LaTeX", preview=latex[:50] if latex else "None")
                        if latex:
                            equations.append({
                                "index": len(equations) + 1,
                                "latex": latex,
                                "position": ole_file,
                            })
                    except Exception as e:
                        self.logger.warning("OLE 解析失败", file=ole_file, error=str(e))
                        continue
        except Exception:
            pass
        
        return equations
    
    def extract_mathtype_from_pptx(self, pptx_path: str) -> list[dict]:
        """
        从 PPTX 文件中提取 MathType 公式
        
        Args:
            pptx_path: PPTX 文件路径
            
        Returns:
            列表，每个元素包含：
            - index: 公式索引
            - latex: LaTeX 字符串
            - slide: 所在幻灯片编号
        """
        if not self._check_mtef_available():
            return []
        
        equations = []
        
        try:
            with zipfile.ZipFile(pptx_path) as zf:
                # 查找所有 OLE 对象
                ole_files = [f for f in zf.namelist() 
                            if f.startswith("ppt/embeddings/") and f.endswith(".bin")]
                
                for ole_file in ole_files:
                    try:
                        ole_data = zf.read(ole_file)
                        latex = self._parse_ole_to_latex(ole_data)
                        if latex:
                            # 从文件名提取幻灯片编号
                            slide_match = re.search(r'slide(\d+)', ole_file)
                            slide_num = int(slide_match.group(1)) if slide_match else 0
                            
                            equations.append({
                                "index": len(equations) + 1,
                                "latex": latex,
                                "slide": slide_num,
                                "position": ole_file,
                            })
                    except Exception:
                        continue
        except Exception:
            pass
        
        return equations
    
    def _parse_ole_to_latex(self, ole_data: bytes) -> Optional[str]:
        """
        解析 OLE 数据中的 MathType 公式
        
        Args:
            ole_data: OLE 复合文件数据
            
        Returns:
            LaTeX 字符串，如果解析失败返回 None
        """
        try:
            from ole_util.ole import Ole
            
            # 解析 OLE 文件
            ole, err = Ole.Open(io.BytesIO(ole_data))
            if err or not ole:
                return None
            
            # 查找 Equation Native 流
            streams, err = ole.ListDir()
            if not streams:
                return None
            
            eq_stream = None
            root_stream = None
            
            for stream in streams:
                name = stream.Name() if callable(getattr(stream, 'Name', None)) else getattr(stream, 'Name', '')
                if "Equation" in name:
                    eq_stream = stream
                if stream.Type == 5:  # ROOT
                    root_stream = stream
            
            if not eq_stream or not root_stream:
                return None
            
            # 读取 Equation Native 流
            eq_stream_reader = ole.OpenFile(eq_stream, root_stream)
            eq_data = eq_stream_reader.read(eq_stream.Size)
            
            if len(eq_data) < 28:
                return None
            
            # 解析头部
            cbHdr = struct.unpack('<H', eq_data[0:2])[0]
            # Equation Native 头部布局为 cbHdr(2) + version(4) + cf(2) + cbSize(4)。
            cbSize = struct.unpack('<I', eq_data[8:12])[0]
            
            if cbHdr + cbSize > len(eq_data):
                # 数据范围错误，尝试使用剩余数据
                mtef_body = eq_data[cbHdr:]
            else:
                mtef_body = eq_data[cbHdr:cbHdr + cbSize]
            
            # 解析 MTEF：body 首字节就是版本号，按版本分派。这一步不再猜：
            # v5 走 mtef_v5 + mtef_v5_latex，v3 走 mtef_v3 + mtef_v3_latex，
            # 两边任何一步不确定都返回 None，由上层退回该公式的预览图。
            if mtef_body and mtef_body[0] == 5:
                return self._parse_v5_to_latex(mtef_body)
            return self._parse_v3_to_latex(mtef_body)
            
        except Exception as e:
            return None
    
    def _parse_v5_to_latex(self, mtef_body: bytes) -> Optional[str]:
        """MTEF v5（MathType 4/6/7）→ LaTeX。

        解析与渲染各一套：python/mathtype/mtef_v5.py 与 mtef_v5_latex.py。旧的
        mtef.py（mtef-go 的 Python 移植）已不再走这条路径。任何一步不确定就返回
        None，调用方退回该公式的预览图——宁可给一张对的图，不给一段错的 LaTeX。
        """
        try:
            import mtef_v5
            import mtef_v5_latex
        except ImportError as e:
            self.logger.warning("MTEF v5 模块不可用", error=str(e))
            return None

        # 只处理真正的 MTEF v5：body 首字节就是版本号。不加这道门的话，任何读不动的
        # 数据都会被按 v5 读一遍，可能从垃圾字节里猜出错解。
        if not mtef_body or mtef_body[0] != 5:
            return None

        try:
            eq = mtef_v5.parse(mtef_body)
        except Exception as e:
            self.logger.warning("MTEF v5 解析异常", error=str(e))
            return None

        if not eq.complete or eq.errors:
            # errors 里是「没遇到 END 就到底」「未知记录类型」这类提示：只要有一条，
            # 说明有地方没读懂，宁可退回公式预览图
            self.logger.warning("MTEF v5 没走满或有读不懂的记录，退回预览图",
                                consumed=eq.consumed, total=eq.total,
                                errors=eq.errors[:3])
            return None

        latex, notes = mtef_v5_latex.render(eq)
        if not latex:
            self.logger.warning("MTEF v5 渲染失败，退回预览图", notes=notes)
            return None

        self.logger.debug("MTEF v5 转出 LaTeX", preview=latex[:60])
        return self._clean_latex(latex)

    def _parse_v3_to_latex(self, mtef_body: bytes) -> Optional[str]:
        """MTEF v3（Equation Editor 3.x）→ LaTeX。

        v3 的解析与渲染是完全独立的另一套，见 python/mathtype/mtef_v3.py 与
        mtef_v3_latex.py 的文件头。任何一步不确定就返回 None，调用方会退回
        该公式的预览图——宁可给一张对的图，不给一段错的 LaTeX。
        """
        try:
            import mtef_v3
            import mtef_v3_latex
        except ImportError as e:
            self.logger.warning("MTEF v3 模块不可用", error=str(e))
            return None

        # 只处理真正的 MTEF v3：body 首字节就是版本号。不加这道门的话，
        # 任何「v5 解析失败」的公式都会被 v3 读一遍，可能从垃圾字节里猜出错解。
        if not mtef_body or mtef_body[0] != 3:
            return None

        try:
            eq = mtef_v3.parse(mtef_body)
        except Exception as e:
            self.logger.warning("MTEF v3 解析异常", error=str(e))
            return None

        if eq.header.mtef_version != 3 or not eq.complete or eq.errors:
            # errors 里是「没遇到 END 就到底」「未知记录类型」这类提示：
            # 只要有一条，说明有地方没读懂，宁可退回公式预览图
            self.logger.warning("MTEF v3 没走满或有读不懂的记录，退回预览图",
                                consumed=eq.consumed, total=eq.total,
                                errors=eq.errors[:3])
            return None

        latex, notes = mtef_v3_latex.render(eq)
        if not latex:
            self.logger.warning("MTEF v3 渲染失败，退回预览图", notes=notes)
            return None

        self.logger.debug("MTEF v3 转出 LaTeX", preview=latex[:60])
        return self._clean_latex(latex)

    def _clean_latex(self, latex: str) -> str:
        """清理 LaTeX 字符串"""
        if not latex:
            return ""
        
        # 移除多余的空白
        latex = latex.strip()
        
        # 移除连续的空格
        latex = re.sub(r'\s+', ' ', latex)
        
        # 移除开头的 $ 符号（如果有的话）
        latex = latex.strip('$')
        
        return latex
    
    def detect_equation_type(self, xml_content: str) -> dict:
        """
        检测 XML 中的公式类型
        
        Args:
            xml_content: XML 字符串
            
        Returns:
            字典包含：
            - omml_count: OMML 公式数量
            - mathtype_count: MathType OLE 对象数量
            - equation3_count: Equation.3（旧版）数量
            - unsupported: 不支持的格式列表
        """
        result = {
            "omml_count": 0,
            "mathtype_count": 0,
            "equation3_count": 0,
            "unsupported": [],
        }
        
        # 统计 OMML 公式
        result["omml_count"] = len(re.findall(r'<m:oMath|<m:oMathPara', xml_content))
        
        # 统计 MathType OLE 对象（Equation.DSMT4/DSMT6/DSMT7）
        mathtype_patterns = [
            r'progid="Equation\.DSMT4"',
            r'progid="Equation\.DSMT6"',
            r'progid="Equation\.DSMT7"',
        ]
        for pattern in mathtype_patterns:
            result["mathtype_count"] += len(re.findall(pattern, xml_content, re.IGNORECASE))
        
        # 统计 Equation.3（旧版）。注意：现在已经支持，由 mtef_v3 那一套解析；
        # 这里只是计数，不再列为不支持的格式。
        equation3_count = len(re.findall(r'progid="Equation\.3"', xml_content, re.IGNORECASE))
        result["equation3_count"] = equation3_count
        
        return result


def get_mathtype_converter() -> MathTypeConverter:
    """获取 MathType 转换器单例"""
    return MathTypeConverter()