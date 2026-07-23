class PSS:
    def __init__(self):
        # name      [64]byte
        self.name = []
        # bsize     uint16
        self.bsize = 0
        # typ       byte
        self.typ = 0
        # flag      byte
        self.flag = 0
        # left      uint32
        self.left = 0
        # right     uint32
        self.right = 0
        # child     uint32
        self.child = 0
        # guid      [16]uint16
        self.guid = []
        # userflags uint32
        self.userflags = 0
        # time      [2]uint64
        self.time = []
        # sstart    uint32
        self.sstart = 0
        # size      uint32
        self.size = 0
        # _         uint32