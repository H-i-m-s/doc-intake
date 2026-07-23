class RecordType:
    # uint8
    END = 0
    LINE = 1
    CHAR = 2
    TMPL = 3
    PILE = 4
    MATRIX = 5
    EMBELL = 6
    RULER = 7
    FONT_STYLE_DEF = 8
    SIZE = 9
    FULL = 10
    SUB = 11
    SUB2 = 12
    SYM = 13
    SUBSYM = 14
    COLOR = 15
    COLOR_DEF = 16
    FONT_DEF = 17
    EQN_PREFS = 18
    ENCODING_DEF = 19
    FUTURE = 100
    ROOT = 255

class OptionType:
    # uint8
    MtefOptNudge = 0x08
    MtefOptCharEmbell = 0x01
    MtefOptCharFuncStart = 0x02
    MtefOptCharEncChar8 = 0x04
    MtefOptCharEncChar16 = 0x10
    MtefOptCharEncNoMtcode = 0x20
    MtefOptLineNull = 0x01
    mtefOPT_LP_RULER = 0x02
    MtefOptLineLspace = 0x04
    MtefOptLpRuler = 0x02
    MtefColorCmyk = 0x01
    MtefColorSpot = 0x02
    MtefColorName = 0x04
    mtefCOLOR_CMYK = 0x01
    mtefCOLOR_SPOT = 0x02
    mtefCOLOR_NAME = 0x04

class CharTypeface:
    # uint8
    fnTEXT = 1
    fnFUNCTION = 2
    fnVARIABLE = 3
    fnLCGREEK = 4
    fnUCGREEK = 5
    fnSYMBOL = 6
    fnVECTOR = 7
    fnNUMBER = 8
    fnUSER1 = 9
    fnUSER2 = 10
    fnMTEXTRA = 11
    fnTEXT_FE = 12
    fnEXPAND = 22
    fnMARKER = 23
    fnSPACE = 24

class MtTabStop:
    def __init__(self):
        # next   *MtTabStop
        self.next = None
        # _type  int16
        self._type = 0
        # offset int16
        self.offset = 0

class MtRuler:
    def __init__(self):
        # nStops      int16
        self.nStops = 0
        # tabStopList *MtTabStop
        self.tabStopList = None

class MtLine:
    def __init__(self):
        # nudgeX     int16
        self.nudgeX = 0
        # nudgeY     int16
        self.nudgeY = 0
        # lineSpace  uint8
        self.lineSpace = 0
        # null       bool
        self.null = False
        # ruler      *MtRuler
        self.ruler = None
        # objectList *MtObjList
        self.objectList = None

class MtEmbell:
    def __init__(self):
        # next   *MtEmbell
        self.next = None
        # nudgeX int16
        self.nudgeX = 0
        # nudgeY int16
        self.nudgeY = 0
        # embell uint8
        self.embell = 0

class MtChar:
    def __init__(self):
        # nudgeX   int16
        self.nudgeX = 0
        # nudgeY   int16
        self.nudgeY = 0
        # options  uint8
        self.options = 0
        # typeface uint8
        self.typeface = 0
        # mtcode uint16 //16-bit integer MTCode value
        self.mtcode = 0
        # bits8 uint8 //8-bit font position
        self.bits8 = 0
        # bits16         uint16 //16-bit integer font position
        self.bits16 = 0
        # embellishments *MtEmbell
        self.embellishments = None

class MtEqnPrefs:
    def __init__(self):
        # sizes  []string
        self.sizes = []
        # spaces []string
        self.spaces = []
        # styles []byte
        self.styles = []

class MtSize:
    def __init__(self):
        # lsize uint8
        self.lsize = 0
        # dsize uint8
        self.dsize = 0

class MtfontStyleDef:
    def __init__(self):
        # fontDefIndex uint8
        self.fontDefIndex = 0
        # name         string
        self.name = ''

class MtfontDef:
    def __init__(self):
        # encDefIndex uint8
        self.encDefIndex = 0
        # name        string
        self.name = ''

class MtColorDefIndex:
    def __init__(self):
        # index uint8
        self.index = 0

class MtColorDef:
    def __init__(self):
        # values []uint8
        self.values = []
        # name   string
        self.name = ''

class MtObjList:
    def __init__(self):
        # next   *MtObjList
        self.next = None
        # tag    RecordType
        self.tag = 0
        # objPtr []MtObject
        self.objPtr = []

class MtTmpl:
    def __init__(self):
        # nudgeX     int16
        self.nudgeX = 0
        # nudgeY     int16
        self.nudgeY = 0
        # selector   uint8
        self.selector = 0
        # variation  uint16
        self.variation = 0
        # options    uint8
        self.options = 0
        # objectList *MtObjList
        self.objectList = None

class MtPile:
    def __init__(self):
        # nudgeX int16
        self.nudgeX = 0
        # nudgeY int16
        self.nudgeY = 0
        # halign uint8
        self.halign = 0
        # valign uint8
        self.valign = 0

        # ruler *MtRuler //ruler可以不读，不影响后面字节错位，因为这个是一个完整的额外record数据
        self.ruler = None

        # objectList *MtObjList //objectList可以不读，不影响后面字节错位，因为这个是一个完整的额外record数据
        self.objectList = None

class MtMatrix:
    def __init__(self):
        # nudgeX int16
        self.nudgeX = 0
        # nudgeY int16
        self.nudgeY = 0
        # valign uint8
        self.valign = 0
        # h_just uint8
        self.h_just = 0
        # v_just uint8
        self.v_just = 0

        # rows uint8
        self.rows = 0
        # cols uint8
        self.cols = 0

        # //row_parts uint8
        # //col_parts uint8

        # objectList *MtObjList //objectList可以不读，不影响后面字节错位，因为这个是一个完整的额外record数据
        self.objectList = None

class MtEmbellRd:
    def __init__(self):
        # options    uint8
        self.options = 0
        # nudgeX     int16
        self.nudgeX = 0
        # nudgeY     int16
        self.nudgeY = 0
        # embellType uint8
        self.embellType = 0

class MtAST:
    def __init__(self, tag=0, value=None, children=[]):
        # tag      RecordType
        self.tag = tag
        # value    MtObject
        self.value = value
        # children []*MtAST
        if children:
            self.children = children
        else:
            self.children = []

    def debug(indent):
        """
        func (ast *MtAST) debug(indent int) {
            fmt.Printf("> %#v MtAST %#v\n", indent, ast)
            indent += 1
            for _, ele := range ast.children {
                ele.debug(indent)
            }
        }
        """
        pass

class MtObject:
    def __init__(self):
        pass

# //Template selectors and variations:
class SelectorType:
    # uint8
    # Fences (parentheses, etc.):
    # selector	symbol	description	class
    tmANGLE   = 0 #	angle brackets	ParBoxClass
    tmPAREN   = 1 #	parentheses	ParBoxClass
    tmBRACE   = 2 #	braces (curly brackets)	ParBoxClass
    tmBRACK   = 3 #	square brackets	ParBoxClass
    tmBAR     = 4 #	vertical bars	ParBoxClass
    tmDBAR    = 5 #	double vertical bars	ParBoxClass
    tmFLOOR   = 6 #	floor brackets	ParBoxClass
    tmCEILING = 7 #	ceiling brackets	ParBoxClass
    tmOBRACK  = 8 #	open (white) brackets	ParBoxClass
    # variations	variation bits	symbol	description
    # 0×0001	tvFENCE_L	left fence is present
    # 0×0002	tvFENCE_R	right fence is present

    # Intervals:
    # selector	symbol	description	class
    tmINTERVAL = 9 # unmatched brackets and parentheses	ParBoxClass
    # variations	variation bits	symbol	description
    # 0×0000	tvINTV_LEFT_LP	left fence is left parenthesis
    # 0×0001	tvINTV_LEFT_RP	left fence is right parenthesis
    # 0×0002	tvINTV_LEFT_LB	left fence is left bracket
    # 0×0003	tvINTV_LEFT_RB	left fence is right bracket
    # 0×0000	tvINTV_RIGHT_LP	right fence is left parenthesis
    # 0×0010	tvINTV_RIGHT_RP	right fence is right parenthesis
    # 0×0020	tvINTV_RIGHT_LB	right fence is left bracket
    # 0×0030	tvINTV_RIGHT_RB	right fence is right bracket

    # Radicals (square and nth roots):
    # selector	symbol	description	class
    tmROOT = 10 # radical	RootBoxClass
    # variations	variation	symbol	description
    # 0	tvROOT_SQ	square root
    # 1	tvROOT_NTH	nth root

    # Fractions:
    # selector	symbol	description	class
    tmFRACT = 11 # fractions
    # variations	variation bits	symbol	description
    # 0×0001	tvFR_SMALL	subscript-size slots (piece fraction)
    # 0×0002	tvFR_SLASH	fraction bar is a slash
    # 0×0004	tvFR_BASE	num. and denom. are baseline aligned

    # Over and Underbars:
    # selector	symbol	description	class
    tmUBAR = 12 # underbar	BarBoxClass
    tmOBAR = 13 # overbar	BarBoxClass
    # variations	variation bits	symbol	description
    # 0×0001	tvBAR_DOUBLE	bar is doubled, else single

    # Arrows:
    # selector	symbol	description	class
    tmARROW = 14 # arrow	ArroBoxClass
    # variations	variation	symbol	description
    # 0×0000	tvAR_SINGLE	single arrow
    # 0×0001	tvAR_DOUBLE	double arrow
    # 0×0002	tvAR_HARPOON	harpoon
    # 0×0004	tvAR_TOP	top slot is present
    # 0×0008	tvAR_BOTTOM	bottom slot is present
    # 0×0010	tvAR_LEFT	if single, arrow points left
    # 0×0020	tvAR_RIGHT	if single, arrow points right
    # 0×0010	tvAR_LOS	if double or harpoon, large over small
    # 0×0020	tvAR_SOL	if double or harpoon, small over large

    # Integrals (see Limit Variations):
    # selector	symbol	description	class
    tmINTEG = 15 # integral	BigOpBoxClass
    # variations	variation	symbol	description
    # 0×0001	tvINT_1	single integral sign
    # 0×0002	tvINT_2	double integral sign
    # 0×0003	tvINT_3	triple integral sign
    # 0×0004	tvINT_LOOP	has loop w/o arrows
    # 0×0008	tvINT_CW_LOOP	has clockwise loop
    # 0×000C	tvINT_CCW_LOOP	has counter-clockwise loop
    # 0×0100	tvINT_EXPAND	integral signs expand

    # Sums, products, coproducts, unions, intersections, etc. (see Limit Variations):
    # selector	symbol	description	class
    tmSUM    = 16 # sum	BigOpBoxClass
    tmPROD   = 17 # product	BigOpBoxClass
    tmCOPROD = 18 # coproduct	BigOpBoxClass
    tmUNION  = 19 # union	BigOpBoxClass
    tmINTER  = 20 # intersection	BigOpBoxClass
    tmINTOP  = 21 # integral-style big operator	BigOpBoxClass
    tmSUMOP  = 22 # summation-style big operator	BigOpBoxClass

    # Limits (see Limit Variations):
    # selector	symbol	description	class
    tmLIM = 23 # limits	LimBoxClass
    # variations	variation	symbol	description
    # 0	tvSUBAR	single underbar
    # 1	tvDUBAR	double underbar

    # Horizontal braces and brackets:
    # selector	symbol	description	class
    tmHBRACE = 24 # horizontal brace	HFenceBoxClass
    tmHBRACK = 25 # horizontal bracket	HFenceBoxClass
    # variations	variation	symbol	description
    # 0×0001	tvHB_TOP	slot is on the top, else on the bottom

    # Long division:
    # selector	symbol	description	class
    tmLDIV = 26 # long division	LDivBoxClass
    # variations	variation	symbol	description
    # 0×0001	tvLD_UPPER	upper slot is present

    # Subscripts and superscripts:
    # selector	symbol	description	class
    tmSUB    = 27 # subscript	ScrBoxClass
    tmSUP    = 28 # superscript	ScrBoxClass
    tmSUBSUP = 29 # subscript and superscript	ScrBoxClass
    # variations	variation	symbol	description
    # 0×0001	tvSU_PRECEDES	script precedes scripted item,

    # else follows
    # Dirac bra-ket notation:
    # selector	symbol	description	class
    tmDIRAC = 30 # bra-ket notation	DiracBoxClass
    # variations	variation	symbol	description
    # 0×0001	tvDI_LEFT	left part is present
    # 0×0002	tvDI_RIGHT	right part is present

    # Vectors:
    # selector	symbol	description	class
    tmVEC = 31 # vector	HatBoxClass
    # variations	variation	symbol	description
    # 0×0001	tvVE_LEFT	arrow points left
    # 0×0002	tvVE_RIGHT	arrow points right
    # 0×0004	tvVE_UNDER	arrow under slot, else over slot
    # 0×0008	tvVE_HARPOON	harpoon

    # Hats, arcs, tilde, joint status:
    # selector	symbol	description	class
    tmTILDE   = 32 # tilde over characters	HatBoxClass
    tmHAT     = 33 # hat over characters	HatBoxClass
    tmARC     = 34 # arc over characters	HatBoxClass
    tmJSTATUS = 35 # joint status construct	HatBoxClass

    # Overstrikes (cross-outs):
    # selector	symbol	description	class
    tmSTRIKE = 36 # overstrike (cross-out)	StrikeBoxClass
    #variations	variation	symbol	description
    # 0×0001	tvST_HORIZ	line is horizontal, else slashes
    # 0×0002	tvST_UP	if slashes, slash from lower-left to upper-right is present
    # 0×0004	tvST_DOWN	if slashes, slash from upper-left to lower-right is present

    # Boxes:
    # selector	symbol	description	class
    tmBOX = 37 # box	TBoxBoxClass
    # variations	variation	symbol	description
    # 0×0001	tvBX_ROUND	corners are round, else square
    # 0×0002	tvBX_LEFT	left side is present
    # 0×0004	tvBX_RIGHT	right side is present
    # 0×0008	tvBX_TOP	top side is present
    # 0×0010	tvBX_BOTTOM	bottom side is present


class EmbellType:
    # uint8
    emb1DOT      = 2
    emb2DOT      = 3
    emb3DOT      = 4
    emb1PRIME    = 5
    emb2PRIME    = 6
    embBPRIME    = 7
    embTILDE     = 8
    embHAT       = 9
    embNOT       = 10
    embRARROW    = 11
    embLARROW    = 12
    embBARROW    = 13
    embR1ARROW   = 14
    embL1ARROW   = 15
    embMBAR      = 16
    embOBAR      = 17
    emb3PRIME    = 18
    embFROWN     = 19
    embSMILE     = 20
    embX_BARS    = 21
    embUP_BAR    = 22
    embDOWN_BAR  = 23
    emb4DOT      = 24
    embU_1DOT    = 25
    embU_2DOT    = 26
    embU_3DOT    = 27
    embU_4DOT    = 28
    embU_BAR     = 29
    embU_TILDE   = 30
    embU_FROWN   = 31
    embU_SMILE   = 32
    embU_RARROW  = 33
    embU_LARROW  = 34
    embU_BARROW  = 35
    embU_R1ARROW = 36
    embU_L1ARROW = 37
