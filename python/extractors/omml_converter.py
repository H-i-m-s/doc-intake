"""OMML to LaTeX converter

Based on eqword2llm's math_converter.py, adapted for doc-intake.
Converts Office Math Markup Language (OMML) elements to LaTeX format.
"""
from __future__ import annotations

from xml.etree import ElementTree as ET


# XML Namespace for Office Math
M_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/math"
M_NS = f"{{{M_NAMESPACE}}}"


try:
    from ._utils import local_name as _local_name
except ImportError:
    # 允许独立脚本调用（不在 package 上下文）
    import sys as _sys
    from pathlib import Path as _Path
    _p = str(_Path(__file__).parent)
    if _p not in _sys.path:
        _sys.path.insert(0, _p)
    from _utils import local_name as _local_name


# Unicode to LaTeX symbol mapping
SYMBOL_MAP = {
    "×": r"\times",
    "÷": r"\div",
    "±": r"\pm",
    "∓": r"\mp",
    "≤": r"\leq",
    "≥": r"\geq",
    "≠": r"\neq",
    "≈": r"\approx",
    "∞": r"\infty",
    "∑": r"\sum",
    "∏": r"\prod",
    "∫": r"\int",
    "∂": r"\partial",
    "∇": r"\nabla",
    "√": r"\sqrt",
    "∀": r"\forall ",
    "∈": r"\in ",
    "∉": r"\notin ",
    "⊂": r"\subset",
    "⊃": r"\supset",
    "⊆": r"\subseteq",
    "⊇": r"\supseteq",
    "∪": r"\cup",
    "∩": r"\cap",
    "∧": r"\wedge",
    "∨": r"\vee",
    "¬": r"\neg",
    "→": r"\rightarrow",
    "←": r"\leftarrow",
    "↔": r"\leftrightarrow",
    "⇒": r"\Rightarrow",
    "⇐": r"\Leftarrow",
    "⇔": r"\Leftrightarrow",
    "α": r"\alpha",
    "β": r"\beta",
    "γ": r"\gamma",
    "δ": r"\delta",
    "ε": r"\epsilon",
    "ζ": r"\zeta",
    "η": r"\eta",
    "θ": r"\theta",
    "ι": r"\iota",
    "κ": r"\kappa",
    "λ": r"\lambda",
    "μ": r"\mu",
    "ν": r"\nu",
    "ξ": r"\xi",
    "π": r"\pi",
    "ρ": r"\rho",
    "σ": r"\sigma",
    "τ": r"\tau",
    "υ": r"\upsilon",
    "φ": r"\phi",
    "χ": r"\chi",
    "ψ": r"\psi",
    "ω": r"\omega",
    "Γ": r"\Gamma",
    "Δ": r"\Delta",
    "Θ": r"\Theta",
    "Λ": r"\Lambda",
    "Ξ": r"\Xi",
    "Π": r"\Pi",
    "Σ": r"\Sigma",
    "Φ": r"\Phi",
    "Ψ": r"\Psi",
    "Ω": r"\Omega",
}


class OmmlToLatexConverter:
    """Converts OMML (Office Math Markup Language) elements to LaTeX."""

    def convert(self, element: ET.Element) -> str:
        """Convert OMML element to LaTeX string."""
        result: list[str] = []

        for child in element:
            tag = _local_name(child.tag)

            if tag == "r":
                text = self._get_math_text(child)
                result.append(text)
            elif tag == "f":
                result.append(self._convert_fraction(child))
            elif tag == "rad":
                result.append(self._convert_radical(child))
            elif tag == "sSup":
                result.append(self._convert_superscript(child))
            elif tag == "sSub":
                result.append(self._convert_subscript(child))
            elif tag == "sSubSup":
                result.append(self._convert_subsup(child))
            elif tag == "nary":
                result.append(self._convert_nary(child))
            elif tag == "d":
                result.append(self._convert_delimiter(child))
            elif tag == "func":
                result.append(self._convert_function(child))
            elif tag == "eqArr":
                result.append(self._convert_eq_array(child))
            elif tag == "m":
                result.append(self._convert_matrix(child))
            elif tag == "limLow":
                result.append(self._convert_lim_low(child))
            elif tag == "limUpp":
                result.append(self._convert_lim_upp(child))
            elif tag == "acc":
                result.append(self._convert_accent(child))
            elif tag == "bar":
                result.append(self._convert_bar(child))
            elif tag == "box":
                result.append(self.convert(child))
            elif tag == "groupChr":
                result.append(self._convert_group_chr(child))
            elif tag == "borderBox":
                result.append(self.convert(child))
            else:
                nested = self.convert(child)
                if nested:
                    result.append(nested)

        return "".join(result)

    def _get_math_text(self, run: ET.Element) -> str:
        """Get text from math run."""
        text_parts: list[str] = []
        for t in run.iter():
            if _local_name(t.tag) == "t" and t.text:
                text_parts.append(self._escape_latex(t.text))
        return "".join(text_parts)

    def _escape_latex(self, text: str) -> str:
        """Escape or convert LaTeX special characters."""
        for char, latex in SYMBOL_MAP.items():
            # 在 LaTeX 命令后添加空格，避免与后续字符连接
            if latex.startswith("\\") and len(latex) > 1:
                text = text.replace(char, latex + " ")
            else:
                text = text.replace(char, latex)
        return text

    def _find_child(self, element: ET.Element, tag: str) -> ET.Element | None:
        """Find child element by local name."""
        for child in element:
            if _local_name(child.tag) == tag:
                return child
        return None

    def _convert_fraction(self, frac: ET.Element) -> str:
        """Convert fraction."""
        frac_pr = self._find_child(frac, "fPr")
        frac_type = "bar"
        if frac_pr is not None:
            type_elem = self._find_child(frac_pr, "type")
            if type_elem is not None:
                frac_type = type_elem.get(f"{M_NS}val", "bar")

        num = self._find_child(frac, "num")
        den = self._find_child(frac, "den")

        num_latex = self.convert(num) if num is not None else ""
        den_latex = self.convert(den) if den is not None else ""

        if frac_type == "noBar":
            return rf"\binom{{{num_latex}}}{{{den_latex}}}"

        return rf"\frac{{{num_latex}}}{{{den_latex}}}"

    def _convert_radical(self, rad: ET.Element) -> str:
        """Convert radical (square root)."""
        deg = self._find_child(rad, "deg")
        e = self._find_child(rad, "e")

        e_latex = self.convert(e) if e is not None else ""

        if deg is not None:
            deg_latex = self.convert(deg)
            if deg_latex and deg_latex.strip():
                return rf"\sqrt[{deg_latex}]{{{e_latex}}}"

        return rf"\sqrt{{{e_latex}}}"

    def _convert_superscript(self, ssup: ET.Element) -> str:
        """Convert superscript."""
        e = self._find_child(ssup, "e")
        sup = self._find_child(ssup, "sup")

        e_latex = self.convert(e) if e is not None else ""
        sup_latex = self.convert(sup) if sup is not None else ""

        if len(e_latex) > 1 and not (e_latex.startswith("{") and e_latex.endswith("}")):
            e_latex = f"{{{e_latex}}}"

        return f"{e_latex}^{{{sup_latex}}}"

    def _convert_subscript(self, ssub: ET.Element) -> str:
        """Convert subscript."""
        e = self._find_child(ssub, "e")
        sub = self._find_child(ssub, "sub")

        e_latex = self.convert(e) if e is not None else ""
        sub_latex = self.convert(sub) if sub is not None else ""

        if len(e_latex) > 1 and not (e_latex.startswith("{") and e_latex.endswith("}")):
            e_latex = f"{{{e_latex}}}"

        return f"{e_latex}_{{{sub_latex}}}"

    def _convert_subsup(self, ssubsup: ET.Element) -> str:
        """Convert subscript-superscript."""
        e = self._find_child(ssubsup, "e")
        sub = self._find_child(ssubsup, "sub")
        sup = self._find_child(ssubsup, "sup")

        e_latex = self.convert(e) if e is not None else ""
        sub_latex = self.convert(sub) if sub is not None else ""
        sup_latex = self.convert(sup) if sup is not None else ""

        if len(e_latex) > 1 and not (e_latex.startswith("{") and e_latex.endswith("}")):
            e_latex = f"{{{e_latex}}}"

        return f"{e_latex}_{{{sub_latex}}}^{{{sup_latex}}}"

    def _convert_nary(self, nary: ET.Element) -> str:
        """Convert n-ary operator (integral, summation, etc.)."""
        naryPr = self._find_child(nary, "naryPr")
        sub = self._find_child(nary, "sub")
        sup = self._find_child(nary, "sup")
        e = self._find_child(nary, "e")

        operator = r"\int"
        if naryPr is not None:
            chr_elem = self._find_child(naryPr, "chr")
            if chr_elem is not None:
                char = chr_elem.get(f"{M_NS}val", "")
                operator_map = {
                    "∑": r"\sum",
                    "∏": r"\prod",
                    "∫": r"\int",
                    "∬": r"\iint",
                    "∭": r"\iiint",
                    "∮": r"\oint",
                    "⋃": r"\bigcup",
                    "⋂": r"\bigcap",
                }
                operator = operator_map.get(char, operator)

        sub_latex = self.convert(sub) if sub is not None else ""
        sup_latex = self.convert(sup) if sup is not None else ""
        e_latex = self.convert(e) if e is not None else ""

        result = operator
        if sub_latex:
            result += f"_{{{sub_latex}}}"
        if sup_latex:
            result += f"^{{{sup_latex}}}"
        result += f" {e_latex}"

        return result

    def _convert_delimiter(self, delim: ET.Element) -> str:
        """Convert delimiter (parentheses, brackets, etc.)."""
        dPr = self._find_child(delim, "dPr")

        beg_chr = "("
        end_chr = ")"

        if dPr is not None:
            begChr = self._find_child(dPr, "begChr")
            endChr = self._find_child(dPr, "endChr")

            if begChr is not None:
                beg_chr = begChr.get(f"{M_NS}val", "(")
            if endChr is not None:
                end_chr = endChr.get(f"{M_NS}val", ")")

        # Check if content contains a matrix
        e_elements = [c for c in delim if _local_name(c.tag) == "e"]
        if len(e_elements) == 1:
            first_e = e_elements[0]
            matrix = self._find_child(first_e, "m")
            if matrix is not None:
                matrix_content = self._convert_matrix_content(matrix)
                env = self._get_matrix_environment(beg_chr, end_chr)
                return rf"\begin{{{env}}}{matrix_content}\end{{{env}}}"

            # Check if content is a noBar fraction (binomial coefficient)
            frac = self._find_child(first_e, "f")
            if frac is not None and beg_chr == "(" and end_chr == ")":
                frac_pr = self._find_child(frac, "fPr")
                if frac_pr is not None:
                    type_elem = self._find_child(frac_pr, "type")
                    if type_elem is not None:
                        frac_type = type_elem.get(f"{M_NS}val", "bar")
                        if frac_type == "noBar":
                            return self._convert_fraction(frac)

        beg_map = {
            "(": r"\left(",
            "[": r"\left[",
            "{": r"\left\{",
            "|": r"\left|",
            "⟨": r"\left\langle",
            "‖": r"\left\|",
            "": "",
        }
        end_map = {
            ")": r"\right)",
            "]": r"\right]",
            "}": r"\right\}",
            "|": r"\right|",
            "⟩": r"\right\rangle",
            "‖": r"\right\|",
            "": r"\right.",
        }

        beg = beg_map.get(beg_chr, rf"\left{beg_chr}")
        end = end_map.get(end_chr, rf"\right{end_chr}")

        content_parts: list[str] = []
        for e in e_elements:
            content_parts.append(self.convert(e))

        content = ", ".join(content_parts)

        return f"{beg}{content}{end}"

    def _get_matrix_environment(self, beg_chr: str, end_chr: str) -> str:
        """Get appropriate LaTeX matrix environment based on delimiters."""
        if beg_chr == "[" and end_chr == "]":
            return "bmatrix"
        elif beg_chr == "(" and end_chr == ")":
            return "pmatrix"
        elif beg_chr == "{" and end_chr == "}":
            return "Bmatrix"
        elif beg_chr == "|" and end_chr == "|":
            return "vmatrix"
        elif beg_chr == "‖" and end_chr == "‖":
            return "Vmatrix"
        else:
            return "matrix"

    def _convert_matrix_content(self, matrix: ET.Element) -> str:
        """Convert matrix content without environment wrapper."""
        rows: list[str] = []
        for mr in matrix.findall(f"{M_NS}mr"):
            cols: list[str] = []
            for e in mr.findall(f"{M_NS}e"):
                cols.append(self.convert(e))
            rows.append(" & ".join(cols))
        return r" \\ ".join(rows)

    def _convert_function(self, func: ET.Element) -> str:
        """Convert function."""
        fName = self._find_child(func, "fName")
        e = self._find_child(func, "e")

        func_name = self.convert(fName) if fName is not None else ""
        e_latex = self.convert(e) if e is not None else ""

        func_map = {
            "sin": r"\sin",
            "cos": r"\cos",
            "tan": r"\tan",
            "cot": r"\cot",
            "sec": r"\sec",
            "csc": r"\csc",
            "sinh": r"\sinh",
            "cosh": r"\cosh",
            "tanh": r"\tanh",
            "log": r"\log",
            "ln": r"\ln",
            "exp": r"\exp",
            "lim": r"\lim",
            "max": r"\max",
            "min": r"\min",
            "sup": r"\sup",
            "inf": r"\inf",
            "det": r"\det",
            "dim": r"\dim",
            "arg": r"\arg",
        }

        latex_func = func_map.get(func_name.strip().lower(), func_name)

        return f"{latex_func} {e_latex}"

    def _convert_eq_array(self, eq_arr: ET.Element) -> str:
        """Convert equation array."""
        rows: list[str] = []
        for e in eq_arr.findall(f"{M_NS}e"):
            rows.append(self.convert(e))

        if len(rows) > 1:
            return r"\begin{aligned}" + r" \\ ".join(rows) + r"\end{aligned}"
        return rows[0] if rows else ""

    def _convert_matrix(self, matrix: ET.Element) -> str:
        """Convert matrix."""
        rows: list[str] = []
        for mr in matrix.findall(f"{M_NS}mr"):
            cols: list[str] = []
            for e in mr.findall(f"{M_NS}e"):
                cols.append(self.convert(e))
            rows.append(" & ".join(cols))

        return r"\begin{pmatrix}" + r" \\ ".join(rows) + r"\end{pmatrix}"

    def _convert_lim_low(self, lim_low: ET.Element) -> str:
        """Convert lower limit."""
        e = self._find_child(lim_low, "e")
        lim = self._find_child(lim_low, "lim")

        e_latex = self.convert(e) if e is not None else ""
        lim_latex = self.convert(lim) if lim is not None else ""

        return f"{e_latex}_{{{lim_latex}}}"

    def _convert_lim_upp(self, lim_upp: ET.Element) -> str:
        """Convert upper limit."""
        e = self._find_child(lim_upp, "e")
        lim = self._find_child(lim_upp, "lim")

        e_latex = self.convert(e) if e is not None else ""
        lim_latex = self.convert(lim) if lim is not None else ""

        return f"{e_latex}^{{{lim_latex}}}"

    def _convert_accent(self, acc: ET.Element) -> str:
        """Convert accent."""
        accPr = self._find_child(acc, "accPr")
        e = self._find_child(acc, "e")

        e_latex = self.convert(e) if e is not None else ""

        accent_char = "^"
        if accPr is not None:
            chr_elem = self._find_child(accPr, "chr")
            if chr_elem is not None:
                accent_char = chr_elem.get(f"{M_NS}val", "^")

        accent_map = {
            "̂": r"\hat",
            "̃": r"\tilde",
            "̄": r"\bar",
            "́": r"\acute",
            "̀": r"\grave",
            "̇": r"\dot",
            "̈": r"\ddot",
            "̆": r"\breve",
            "̌": r"\check",
            "⃗": r"\vec",
            "^": r"\hat",
            "~": r"\tilde",
            "¯": r"\bar",
            "→": r"\vec",
        }

        latex_accent = accent_map.get(accent_char, r"\hat")

        return f"{latex_accent}{{{e_latex}}}"

    def _convert_bar(self, bar: ET.Element) -> str:
        """Convert bar (overline)."""
        e = self._find_child(bar, "e")
        e_latex = self.convert(e) if e is not None else ""

        return rf"\overline{{{e_latex}}}"

    def _convert_group_chr(self, group_chr: ET.Element) -> str:
        """Convert group character."""
        e = self._find_child(group_chr, "e")
        e_latex = self.convert(e) if e is not None else ""

        groupChrPr = self._find_child(group_chr, "groupChrPr")
        if groupChrPr is not None:
            chr_elem = self._find_child(groupChrPr, "chr")
            if chr_elem is not None:
                char = chr_elem.get(f"{M_NS}val", "")
                if char == "⏟":
                    return rf"\underbrace{{{e_latex}}}"
                elif char == "⏞":
                    return rf"\overbrace{{{e_latex}}}"

        return e_latex


def convert_omml_to_latex(element: ET.Element) -> str:
    """Convert an OMML element to LaTeX string.
    
    Args:
        element: XML element containing OMML math content.
        
    Returns:
        LaTeX string representation.
    """
    converter = OmmlToLatexConverter()
    return converter.convert(element)


def extract_latex_from_docx(docx_path: str) -> list[dict]:
    """Extract all equations from a DOCX file.
    
    Args:
        docx_path: Path to the DOCX file.
        
    Returns:
        List of dicts with 'index', 'latex', and 'is_block' keys.
    """
    import zipfile
    
    equations = []
    
    with zipfile.ZipFile(docx_path) as zf:
        if "word/document.xml" not in zf.namelist():
            return equations
        
        content = zf.read("word/document.xml")
        root = ET.fromstring(content)
        
        converter = OmmlToLatexConverter()
        index = 0
        
        # Find all oMath and oMathPara elements
        for elem in root.iter():
            tag = _local_name(elem.tag)
            
            if tag == "oMath":
                index += 1
                latex = converter.convert(elem)
                if latex.strip():
                    equations.append({
                        "index": index,
                        "latex": latex,
                        "is_block": False,
                    })
            
            elif tag == "oMathPara":
                index += 1
                latex = converter.convert(elem)
                if latex.strip():
                    equations.append({
                        "index": index,
                        "latex": latex,
                        "is_block": True,
                    })
    
    return equations