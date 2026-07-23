from io import BytesIO
from .helper import Helper
from .header import Header
from .sector import Sector
from .dir import File, FileType
from .stream_reader import StreamReader

class Ole:
    def __init__(self):
        # header   *Header
        self.header = None
        # Lsector  uint32
        self.Lsector = 0
        # Lssector uint32
        self.Lssector = 0
        # SecID    []uint32
        self.SecID = []
        # SSecID   []uint32
        self.SSecID = []
        # Files    []File
        self.Files = []
        # reader   io.ReadSeeker
        self.reader = None

    @classmethod
    def OpenBytes(cls, bts, charset=None):
        return cls.Open(BytesIO(bts), charset)
    
    @classmethod
    def Open(cls, reader, charset=None):
        hbts = reader.read(512)
        header, err = Header.parseHeader(hbts)
        if err == None:
            ole = Ole()
            ole.reader = reader
            ole.header = header
            ole.Lsector = 512
            ole.Lssector = 64
            err = ole.readMSAT()
            return ole, err
        return None, err

    def ListDir(self):
        sector = self.stream_read(self.header.Dirstart, 0)
        dir = []
        while True:
            d = File()
            # file_size = (32*16+16+8+8+32+32+32+8*16+32+2*64+32+32+32)/8
            # read_bytes = sector.read(file_size)
            read_bytes = sector.read(128)
            d.fromBytes(read_bytes)
            if d.Type != FileType.EMPTY:
                dir.append(d)
            else:
                break
        if dir:
            return dir, None

        return None, None

    def OpenFile(self, file, root):
        # print('(DEBUG)Ole.OpenFile:file.Size:', file.Size, ',heaer.Sectorcutoff:', self.header.Sectorcutoff)
        if file.Size < self.header.Sectorcutoff:
            return self.short_stream_read(file.Sstart, file.Size, root.Sstart)
        else:
            return self.stream_read(file.Sstart, file.Size)

    # // Read MSAT
    def readMSAT(self):
        count = 109
        if self.header.Cfat < 109:
            count = self.header.Cfat

        for i in range(count):
            sector, err = self.sector_read(self.header.Msat[i]) 
            if err == None:
                sids = sector.AllValues(self.Lsector)
                self.SecID.extend(sids)
            else:
                return err

        sid = self.header.Difstart
        while sid != Helper.ENDOFCHAIN:
            sector, err = self.sector_read(sid)
            if err == None:
                sids = sector.MsatValues(self.Lsector)

                for sid in sids:
                    sector, err = self.sector_read(sid)
                    if err == None:
                        sids = sector.AllValues(self.Lsector)

                        self.SecID.extend(sids)
                    else:
                        return err

                sid = sector.NextSid(self.Lsector)
            else:
                return err

        for i in range(self.header.Csfat):
            sid = self.header.Sfatstart

            if sid != Helper.ENDOFCHAIN:
                sector, err = self.sector_read(sid)
                if err == None:
                    sids = sector.MsatValues(self.Lsector)

                    self.SSecID.extend(sids)

                    sid = sector.NextSid(self.Lsector)
                else:
                    return err
        return None

    def stream_read(self, sid, size):
        return StreamReader(self.SecID, sid, self.reader, sid, 0, self.Lsector, size, 0, self.sector_pos)

    def short_stream_read(self, sid, size, startSecId):
        ssatReader = StreamReader(self.SecID, startSecId, self.reader, sid, 0, self.Lsector, len(self.SSecID)*self.Lssector, 0, self.sector_pos)
        return StreamReader(self.SSecID, sid, ssatReader, sid, 0, self.Lssector, size, 0, self.short_sector_pos)

    def sector_read(self, sid):
        return self.sector_read_internal(sid, self.Lsector)

    def short_sector_read(self, sid):
        return self.sector_read_internal(sid, self.Lssector)

    def sector_read_internal(self, sid, size):
        pos = self.sector_pos(sid, size)
        index = self.reader.seek(pos, 0)
        if index != -1:
            bts = self.reader.read(size)
            return Sector(bts), None
        else:
            return None, 'bytes seek error'

    @classmethod
    def sector_pos(cls, sid, size):
        return 512 + sid*size

    @classmethod
    def short_sector_pos(cls, sid, size):
        return sid * size