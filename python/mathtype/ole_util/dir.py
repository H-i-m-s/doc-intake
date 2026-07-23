from io import BytesIO
from .helper import Helper

class FileType:
    EMPTY = 0
    USERSTORAGE = 1
    USERSTREAM = 2
    LOCKBYTES = 3
    PROPERTY = 4
    ROOT = 5

class File:
    def __init__(self):
        # NameBts   [32]uint16
        self.NameBts = []
        # Bsize     uint16
        self.Bsize = 0
        # Type      byte
        self.Type = FileType.EMPTY
        # Flag      byte
        self.Flag = 0
        # Left      uint32
        self.Left = 0
        # Right     uint32
        self.Right = 0
        # Child     uint32
        self.Child = 0
        # Guid      [8]uint16
        self.Guid = []
        # Userflags uint32
        self.Userflags = 0
        # Time      [2]uint64
        self.Time = []
        # Sstart    uint32
        self.Sstart = 0
        # Size      uint32
        self.Size = 0
        # Proptype  uint32
        self.Proptype = 0

    def fromBytes(self, bts):
        reader = BytesIO(bts)

        self.NameBts = [] # [32]uint16
        for _ in range(32):
            self.NameBts.append(reader.read(2))

        self.Bsize = Helper.bytes2int(reader.read(2)) # uint16
        self.Type = Helper.bytes2int(reader.read(1)) # byte
        self.Flag = Helper.bytes2int(reader.read(1)) # byte
        self.Left = Helper.bytes2int(reader.read(4)) # uint32
        self.Right = Helper.bytes2int(reader.read(4)) # uint32
        self.Child = Helper.bytes2int(reader.read(4)) # uint32

        self.Guid = [] # [8]uint16
        for _ in range(8):
            temp = Helper.bytes2int(reader.read(2))
            self.Guid.append(temp)

        self.Userflags = Helper.bytes2int(reader.read(4)) # uint32

        self.Time = [] # [2]uint64
        for _ in range(2):
            temp = Helper.bytes2int(reader.read(8))
            self.Time.append(temp)

        self.Sstart = Helper.bytes2int(reader.read(4)) # uint32
        self.Size = Helper.bytes2int(reader.read(4)) # uint32
        self.Proptype = Helper.bytes2int(reader.read(4)) # uint32

    def Name(self):
        return b''.join(self.NameBts[:int(self.Bsize/2-1)]).decode('utf-16-le')