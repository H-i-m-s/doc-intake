from io import BytesIO
import sys

# 尝试相对导入，如果失败则使用绝对导入
try:
    from .ole_util.helper import Helper
    from .ole_util.ole import Ole
    from .record import MtLine, MtChar, MtTmpl, MtPile, MtMatrix, MtEmbellRd, MtfontStyleDef, MtSize, MtfontDef, MtColorDefIndex, MtColorDef, MtEqnPrefs, RecordType, OptionType, CharTypeface, SelectorType, EmbellType, MtAST
    from .chars import Chars, SpecialChar
except ImportError:
    from ole_util.helper import Helper
    from ole_util.ole import Ole
    from record import MtLine, MtChar, MtTmpl, MtPile, MtMatrix, MtEmbellRd, MtfontStyleDef, MtSize, MtfontDef, MtColorDefIndex, MtColorDef, MtEqnPrefs, RecordType, OptionType, CharTypeface, SelectorType, EmbellType, MtAST
    from chars import Chars, SpecialChar

oleCbHdr = 28

# MTEFV5
class MTEF:
    def __init__(self):
        # mMtefVer     uint8
        self.mMtefVer = 0
        # mPlatform    uint8
        self.mPlatform = 0
        # mProduct     uint8
        self.mProduct = 0
        # mVersion     uint8
        self.mVersion = 0
        # mVersionSub  uint8
        self.mVersionSub = 0
        # mApplication string
        self.mApplication = ''
        # mInline      uint8
        self.mInline = 0

        # reader io.ReadSeeker
        self.reader = None

        # ast   *MtAST
        self.ast = None
        # nodes []*MtAST
        self.nodes = []

        # Valid bool //是否合法，顺利解析
        self.Valid = False

    def readRecord(self):
        """
        读取body的每一行数据并保存到数组里
        """
        # 默认设置为合法的，除非遇到不可解析数据
        self.Valid = True

        # Header
        self.mMtefVer = Helper.bytes2int(self.reader.read(1)) # uint8
        self.mPlatform = Helper.bytes2int(self.reader.read(1)) # uint8
        self.mProduct = Helper.bytes2int(self.reader.read(1)) # uint8
        self.mVersion = Helper.bytes2int(self.reader.read(1)) # uint8
        self.mVersionSub = Helper.bytes2int(self.reader.read(1)) # uint8
        self.mApplication, _ = self.readNullTerminatedString()
        self.mInline = Helper.bytes2int(self.reader.read(1)) # uint8

        print('(DEBUG)MTEF.readRecord.mMtefVer:', self.mMtefVer)
        print('(DEBUG)MTEF.readRecord.mPlatform:', self.mPlatform)
        print('(DEBUG)MTEF.readRecord.mProduct:', self.mProduct)
        print('(DEBUG)MTEF.readRecord.mVersion:', self.mVersion)
        print('(DEBUG)MTEF.readRecord.mVersionSub:', self.mVersionSub)
        print('(DEBUG)MTEF.readRecord.mApplication:', self.mApplication)
        print('(DEBUG)MTEF.readRecord.mInline:', self.mInline)

        # Body
        while True:
            err = None
            record = RecordType.END
            read_data = None
            read_data = self.reader.read(1)
            if read_data is None or len(read_data) != 1:
                err = 'MEFT.readRecord: read byte error'
            record = Helper.bytes2int(read_data) # uint8

            # 根据future定义，>=100的后面会跟一个字节，这个字节代表需要跳过的长度
            # For now, readers can assume that an unsigned integer follows the record type and is the number of bytes following it in the record
            # This makes it easy for software that reads MTEF to skip these records.
            if record >= RecordType.FUTURE:
                skipFutureLength = Helper.bytes2int(self.reader.read(1)) # uint8
                self.reader.seek(skipFutureLength, 1) # io.SeekCurrent
                continue

            # debug 使用
            # print('(DEBUG)MTEF.readRecord.while.record:', record)

            if err is not None:
                break

            if record == RecordType.END:
                self.nodes.append(MtAST(RecordType.END, None, None))
            elif record == RecordType.LINE:
                line = MtLine()
                self.readLine(line)

                self.nodes.append(MtAST(RecordType.LINE, line, None))
            elif record == RecordType.CHAR:
                char = MtChar()
                self.readChar(char)

                self.nodes.append(MtAST(RecordType.CHAR, char, None))
            elif record == RecordType.TMPL:
                tmpl = MtTmpl()
                self.readTMPL(tmpl)

                self.nodes.append(MtAST(RecordType.TMPL, tmpl, None))
            elif record == RecordType.PILE:
                pile = MtPile()
                self.readPile(pile)

                self.nodes.append(MtAST(RecordType.PILE, pile, None))
            elif record == RecordType.MATRIX:
                matrix = MtMatrix()
                self.readMatrix(matrix)

                self.nodes.append(MtAST(RecordType.MATRIX, matrix, None))

                # 匹配矩阵数据下面的2个nil
                self.nodes.append(MtAST(RecordType.LINE, MtLine(), None))
                self.nodes.append(MtAST(RecordType.LINE, MtLine(), None))
            elif record == RecordType.EMBELL:
                embell = MtEmbellRd()
                self.readEmbell(embell)

                self.nodes.append(MtAST(RecordType.EMBELL, embell, None))
            elif record == RecordType.FONT_STYLE_DEF:
                fsDef = MtfontStyleDef()
                fsDef.fontDefIndex = Helper.bytes2int(self.reader.read(1)) # uint8
                fsDef.name, _ = self.readNullTerminatedString()

                # 读取字节，但是不关心数据，注释
                # m.nodes = append(m.nodes, &MtAST{FONT_STYLE_DEF, fsDef, nil})
            elif record == RecordType.SIZE:
                mtSize = MtSize()
                mtSize.lsize = Helper.bytes2int(self.reader.read(1)) # uint8
                mtSize.dsize = Helper.bytes2int(self.reader.read(1)) # uint8
            elif record == RecordType.SUB:
                self.nodes.append(MtAST(RecordType.SUB, None, None))
            elif record == RecordType.SUB2:
                self.nodes.append(MtAST(RecordType.SUB2, None, None))
            elif record == RecordType.SYM:
                self.nodes.append(MtAST(RecordType.SYM, None, None))
            elif record == RecordType.SUBSYM:
                self.nodes.append(MtAST(RecordType.SUBSYM, None, None))
            elif record == RecordType.FONT_DEF:
                fdef = MtfontDef()
                fdef.encDefIndex = Helper.bytes2int(self.reader.read(1)) # uint8
                fdef.name, _ = self.readNullTerminatedString()

                self.nodes.append(MtAST(RecordType.FONT_DEF, fdef, None))
            elif record == RecordType.COLOR:
                cIndex = MtColorDefIndex()
                cIndex.index = Helper.bytes2int(self.reader.read(1)) # uint8

                # 读取字节，但是不关心数据，注释
                # m.nodes = append(m.nodes, &MtAST{tag: COLOR, value: cIndex, children: nil})
            elif record == RecordType.COLOR_DEF:
                cDef = MtColorDef()
                self.readColorDef(cDef)

                # 读取字节，但是不关心数据，注释
                # m.nodes = append(m.nodes, &MtAST{tag: COLOR_DEF, value: cDef, children: nil})
            elif record == RecordType.FULL:
                self.nodes.append(MtAST(RecordType.FULL, None, None))
            elif record == RecordType.EQN_PREFS:
                prefs = MtEqnPrefs()
                self.readEqnPrefs(prefs)

                self.nodes.append(MtAST(RecordType.EQN_PREFS, prefs, None))
            elif record == RecordType.ENCODING_DEF:
                enc, _ = self.readNullTerminatedString()

                self.nodes.append(MtAST(RecordType.ENCODING_DEF, enc, None))
            else:
                self.Valid = False
                print('MTEF.readRecord:FUTURE RECORD:', record)

        return None

    def readNullTerminatedString(self):
        buf = []
        err = None
        while True:
            p = self.reader.read(1)
            if len(p) != 1:
                err = 'MTEF.readNullTerminatedString.error: read byte error'
            if p[0] == 0:
                break
            buf.append(p)
        return b''.join(buf), err

    def readLine(self, line):
        options = 0 # OptionType
        err = None
        read_data = self.reader.read(1) # uint8
        if read_data is None or len(read_data) != 1:
            err = 'MTEF.readLine: read byte error'
        options = Helper.bytes2int(read_data)

        if OptionType.MtefOptNudge == OptionType.MtefOptNudge&options:
            line.nudgeX, line.nudgeY, _ = self.readNudge()

        if OptionType.MtefOptLineLspace == OptionType.MtefOptLineLspace&options:
            line.lineSpace = Helper.bytes2int(self.reader.read(1)) # uint8

        # RULER解析
        if OptionType.mtefOPT_LP_RULER == OptionType.mtefOPT_LP_RULER&options:
            # var nStops uint8
            nStops = Helper.bytes2int(self.reader.read(1)) # uint8 

            # var tabList []uint8
            tabList = []
            for i in range(nStops):
                stopVal = Helper.bytes2int(self.reader.read(1)) # uint8
                tabList.append(stopVal)

                tabOffset =  Helper.bytes2int(self.reader.read(2)) # uint16

        if OptionType.MtefOptLineNull == OptionType.MtefOptLineNull&options:
            line.null = True

        return err

    def readDimensionArrays(self, size):
        shareData = {
            'flag': True,
            'tmpStr': '',
            'count': 0, # int64
            'array': []
        }

        def fx(x):
            # x uint8
            if shareData['flag']:
                if x == 0x00:
                    shareData['flag'] = False
                    shareData['tmpStr'] += 'in'
                elif x == 0x01:
                    shareData['flag'] = False
                    shareData['tmpStr'] += 'cm'
                elif x == 0x02:
                    shareData['flag'] = False
                    shareData['tmpStr'] += 'pt'
                elif x == 0x03:
                    shareData['flag'] = False
                    shareData['tmpStr'] += 'pc'
                elif x == 0x04:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '%'
                else:
                    print('MTEF.readDimensionArrays.error: invalid bytes')
            else:
                if x == 0x00:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '0'
                elif x == 0x01:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '1'
                elif x == 0x02:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '2'
                elif x == 0x03:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '3'
                elif x == 0x04:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '4'
                elif x == 0x05:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '5'
                elif x == 0x06:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '6'
                elif x == 0x07:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '7'
                elif x == 0x08:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '8'
                elif x == 0x09:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '9'
                elif x == 0x0a:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '.'
                elif x == 0x0b:
                    shareData['flag'] = False
                    shareData['tmpStr'] += '-'
                elif x == 0x0f:
                    shareData['flag'] = True
                    shareData['count'] += 1
                    shareData['array'].append(shareData['tmpStr'])
                    shareData['tmpStr'] = ''
                else:
                    print('MTEF.readDimensionArrays.error: invalid bytes')

        while True:
            if shareData['count'] >= size:
                print('(DEBUG)MTEF.readDimensionArrays:break with size=', size)
                break

            ch = 0 # uint8
            ch =  Helper.bytes2int(self.reader.read(1))

            # print('(DEBUG)MTEF.readDimensionArrays.ch:', ch)

            hi = (ch & 0xf0) / 16
            lo = ch & 0x0f
            fx(hi)
            fx(lo)
            
        return shareData['array'], None

    def readEqnPrefs(self, eqnPrefs):
        options = 0 # OptionType
        options = Helper.bytes2int(self.reader.read(1))

        # sizes
        size = 0 # uint8
        size = Helper.bytes2int(self.reader.read(1))
        eqnPrefs.sizes, _ = self.readDimensionArrays(size)

        # spaces
        size = 0
        size = Helper.bytes2int(self.reader.read(1))
        eqnPrefs.spaces, _ = self.readDimensionArrays(size)

        # styles
        size = 0
        size = Helper.bytes2int(self.reader.read(1))
        styles = [] # byte
        for _ in range(size):
            c = 0 # uint8
            c = Helper.bytes2int(self.reader.read(1))
            if c == 0:
                styles.append(0)
            else:
                c = Helper.bytes2int(self.reader.read(1))
                styles.append(c)
        eqnPrefs.styles = styles
        return None

    def readChar(self, char):
        options = 0 # OptionType
        options = Helper.bytes2int(self.reader.read(1))

        if OptionType.MtefOptNudge == OptionType.MtefOptNudge&options:
            char.nudgeX, char.nudgeY, _ = self.readNudge()

        char.typeface = Helper.bytes2int(self.reader.read(1)) # uint8

        if OptionType.MtefOptCharEncNoMtcode != OptionType.MtefOptCharEncNoMtcode&options:
            char.mtcode = Helper.bytes2int(self.reader.read(2)) # uint16

        if OptionType.MtefOptCharEncChar8 == OptionType.MtefOptCharEncChar8&options:
            # todo 强行设置值，有BUG。。。。。
            # if char.mtcode >= 34528 {
            #    _ = binary.Read(m.reader, binary.LittleEndian, &char.bits16)
            #}else {
            char.bits8 = Helper.bytes2int(self.reader.read(1)) # uint8
            #}
        if OptionType.MtefOptCharEncChar16 == OptionType.MtefOptCharEncChar16&options:
            char.bits16 = Helper.bytes2int(self.reader.read(2)) # uint16

        # print('(DEBUG)MTEF.readChar.char:', {
        #     'nudgeX': char.nudgeX,
        #     'nudgeY': char.nudgeY,
        #     'options': char.options,
        #     'typeface': char.typeface,
        #     'mtcode': char.mtcode,
        #     'bits8': char.bits8,
        #     'bits16': char.bits16,
        #     'embellishments': char.embellishments,
        # })

        return None

    def readNudge(self):
        b1 = Helper.bytes2int(self.reader.read(2)) # 类型有待确认
        b2 = Helper.bytes2int(self.reader.read(2))

        err = None
        if b1 == 128 or b2 == 128:
            nudgeX = Helper.bytes2int(self.reader.read(2)) # int16
            nudgeY = Helper.bytes2int(self.reader.read(2)) # int16
            return nudgeX, nudgeY, err
        else:
            nudgeX = b1
            nudgeY = b2
            return nudgeX, nudgeY, err

    def readTMPL(self, tmpl):
        options = 0 # OptionType
        options = Helper.bytes2int(self.reader.read(1))

        if OptionType.MtefOptNudge == OptionType.MtefOptNudge&options:
            tmpl.nudgeX, tmpl.nudgeY, _ = self.readNudge()

        tmpl.selector = Helper.bytes2int(self.reader.read(1)) # uint8

        # variation, 1 or 2 bytes
        byte1 = 0 # uint8
        byte1 = Helper.bytes2int(self.reader.read(1))
        if 0x80 == byte1&0x80:
            byte2 = 0 # uint8
            byte2 = Helper.bytes2int(self.reader.read(1))
            # tmpl.variation = (uint16(byte1) & 0x7F) | (uint16(byte2) << 8)
            tmpl.variation = (byte1 & 0x7F) | (byte2 << 8)
        else:
            tmpl.variation = byte1
        tmpl.options = Helper.bytes2int(self.reader.read(1)) # uint8
        return None

    def readPile(self, pile):
        options = 0 # OptionType
        options = Helper.bytes2int(self.reader.read(1))

        if OptionType.MtefOptNudge == OptionType.MtefOptNudge&options:
            pile.nudgeX, pile.nudgeY, _ = self.readNudge()

        # 读取halign和valign
        pile.halign = Helper.bytes2int(self.reader.read(1)) # uint8
        pile.valign = Helper.bytes2int(self.reader.read(1)) # uint8

        return None

    def readMatrix(self, matrix):
        options = 0 # OptionType
        options = Helper.bytes2int(self.reader.read(1))

        if OptionType.MtefOptNudge == OptionType.MtefOptNudge&options:
            matrix.nudgeX, matrix.nudgeY, _ = self.readNudge()

        # 读取valign和h_just、v_just
        matrix.valign = Helper.bytes2int(self.reader.read(1)) # uint8
        matrix.h_just = Helper.bytes2int(self.reader.read(1)) # uint8
        matrix.v_just = Helper.bytes2int(self.reader.read(1)) # uint8

        # 读取rows和cols
        matrix.rows = Helper.bytes2int(self.reader.read(1)) # uint8
        matrix.cols = Helper.bytes2int(self.reader.read(1)) # uint8

        # print('(DEBUG)MTEF.readMatrix.matrix:', matrix)
        return None

    def readEmbell(self, embell):
        options = 0 # OptionType
        options = Helper.bytes2int(self.reader.read(1))

        if OptionType.MtefOptNudge == OptionType.MtefOptNudge&options:
            embell.nudgeX, embell.nudgeY, _ = self.readNudge()

        # 读取embellishment type
        embell.embellType = Helper.bytes2int(self.reader.read(1)) # uint8

        return None

    def readColorDef(self, colorDef):
        options = 0 # OptionType
        options = Helper.bytes2int(self.reader.read(1))

        color = 0 # uint16
        if OptionType.mtefCOLOR_CMYK == OptionType.mtefCOLOR_CMYK&options:
            # CMYK，读4个值
            for _ in range(4):
                color = Helper.bytes2int(self.reader.read(2))
                colorDef.values.append(color)
        else:
            # RGB，读3个值
            for _ in range(3):
                color = Helper.bytes2int(self.reader.read(2))
                colorDef.values.append(color)

        if OptionType.mtefCOLOR_NAME == OptionType.mtefCOLOR_NAME&options:
            colorDef.name, _ = self.readNullTerminatedString()

        return None

    def Translate(self):
        latexStr, err = self.makeLatex(self.ast)
        if err is not None:
            print('MTEF.Translate.err:', err)

        if self.Valid:
            return latexStr
        else:
            return ''

    def makeAST(self):
        """
        根据数组生成出栈入栈结构
        """
        ast = MtAST()
        ast.tag = 0xff
        ast.value = None
        self.ast = ast

        stack = []
        stack.append(ast)

        for node in self.nodes:
            # debug 可用
            # print("(DEBUG)MTEF.makeAST:node.tag:", node.tag, "node.value:", node.value)

            if node.tag == RecordType.LINE:
                if len(stack):
                    parent = stack[len(stack)-1]
                    if not parent.children:
                        parent.children = []
                    parent.children.append(node)
                if not node.value.null:
                    # 如果与0 <nil> 匹配，则需要入栈
                    stack.append(node)
            if node.tag == RecordType.TMPL:
                if len(stack):
                    parent = stack[len(stack)-1]
                    if not parent.children:
                        parent.children = []
                    parent.children.append(node)

                # 如果与0 <nil> 匹配，则需要入栈
                stack.append(node)
            if node.tag == RecordType.PILE:
                if len(stack):
                    parent = stack[len(stack)-1]
                    if not parent.children:
                        parent.children = []
                    parent.children.append(node)

                # 如果与0 <nil> 匹配，则需要入栈
                stack.append(node)
            if node.tag == RecordType.MATRIX:
                if len(stack):
                    parent = stack[len(stack)-1]
                    if not parent.children:
                        parent.children = []
                    parent.children.append(node)

                # 如果与0 <nil> 匹配，则需要入栈
                stack.append(node)
            if node.tag == RecordType.END:
                if len(stack):
                    ele = stack[len(stack)-1]
                    stack.remove(ele)
            if node.tag == RecordType.CHAR:
                if len(stack):
                    parent = stack[len(stack)-1]
                    if not parent.children:
                        parent.children = []
                    parent.children.append(node)
                else:
                    # never go there
                    ast.children.append(node)
            if node.tag == RecordType.EMBELL:
                if len(stack):
                    # 读取父节点
                    parent = stack[len(stack)-1]
                    if not parent.children:
                        parent.children = []
                    parent.children.append(node)

                    # 数据结构中，这些数据是在字符后面，但是在latex展示中某些字符需要在字符前面
                    # 比如： $$ \hat y $$
                    # 所以我们需要交换最后2位
                    embellType = node.value.embellType
                    if embellType == EmbellType.emb1DOT or embellType == EmbellType.embHAT or embellType == EmbellType.embOBAR:
                        if len(parent.children) >= 2:
                            embellData = parent.children[len(parent.children)-1]
                            charData = parent.children[len(parent.children)-2]
                            parent.children = parent.children[:len(parent.children)-2]

                            parent.children.append(embellData)
                            parent.children.append(charData)

                # 如果与0 <nil> 匹配，则需要入栈
                stack.append(node)

                # case COLOR_DEF:
                #	/*
                #	这个数据结构有3或4个（RGB或者CMYK）对应的nil，所以需要循环把每个值都push到栈里面
                # 
                #	16 &{values:[0 0 0] name:}
                #	0 <nil>
                #	0 <nil>
                #	0 <nil>
                #	 */
                # 
                #	colorList := node.value.(*MtColorDef).values
                #	if len(colorList) > 0 {
                #		//读取每个color的值，然后入栈
                #		for _, val := range colorList {
                #			//如果与0 <nil> 匹配，则需要入栈
                #			stack.PushBack(val)
                #		}
                #	}
                # case FONT_STYLE_DEF:
                #	/*
                #	这个数据结构如下，所以需要配对6个入栈
                #	8 &{fontDefIndex:1 name:}
                #	0 <nil>
                #	0 <nil>
                #	0 <nil>
                #	0 <nil>
                #	0 <nil>
                #	0 <nil>
                #	*/
                # 
                #	fontIndex := node.value.(*MtfontStyleDef).fontDefIndex
                #	if fontIndex == 1 {
                #		for i := 0; i < 6; i++ {
                #			//如果与0 <nil> 匹配，则需要入栈
                #			stack.PushBack(0)
                #		}
                #	}

        # m.ast.debug(0)
        return None

    def makeLatex(self, ast):
        """
        根据出栈入栈结构生成latex字符串
        """

        buf = ''

        if ast.tag == RecordType.ROOT:
            buf += '$ '
            for _ast in ast.children:
                _latex, _ = self.makeLatex(_ast)
                buf += _latex
            buf += ' $'
            return buf, None
        elif ast.tag == RecordType.CHAR:
            mtcode = ast.value.mtcode
            typeface = ast.value.typeface
            char = chr(mtcode)

            # 生成char的一些特殊集
            hexExtend = ''
            typefaceFmt = ''
            if typeface-128 == CharTypeface.fnMTEXTRA:
                hexExtend = '/mathmode'
            elif typeface-128 == CharTypeface.fnSPACE:
                hexExtend = '/mathmode'
            elif typeface-128 == CharTypeface.fnTEXT:
                typefaceFmt = '{ \\rm{ %s } }'

            # 生成扩展字符的key
            # hexCode := fmt.Sprintf("%04x", mtcode)
            hexCode = '%04x' % mtcode
            # hexKey := fmt.Sprintf("char/0x%s%s", hexCode, hexExtend)
            hexKey = 'char/0x%s%s' % (hexCode, hexExtend)

            # fmt.Println(char, hexKey)

            # 首先去找扩展字符
            sChar = Chars.get(hexKey)
            if sChar:
                char = sChar
            else:
                # 如果char是特殊symbol，需要转义
                sChar = SpecialChar.get(char)
                if sChar:
                    char = sChar

            # 确定字符是否为文本，如果是文本，则需要包一层
            if typefaceFmt != '':
                char = typefaceFmt % char

            buf += char
            return buf, None
        elif ast.tag == RecordType.TMPL:
            # 强制类型转换为MtTmpl
            tmpl = ast.value

            if tmpl.selector == SelectorType.tmANGLE:
                mainAST = ast.children[0]
                leftAST = ast.children[1]
                rightAST = ast.children[2]

                mainSlot, _ = self.makeLatex(mainAST)
                leftSlot, _ = self.makeLatex(leftAST)
                rightSlot, _ = self.makeLatex(rightAST)

                # 转成latex代码
                mainStr = ''
                leftStr = ''
                rightStr = ''
                if mainSlot != '':
                    mainStr = '{ %s }' % mainSlot
                if leftSlot != '':
                    leftStr = '\\left %s' % leftSlot
                if rightSlot != '':
                    rightStr = '\\right %s' % rightSlot

                buf += '%s %s %s' % (leftStr, mainStr, rightStr)

                return buf, None
            elif tmpl.selector == SelectorType.tmPAREN:
                mainAST = ast.children[0]
                leftAST = ast.children[1]
                rightAST = ast.children[2]

                mainSlot, _ = self.makeLatex(mainAST)
                leftSlot, _ = self.makeLatex(leftAST)
                rightSlot, _ = self.makeLatex(rightAST)

                # 转成latex代码
                mainStr = ''
                leftStr = ''
                rightStr = ''
                if mainSlot != '':
                    mainStr = '{ %s }' % mainSlot
                if leftSlot != '':
                    leftStr = '\\left %s' % leftSlot
                if rightSlot != '':
                    rightStr = '\\right %s' % rightSlot

                buf += '%s %s %s' % (leftStr, mainStr, rightStr)
                return buf, None
            elif tmpl.selector == SelectorType.tmBRACE:
                mainSlot = ''
                leftSlot = ''
                rightSlot = ''
                idx = 0
                for astData in ast.children:
                    if idx == 0:
                        mainSlot, _ = self.makeLatex(astData)
                    elif idx == 1:
                        leftSlot, _ = self.makeLatex(astData)
                    else:
                        rightSlot, _ = self.makeLatex(astData)
                    idx += 1

                if rightSlot == '':
                    rightSlot = '.'
                else:
                    rightSlot = ' ' + rightSlot

                # 组装公式
                buf += '\\left %s \\begin{array}{l} %s \\end{array} \\right%s' % (leftSlot, mainSlot, rightSlot)

                return buf, None
            elif tmpl.selector == SelectorType.tmBRACK:
                mainAST = ast.children[0]
                leftAST = ast.children[1]
                rightAST = ast.children[2]
                mainSlot, _ = self.makeLatex(mainAST)
                if mainSlot == '':
                    mainSlot = '\\space'
                leftSlot, _ = self.makeLatex(leftAST)
                rightSlot, _ = self.makeLatex(rightAST)
                buf += '\\left%s %s \\right%s' % (leftSlot, mainSlot, rightSlot)
                return buf, None
            elif tmpl.selector == SelectorType.tmBAR:
                # 读取数据 ParBoxClass
                mainSlot = ''
                leftSlot = ''
                rightSlot = ''
                idx = 0
                for astData in ast.children:
                    if idx == 0:
                        mainSlot, _ = self.makeLatex(astData)
                    elif idx == 1:
                        leftSlot, _ = self.makeLatex(astData)
                    else:
                        rightSlot, _ = self.makeLatex(astData)
                    idx += 1

                if rightSlot == '':
                    rightSlot = '.'
                else:
                    rightSlot = ' ' + rightSlot

                # 转成latex代码
                mainStr = ''
                leftStr = ''
                rightStr = ''
                if mainSlot != '':
                    mainStr = '{ %s }' % mainSlot
                if leftSlot != '':
                    leftStr = '\\left %s' % leftSlot
                if rightSlot != '':
                    rightStr = '\\right %s' % rightSlot

                # 组成整体公式
                tmplStr = '%s %s %s' % (leftStr, mainStr, rightStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmINTERVAL:
                # 读取数据 ParBoxClass
                mainAST = ast.children[0]
                leftAST = ast.children[1]
                rightAST = ast.children[2]

                # 读取latex数据
                mainSlot, _ = self.makeLatex(mainAST)
                leftSlot, _ = self.makeLatex(leftAST)
                rightSlot, _ = self.makeLatex(rightAST)

                # 转成latex代码
                mainStr = ''
                leftStr = ''
                rightStr = ''
                if mainSlot != '':
                    mainStr = '{ %s }' % mainSlot
                if leftSlot != '':
                    leftStr = '\\left %s' % leftSlot
                if rightSlot != '':
                    rightStr = '\\right %s' % rightSlot

                # 组成整体公式
                tmplStr = '%s %s %s' % (leftStr, mainStr, rightStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmROOT:
                mainAST = ast.children[0]
                radiAST = ast.children[1]
                mainSlot, _ = self.makeLatex(mainAST)
                radiSlot, _ = self.makeLatex(radiAST)
                buf += '\\sqrt[%s] { %s }' % (radiSlot, mainSlot)
                return buf, None
            elif tmpl.selector == SelectorType.tmFRACT:
                numAST = ast.children[0]
                denAST = ast.children[1]
                numSlot, _ = self.makeLatex(numAST)
                denSlot, _ = self.makeLatex(denAST)
                buf += '\\frac { %s } { %s }' % (numSlot, denSlot)
                return buf, None
            elif tmpl.selector == SelectorType.tmARROW:
                """
                    variation	symbol	description
                    0×0000	tvAR_SINGLE	single arrow
                    0×0001	tvAR_DOUBLE	double arrow
                    0×0002	tvAR_HARPOON	harpoon
                    0×0004	tvAR_TOP	top slot is present
                    0×0008	tvAR_BOTTOM	bottom slot is present
                    0×0010	tvAR_LEFT	if single, arrow points left
                    0×0020	tvAR_RIGHT	if single, arrow points right
                    0×0010	tvAR_LOS	if double or harpoon, large over small
                    0×0020	tvAR_SOL	if double or harpoon, small over large
                """
                topAST = ast.children[0]
                bottomAST = ast.children[1]

                # 读取latex数据
                topSlot, _ = self.makeLatex(topAST)
                bottomSlot, _ = self.makeLatex(bottomAST)

                # 转成latex代码
                topStr = ''
                bottomStr = ''
                if topSlot != '':
                    topStr = '{\\mathrm{ %s }}' % topSlot
                if bottomSlot != '':
                    bottomStr = '[\\mathrm{ %s }]' % bottomSlot

                """
                    variation转码
                """
                variationsMap = {} # map[uint16]string
                variationsMap[0x0000] = "single"
                variationsMap[0x0001] = "double"
                variationsMap[0x0002] = "harpoon"
                variationsMap[0x0004] = "topSlotPresent"
                variationsMap[0x0008] = "bottomSlotPresent"
                variationsMap[0x0010] = "pointLeft"
                variationsMap[0x0020] = "pointRight"

                # 有序循环
                variationsCode = [0x0000, 0x0001, 0x0002, 0x0004, 0x0008, 0x0010, 0x0020] # []uint16{0x0000, 0x0001, 0x0002, 0x0004, 0x0008, 0x0010, 0x0020}

                arrowStyle = "single"
                latexFmt = "\\x"
                for vCode in variationsCode:
                    # 如果存在掩码
                    if vCode&tmpl.variation != 0:
                        # 判断类型，默认是single
                        if variationsMap[vCode] == "double":
                            arrowStyle = "double"
                        elif variationsMap[vCode] == "harpoon":
                            arrowStyle = "harpoon"

                        if arrowStyle == "single" and variationsMap[vCode] == "pointLeft":
                            latexFmt = latexFmt + "leftarrow"
                        elif arrowStyle == "double" and variationsMap[vCode] == "pointLeft":
                            print('MTEF.makeLatex: not implement double , large over small')
                        elif arrowStyle == "harpoon" and variationsMap[vCode] == "pointLeft":
                            print('MTEF.makeLatex: not implement harpoon, large over small')

                        if arrowStyle == "single" and variationsMap[vCode] == "pointRight":
                            latexFmt = latexFmt + "rightarrow"
                        elif arrowStyle == "double" and variationsMap[vCode] == "pointRight":
                            print('MTEF.makeLatex: not implement double , small over large')
                        elif arrowStyle == "harpoon" and variationsMap[vCode] == "pointRight":
                            print('MTEF.makeLatex: not implement harpoon, small over large')
                """
                    variation转码 END
                """

                # 组成整体公式
                tmplStr = "%s %s %s" % (latexFmt, bottomStr, topStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmUBAR:
                # 读取数据
                mainAST = ast.children[0]

                # 读取latex数据
                mainSlot, _ = self.makeLatex(mainAST)

                # 转成latex代码
                mainStr = ''
                if mainSlot != "":
                    mainStr = " {\\underline{ %s }} " % mainSlot

                # 组成整体公式
                tmplStr = " %s " % mainStr
                buf += tmplStr

                # 返回数据
                return buf, None
            elif tmpl.selector == SelectorType.tmSUM:
                # 读取数据 BigOpBoxClass
                mainSlot = ''
                upperSlot = ''
                lowerSlot = ''
                operatorSlot = ''
                idx = 0
                for astData in ast.children:
                    if idx == 0:
                        mainSlot, _ = self.makeLatex(astData)
                    elif idx == 1:
                        lowerSlot, _ = self.makeLatex(astData)
                    elif idx == 2:
                        upperSlot, _ = self.makeLatex(astData)
                    else:
                        operatorSlot, _ = self.makeLatex(astData)
                    idx += 1

                # 转成latex代码
                mainStr = ''
                lowerStr = ''
                upperStr = ''
                if mainSlot != "":
                    mainStr = "{ %s }" % mainSlot
                if lowerSlot != "":
                    lowerStr = "\\limits_{ %s }" % lowerSlot
                if upperSlot != "":
                    upperStr = "^ %s" % upperSlot

                # 组成整体公式
                tmplStr = "%s %s %s %s" % (operatorSlot, lowerStr, upperStr, mainStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmLIM:
                # 读取数据 LimBoxClass
                mainSlot = ''
                lowerSlot = ''
                upperSlot = ''
                idx = 0
                for astData in ast.children:
                    if idx == 0:
                        mainSlot, _ = self.makeLatex(astData)
                    elif idx == 1:
                        lowerSlot, _ = self.makeLatex(astData)
                    else:
                        upperSlot, _ = self.makeLatex(astData)
                    idx += 1

                # 转成latex代码
                mainStr = ''
                lowerStr = ''
                upperStr = ''
                if mainSlot != "":
                    mainStr = "\\mathop { %s }" % mainSlot
                if lowerSlot != "":
                    lowerStr = "\\limits_{ %s }" % lowerSlot
                if upperSlot != "":
                    upperStr = ""

                # 组成整体公式
                tmplStr = "%s %s %s" % (mainStr, lowerStr, upperStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmSUP:
                subAST = ast.children[0]
                supAST = ast.children[1]
                subSlot, _ = self.makeLatex(subAST)
                supSlot, _ = self.makeLatex(supAST)

                buf += " ^ { "
                buf += supSlot
                buf += " } "
                if subSlot != "":
                    buf += " { "
                    buf += subSlot
                    buf += " } "
                return buf, None
            elif tmpl.selector == SelectorType.tmSUB:
                # 读取下标和上标
                subAST = ast.children[0]
                supAST = ast.children[1]

                # 读取latex数据
                subSlot, _ = self.makeLatex(subAST)
                supSlot, _ = self.makeLatex(supAST)

                # 转成latex代码
                subFmt = ''
                supFmt = ''
                if subSlot != "":
                    subFmt = "_{ %s }" % subSlot
                if supSlot != "":
                    supFmt = "^{ %s }" % supSlot

                # 组成整体公式
                tmplStr = "%s  %s" % (subFmt, supFmt)
                buf += tmplStr

                # 返回数据
                return buf, None
            elif tmpl.selector == SelectorType.tmSUBSUP:
                # 读取下标和上标
                subAST = ast.children[0]
                supAST = ast.children[1]

                # 读取latex数据
                subSlot, _ = self.makeLatex(subAST)
                supSlot, _ = self.makeLatex(supAST)

                # 转成latex代码
                subFmt = ''
                supFmt = ''
                if subSlot != "":
                    subFmt = "_{ %s }" % subSlot
                if supSlot != "":
                    supFmt = "^{ %s }" % supSlot

                # 组成整体公式
                tmplStr = "%s  %s" % (subFmt, supFmt)
                buf += tmplStr

                # 返回数据
                return buf, None
            elif tmpl.selector == SelectorType.tmVEC:
                """
                    variations：
                    variation	symbol	description
                    0×0001	tvVE_LEFT	arrow points left
                    0×0002	tvVE_RIGHT	arrow points right
                    0×0004	tvVE_UNDER	arrow under slot, else over slot
                    0×0008	tvVE_HARPOON	harpoon

                    这个转换是通过掩码计算的：
                    比如variation的值是3，即0000 0000 0000 0011

                    对应的是0×0001和0×0002：
                    0000 0000 0000 0001
                    0000 0000 0000 0010
                """

                # 读取数据 HatBoxClass
                mainAST = ast.children[0]

                # 读取latex数据
                mainSlot, _ = self.makeLatex(mainAST)

                # 转成latex代码
                mainStr = ''
                if mainSlot != "":
                    mainStr = "{ %s }" % mainSlot

                """
                    variation转码
                """
                variationsMap = {} # map[uint16]string
                variationsMap[0x0001] = "left"
                variationsMap[0x0002] = "right"
                variationsMap[0x0004] = "tvVE_UNDER"
                variationsMap[0x0008] = "harpoonup"

                # 有序循环
                variationsCode = [0x0001, 0x0002, 0x0004, 0x0008] # []uint16{0x0001, 0x0002, 0x0004, 0x0008}

                topStr = "\\overset\\"
                for vCode in variationsCode:
                    if vCode&tmpl.variation != 0:
                        topStr = topStr + variationsMap[vCode]

                # 如果variationCode小于8，则一定不是harpoon,那么默认就使用arrow
                if tmpl.variation < 8:
                    topStr = topStr + "arrow"
                """
                    variation转码 END
                """

                # 组成整体公式
                tmplStr = "%s %s" % (topStr, mainStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmHAT:
                # 读取数据 HatBoxClass
                mainAST = ast.children[0]
                topAST = ast.children[1]

                # 读取latex数据
                mainSlot, _ = self.makeLatex(mainAST)
                topSlot, _ = self.makeLatex(topAST)

                # 转成latex代码
                mainStr = ''
                topStr = ''
                if mainSlot != "":
                    mainStr = "{ %s }" % mainSlot
                if topSlot != "":
                    topStr = " %s " % topSlot

                # 组成整体公式
                tmplStr = "%s %s" % (topStr, mainStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmARC:
                # 读取数据 HatBoxClass
                mainAST = ast.children[0]
                topAST = ast.children[1]

                # 读取latex数据
                mainSlot, _ = self.makeLatex(mainAST)
                topSlot, _ = self.makeLatex(topAST)

                # 转成latex代码
                mainStr = ''
                topStr = ''
                if mainSlot != "":
                    mainStr = "{ %s }" % mainSlot
                if topSlot != "":
                    topStr = "\\overset %s" % topSlot

                # 组成整体公式
                tmplStr = "%s %s" % (topStr, mainStr)
                buf += tmplStr

                return buf, None
            elif tmpl.selector == SelectorType.tmINTEG:
                # Integrals (BigOpBoxClass 同 tmSUM 的 4 槽位结构)
                mainSlot = ''
                lowerSlot = ''
                upperSlot = ''
                idx = 0
                for astData in ast.children:
                    if idx == 0:
                        mainSlot, _ = self.makeLatex(astData)
                    elif idx == 1:
                        lowerSlot, _ = self.makeLatex(astData)
                    elif idx == 2:
                        upperSlot, _ = self.makeLatex(astData)
                    idx += 1

                # variation -> \int 符号
                # 0x0001 tvINT_1 单重 / 0x0002 tvINT_2 双重 / 0x0003 tvINT_3 三重
                # 0x0004 tvINT_LOOP / 0x0008 tvINT_CW_LOOP / 0x000C tvINT_CCW_LOOP
                # 0x0100 tvINT_EXPAND 积分号随上下文拉伸
                var = tmpl.variation
                int_count = (var & 0x03) or 1
                int_symbol = r"\int" * int_count

                mainStr = ''
                lowerStr = ''
                upperStr = ''
                if mainSlot != '':
                    mainStr = "{ %s }" % mainSlot
                if lowerSlot != '':
                    lowerStr = "_{ %s }" % lowerSlot
                if upperSlot != '':
                    upperStr = "^{ %s }" % upperSlot

                tmplStr = "%s%s%s%s" % (int_symbol, lowerStr, upperStr, mainStr)
                buf += tmplStr
                return buf, None
            else:
                self.Valid = False
                print('MTEF.makeLatex:TMPL NOT IMPLEMENT', tmpl.selector, tmpl.variation)
            for _ast in ast.children:
                _latex, _ = self.makeLatex(_ast)
                buf += _latex
            return buf, None
        elif ast.tag == RecordType.PILE:
            idx = 0
            for _ast in ast.children:
                _latex, _ = self.makeLatex(_ast)

                # 多个line字符串数据以 \\ 分割
                if idx > 0:
                    buf + " \\\\ "

                buf += _latex
                idx += 1
            return buf, None
        elif ast.tag == RecordType.MATRIX:
            matrixCol = int(ast.value.cols)
            idx = 0
            for _ast in ast.children:
                _latex, _ = self.makeLatex(_ast)

                if idx == 0:
                    buf += " \\begin{array} {} "
                    continue

                buf += _latex

                if idx%matrixCol == 0:
                    buf += " \\\\ "
                else:
                    buf += " & "
                idx += 1

            buf += " \\end{array} "
            return buf, None
        elif ast.tag == RecordType.LINE:
            for _ast in ast.children:
                _latex, _ = self.makeLatex(_ast)
                buf += _latex
            return buf, None
        elif ast.tag == RecordType.EMBELL:
            embellType = ast.value.embellType
            embellStr = ''

            if embellType == EmbellType.emb1DOT:
                embellStr = " \\dot "
            elif embellType == EmbellType.emb1PRIME:
                embellStr = "'"
            elif embellType == EmbellType.emb2PRIME:
                embellStr = "''"
            elif embellType == EmbellType.emb3PRIME:
                embellStr = "'''"
            elif embellType == EmbellType.embHAT:
                embellStr = " \\hat "
            elif embellType == EmbellType.embOBAR:
                embellStr = " \\bar "
            else:
                print('METF.makeLatex:not implement embell:', embellType)

            buf += embellStr
            return buf, None

        return '', None

    @classmethod
    def OpenBytes(cls, bts):
        return cls.Open(BytesIO(bts))

    @classmethod
    def Open(cls, reader):
        ole, err = Ole.Open(reader)
        if err is not None:
            print(err)

        dir, err = ole.ListDir()
        if err is not None:
            print(err)

        for file in dir:
            if 'Equation Native' == file.Name():
                root = dir[0]
                reader = ole.OpenFile(file, root)

                hdrBuffer = reader.read(oleCbHdr)
                if hdrBuffer is not None and len(hdrBuffer) == oleCbHdr:
                    # print("*******\n", [hdrBuffer[i] for i in range(len(hdrBuffer))], "*******\n")
                    hdrReader = BytesIO(hdrBuffer)
                    cbHdr = 0 # uint16
                    cbSize = 0 # uint32

                    cbHdr = Helper.bytes2int(hdrReader.read(2))
                    if cbHdr is None or cbHdr != oleCbHdr:
                        return None, 'MTEF.Open: read byte error'

                    # ignore 'version: u32' and 'cf: u16'
                    hdrReader.seek(4+2, 1) # io.SeekCurrent
                    cbSize = Helper.bytes2int(hdrReader.read(4))

                    # body from 'cbHdr' to 'cbHdr + cbSize'
                    reader.seek(cbHdr, 0) # io.SeekStart
                    # print('(DEBUG)MTEF.Open.cbSize:', cbSize)
                    eqnBody = reader.read(cbSize)
                    # print("*******\n", [eqnBody[i] for i in range(len(eqnBody))], "*******\n")

                    eqn = MTEF()
                    eqn.reader = BytesIO(eqnBody)
                    eqn.readRecord()
                    eqn.makeAST()
                    return eqn, None
                
                return None, 'MTEF.Open: read byte error'
        
        return None, err
