from io import BytesIO
from .helper import Helper

class Sector:
    def __init__(self, data=None):
        self.data = data

    def Uint32(self, bit):
        return Helper.bytes2int(self.data[bit:bit+4])

    def NextSid(self, size):
        return self.Uint32(size-4)

    def MsatValues(self, size):
        return self.values(size, int(size/4-1))

    def AllValues(self, size):
        return self.values(size, int(size/4))

    def values(self, size, length):
        reader = BytesIO(self.data)
        res = []
        for _ in range(length):
            temp = Helper.bytes2int(reader.read(4))
            res.append(temp)
        return res
