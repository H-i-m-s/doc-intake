from .helper import Helper

DEBUG = False

class StreamReader:
    def __init__(self, sat=[], start=0, reader=None, offset_of_sector=0, offset_in_sector=0, size_sector = 0, size=0, offset=0, sector_pos=None):
        # sat              []uint32
        self.sat = sat
        # start            uint32
        self.start = start
        # reader           io.ReadSeeker
        self.reader = reader
        # offset_of_sector uint32
        self.offset_of_sector = offset_of_sector
        # offset_in_sector uint32
        self.offset_in_sector = offset_in_sector
        # size_sector      uint32
        self.size_sector = size_sector
        # size             int64
        self.size = size
        # offset           int64
        self.offset = offset
        # sector_pos       func(uint32, uint32) uint32
        self.sector_pos = sector_pos

    def read(self, read_size=None):
        # print("(DEBUG)StreamReader.Read.offset_of_sector:%s" % self.offset_of_sector)
        # print("(DEBUG)StreamReader.Read.sat:%s" % self.sat)
        if self.offset_of_sector == Helper.ENDOFCHAIN:
            return b''

        ans = []
        pos = self.sector_pos(self.offset_of_sector, self.size_sector) + self.offset_in_sector
        self.reader.seek(pos, 0)
        readed = 0
        reaminLen = read_size-readed
        while reaminLen > self.size_sector-self.offset_in_sector:
            to_read_size = self.size_sector-self.offset_in_sector
            read_bytes = self.reader.read(self.size_sector-self.offset_in_sector)
            if read_bytes:
                ans.append(read_bytes)
            if read_bytes is None or len(read_bytes) != to_read_size:
                # print("(DEBUG)StreamReader.Read.for.if:n:%s" % len(read_bytes))
                # print("(DEBUG)StreamReader.Read.for.if:need n:%s" % (self.size_sector-self.offset_in_sector))
                # print("(DEBUG)StreamReader.Read.for.if:readed:%s" % readed)
                # print("(DEBUG)StreamReader.Read.for.if:size_sector:%s" % self.size_sector)
                # print("(DEBUG)StreamReader.Read.for.if:offset_in_sector:%s" % self.offset_in_sector)
                return b''.join(ans)
            else:
                # print("(DEBUG)StreamReader.Read.for.else:n:%s" % len(read_bytes))
                # print("(DEBUG)StreamReader.Read.for.else:need n:%s" % (self.size_sector-self.offset_in_sector))
                readed += len(read_bytes)
                self.offset_in_sector = 0
                if self.offset_of_sector >= len(self.sat):
                    print('THIS SHOULD NOT HAPPEN, IF YOUR PROGRAM BREAK, COMMENT THIS LINE TO CONTINUE AND MAIL ME XLS FILE TO TEST, THANKS')
                    return b''.join(ans)
                else:
                    self.offset_of_sector = self.sat[self.offset_of_sector]
                if self.offset_of_sector == Helper.ENDOFCHAIN:
                    return b''.join(ans)
                pos = self.sector_pos(self.offset_of_sector, self.size_sector)+self.offset_in_sector
                self.reader.seek(pos, 0)
                # print("(DEBUG)StreamReader.Read.for.else:readed:%s" % readed)
                # print("(DEBUG)StreamReader.Read.for.else:offset_of_sector:%s" % self.offset_of_sector)

            reaminLen = read_size-readed

        read_bytes = self.reader.read(read_size-readed)
        if read_bytes:
            ans.append(read_bytes)
        if read_bytes and len(read_bytes) == read_size-readed:
            self.offset_in_sector += len(read_bytes)
            if DEBUG:
                print('pos:%d,bit:' % self.offset_of_sector)
                print(b''.join(ans))
            return b''.join(ans) 
        else:
            return b''.join(ans)

    def seek(self, offset, whence=0):
        if whence == 0:
            self.offset_of_sector = self.start
            self.offset_in_sector = 0
            self.offset = offset
        else:
            self.offset += offset

        if self.offset_of_sector == Helper.ENDOFCHAIN:
            return self.offset

        need_go_to = False
        while offset >= self.size_sector-self.offset_in_sector:
            self.offset_of_sector = self.sat[self.offset_of_sector]
            offset -= self.size_sector-self.offset_in_sector
            self.offset_in_sector = 0
            if self.offset_of_sector == Helper.ENDOFCHAIN:
                need_go_to = True
                break
        
        if not need_go_to:
            if self.size <= self.offset:
                # err = io.EOF
                self.offset = self.size
            else:
                self.offset_in_sector += offset

        return self.offset
