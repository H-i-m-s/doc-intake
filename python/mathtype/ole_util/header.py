from io import BytesIO
from .helper import Helper

class Header:
    def __init__(self):
        # Id        [2]uint32
        self.Id = []
        # Clid      [4]uint32
        self.Clid = []
        # Verminor  uint16
        self.Verminor = 0
        # Verdll    uint16
        self.Verdll = 0
        # Byteorder uint16
        self.Byteorder = 0
        # Lsectorb  uint16
        self.Lsectorb = 0
        # Lssectorb uint16
        self.Lssectorb = 0
        # _         uint16
        # _         uint64

        # Cfat     uint32 // Total number of sectors used for the sector allocation table
        self.Cfat = 0
        # Dirstart uint32 // SecID of first sector of the directory stream
        self.Dirstart = 0

        # _ uint32

        # Sectorcutoff uint32 // Minimum size of a standard stream
        self.Sectorcutoff = 0
        # Sfatstart    uint32 // SecID of first sector of the short-sector allocation table
        self.Sfatstart = 0
        # Csfat        uint32 // Total number of sectors used for the short-sector allocation table
        self.Csfat = 0
        # Difstart     uint32 // SecID of first sector of the master sector allocation table
        self.Difstart = 0
        # Cdif         uint32 // Total number of sectors used for the master sector allocation table
        self.Cdif = 0
        # Msat         [109]uint32
        self.Msat = []

    def fromBytes(self, bts):
        reader = BytesIO(bts)

        self.Id = [] # [2]uint32
        for _ in range(2):
            temp = Helper.bytes2int(reader.read(4))
            self.Id.append(temp)

        self.Clid = [] # [4]uint32
        for _ in range(4):
            temp = Helper.bytes2int(reader.read(4))
            self.Clid.append(temp)

        self.Verminor = Helper.bytes2int(reader.read(2)) # uint16
        self.Verdll = Helper.bytes2int(reader.read(2)) # uint16
        self.Byteorder = Helper.bytes2int(reader.read(2)) # uint16
        self.Lsectorb = Helper.bytes2int(reader.read(2)) # uint16
        self.Lssectorb = Helper.bytes2int(reader.read(2)) # uint16
        reader.read(2) # _ uint16
        reader.read(8) # _ uint64
        self.Cfat = Helper.bytes2int(reader.read(4)) # uint32 // Total number of sectors used for the sector allocation table
        self.Dirstart = Helper.bytes2int(reader.read(4)) # uint32 // SecID of first sector of the directory stream
        reader.read(4) # _ uint32
        self.Sectorcutoff = Helper.bytes2int(reader.read(4)) # uint32 // Minimum size of a standard stream
        self.Sfatstart = Helper.bytes2int(reader.read(4)) # uint32 // SecID of first sector of the short-sector allocation table
        self.Csfat = Helper.bytes2int(reader.read(4)) # uint32 // Total number of sectors used for the short-sector allocation table
        self.Difstart = Helper.bytes2int(reader.read(4)) # uint32 // SecID of first sector of the master sector allocation table
        self.Cdif = Helper.bytes2int(reader.read(4)) # uint32 // Total number of sectors used for the master sector allocation table

        self.Msat = [] # [109]uint32
        for _ in range(109):
            temp = Helper.bytes2int(reader.read(4))
            self.Msat.append(temp)

    @classmethod
    def parseHeader(cls, bts):
        header = Header()
        header.fromBytes(bts)

        if header.Id[0] != 0xE011CFD0 or header.Id[1] != 0xE11AB1A1 or header.Byteorder != 0xFFFE:
            return None, 'not an excel file' 

        return header, None