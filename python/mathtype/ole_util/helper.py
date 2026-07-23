class Helper:
    # ENDOFCHAIN = uint32(0xFFFFFFFE) //-2
    ENDOFCHAIN = 0xFFFFFFFE
    # FREESECT = uint32(0xFFFFFFFF)   // -1
    FREESECT = 0xFFFFFFFF

    @classmethod
    def bytes2int(cls, bts):
        if bts is None:
            return None
        return int.from_bytes(bts, byteorder='little')