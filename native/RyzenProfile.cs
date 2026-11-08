// Original MIT capability registry. Hardware protocol references: docs/RYZEN-COMPATIBILITY.md.
internal sealed record RyzenProfile(string Name,int ReadBytes,int ThermalOffset,uint Response,uint SustainedCommand,uint FastCommand,uint SlowCommand,uint ThermalCommand)
{
    // Integrated GPU temperature exists only for these reviewed family and table pairs.
    // Rembrandt, Phoenix, Krackan and the Raven group have no reviewed offset, so they stay unavailable.
    public static (int TableBytes,int Offset)? GfxMapping(long code,uint table)=>(code,table) switch {
        (1 or 22,0x370000)=>(0x794,0x5AC),(1 or 22,0x370001)=>(0x884,0x5AC),(1 or 22,0x370002)=>(0x88C,0x5AC),
        (1 or 22,0x370003 or 0x370004)=>(0x8AC,0x5AC),(1 or 22,0x370005)=>(0x8C8,0x5C8),
        (13,0x400001)=>(0x910,0x604),(13,0x400002)=>(0x928,0x61C),(13,0x400003)=>(0x94C,0x63C),(13,0x400004 or 0x400005)=>(0x944,0x640),
        (31,0x5D0008 or 0x5D0009 or 0x5D000B)=>(0xD54,0x4C8),
        (32,0x64020C)=>(0xE50,0x550),
        _=>null
    };
    public static RyzenProfile Resolve(long code,uint table)
    {
        var legacy=code is 2 or 6 or 7 or 15;
        var renoir=code is 1 or 22;
        var cezanne=code==13;
        var rembrandt=code==10;
        var phoenix=code is 23 or 24 or 30;
        var strix=code is 31 or 32 or 33 or 34;
        int size=0;
        if(legacy) size=table switch {0x1E0001=>0x568,0x1E0002=>0x580,0x1E0003=>0x578,0x1E0004 or 0x1E0005 or 0x1E000A or 0x1E0101=>0x608,_=>0};
        if(renoir) size=table switch {0x370000=>0x794,0x370001=>0x884,0x370002=>0x88C,0x370003 or 0x370004=>0x8AC,0x370005=>0x8C8,_=>0};
        if(cezanne) size=table switch {0x400001=>0x910,0x400002=>0x928,0x400003=>0x94C,0x400004 or 0x400005=>0x944,_=>0};
        if(rembrandt) size=table switch {0x450004=>0xAA4,0x450005=>0xAB0,_=>0};
        // Earlier Phoenix tables have no reviewed thermal-limit mapping in our reference.
        if(phoenix) size=table switch {0x4C0006=>0xAFC,0x4C0007 or 0x4C0009=>0xB00,0x4C0008=>0xAF0,_=>0};
        if(code==31&&table is 0x5D0008 or 0x5D0009 or 0x5D000B)size=0xD54;
        if(code==32&&table==0x64020C)size=0xE50;
        // Only the reviewed header prefix is consumed; no guessed full table length.
        if(code is 33 or 34 && table==0x650005)size=0x48;
        if(size==0)throw new InvalidOperationException($"No reviewed Ryzen layout for codename {code}, table 0x{table:X8}. Monitoring through other adapters remains available.");
        var name=legacy?"Raven Ridge / Picasso / Dali":renoir?"Renoir / Lucienne":cezanne?"Cezanne / Barcelo":rembrandt?"Rembrandt":phoenix?"Phoenix / Hawk Point":code==31?"Strix Point":code==32?"Strix Halo":"Krackan Point";
        var thermalOffset=legacy||code==32?0x58:0x40;
        return new(name,thermalOffset+sizeof(float),thermalOffset,strix?0x3B10978u:rembrandt||phoenix?0x3B10578u:0x3B10564u,
            legacy?0x1Au:0x14u,legacy?0x1Bu:0x15u,legacy?0x1Cu:0x16u,legacy?0x1Fu:0x19u);
    }
    public uint Message => Response==0x3B10978?0x3B10928u:0x3B10528u;
    public const uint Arguments=0x3B10998;
    // Reviewed second route for firmware that rejects STAPM through MP1. Not used by the older Raven group.
    public (uint Message,uint Response,uint Arguments,uint Command)? SustainedFallback=>SustainedCommand==0x14u?(0x3B10A20u,0x3B10A80u,0x3B10A88u,0x31u):null;
    public uint Command(string key)=>key switch {"sustainedWatts"=>SustainedCommand,"fastWatts"=>FastCommand,"slowWatts"=>SlowCommand,"temperatureLimit"=>ThermalCommand,_=>throw new ArgumentException("Unsupported SMU setting.")};
    public RyzenLimits Decode(long[] table)
    {
        if(table.Length!=(ReadBytes+7)/8)throw new IOException("SMU table length does not match the reviewed layout.");
        var bytes=new byte[table.Length*8];Buffer.BlockCopy(table,0,bytes,0,bytes.Length);
        var result=new RyzenLimits(BitConverter.ToSingle(bytes,0),BitConverter.ToSingle(bytes,8),BitConverter.ToSingle(bytes,16),BitConverter.ToSingle(bytes,ThermalOffset));RyzenController.Validate(result);return result;
    }
}

