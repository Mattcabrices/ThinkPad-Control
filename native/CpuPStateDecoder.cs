using System.Text;

// Original MIT code. Pure decoding of read-only registers; no hardware access here.
// Register layouts: AMD PPR and Linux tools/power/cpupower/utils/helpers/amd.c; Intel SDM vol. 4.
internal sealed record CpuIdentity(string Vendor,int Family,int Model,bool Hybrid);
internal sealed record CpuPState(string Label,int Mhz);
internal sealed record CppcCapabilities(int Highest,int Nominal,int LowestNonlinear,int Lowest);

internal static class CpuPStateDecoder
{
    public const uint AmdPStateBase=0xC0010064,AmdCppcEnable=0xC00102B1,AmdCppcCapabilities=0xC00102B0,IntelPlatformInfo=0xCE,IntelTurboRatioLimit=0x1AD;

    // CPPC capability bytes, low to high: lowest, lowest nonlinear, nominal, highest.
    public const uint IntelTemperatureTarget=0x1A2;
    // IA32_TEMPERATURE_TARGET: TjMax in bits 23:16, less the firmware offset in bits 29:24.
    public static int? DecodeIntelThermalTarget(ulong register)
    {
        var target=(int)((register>>16)&0xFF)-(int)((register>>24)&0x3F);
        return target is >=60 and <=110?target:null;
    }
    public static CppcCapabilities? DecodeCppc(ulong register)
    {
        var caps=new CppcCapabilities((int)((register>>24)&0xFF),(int)((register>>16)&0xFF),(int)((register>>8)&0xFF),(int)(register&0xFF));
        return caps.Nominal>0&&caps.Highest>=caps.Nominal&&caps.Nominal>=caps.LowestNonlinear&&caps.LowestNonlinear>=caps.Lowest?caps:null;
    }

    // Client Intel layout: byte n is the top ratio with n+1 active cores. Hybrid CPUs use a different
    // bucket layout, so only the first byte is trusted there. Anything inconsistent gives no result.
    public static IReadOnlyList<int> DecodeIntelTurbo(ulong register,int baseMhz,bool hybrid,double referenceMhz=100)
    {
        if(referenceMhz!=100&&referenceMhz!=400d/3d)return [];
        var values=new List<int>();
        for(var i=0;i<(hybrid?1:8);i++)
        {
            var mhz=(int)Math.Round(((register>>(8*i))&0xFF)*referenceMhz);
            if(mhz==0)break;
            if(mhz<baseMhz||mhz>MaximumMhz||(values.Count>0&&mhz>values[^1]))return [];
            values.Add(mhz);
        }
        return values;
    }

    public const int AmdPStateCount=8;
    public static string? DecodeBrand(IReadOnlyList<int> registers)
    {
        if(registers.Count!=12)return null;
        var bytes=new byte[48];for(var i=0;i<registers.Count;i++)BitConverter.GetBytes(registers[i]).CopyTo(bytes,i*4);
        var brand=Encoding.ASCII.GetString(bytes).Trim('\0',' ');
        return brand.Length==0?null:brand;
    }
    private const int MinimumMhz=400,MaximumMhz=8000;

    public static CpuIdentity Identify(int leaf0Ebx,int leaf0Ecx,int leaf0Edx,int leaf1Eax,int leaf7Edx)
    {
        var vendor=new byte[12];
        BitConverter.GetBytes(leaf0Ebx).CopyTo(vendor,0);BitConverter.GetBytes(leaf0Edx).CopyTo(vendor,4);BitConverter.GetBytes(leaf0Ecx).CopyTo(vendor,8);
        var baseFamily=(leaf1Eax>>8)&0xF;
        var family=baseFamily==0xF?baseFamily+((leaf1Eax>>20)&0xFF):baseFamily;
        var model=(baseFamily is 0xF or 6)?((leaf1Eax>>4)&0xF)|(((leaf1Eax>>16)&0xF)<<4):(leaf1Eax>>4)&0xF;
        var name=Encoding.ASCII.GetString(vendor);
        return new(name,family,model,name=="GenuineIntel"&&(leaf7Edx&(1<<15))!=0);
    }

    // Disabled, malformed and out-of-range entries return null; a value is never guessed.
    public static int? AmdMhz(int family,ulong msr)
    {
        if((msr>>63)==0)return null;
        int mhz;
        if(family is 0x17 or 0x19)
        {
            var fid=(int)(msr&0xFF);var did=(int)((msr>>8)&0x3F);
            if(did==0)return null;
            mhz=200*fid/did;
        }
        else if(family==0x1A)
        {
            var fid=(int)(msr&0xFFF);
            if(fid<=0xF)return null;
            mhz=fid*5;
        }
        else return null;
        return mhz is >=MinimumMhz and <=MaximumMhz?mhz:null;
    }

    public static IReadOnlyList<CpuPState> DecodeAmd(int family,IReadOnlyList<ulong> registers)
    {
        var states=new List<CpuPState>();
        for(var i=0;i<registers.Count;i++)if(AmdMhz(family,registers[i]) is int mhz)states.Add(new("P"+i,mhz));
        return states;
    }

    // Nominal ratio reference, not measured BCLK. Older Nehalem/Westmere mobile
    // CPUs use 133 1/3 MHz. Core 2/Atom and unknown layouts must not inherit 100 MHz.
    // Reviewed client model identities: Intel SDM vol. 4 and pinned LHM IntelCpu mapping.
    public static double? IntelReferenceMhz(CpuIdentity cpu)
    {
        if(cpu.Vendor!="GenuineIntel"||cpu.Family!=6)return null;
        return cpu.Model switch {
            0x1A or 0x1E or 0x1F or 0x25 or 0x2C or 0x2E or 0x2F => 400d/3d,
            0x2A or 0x2D or 0x3A or 0x3E or 0x3C or 0x3F or 0x45 or 0x46 or
            0x3D or 0x47 or 0x4F or 0x56 or 0x4E or 0x5E or 0x8E or 0x9E or
            0x66 or 0x7D or 0x7E or 0xA5 or 0xA6 or 0x8C or 0x8D or 0x97 or
            0x9A or 0xBE or 0xB7 or 0xBA or 0xBF or 0xAA or 0xAC or 0xA7 or
            0xC5 or 0xC6 or 0xBD => 100,
            _ => null
        };
    }

    public static IReadOnlyList<CpuPState> DecodeIntel(ulong platformInfo,double referenceMhz=100)
    {
        if(referenceMhz!=100&&referenceMhz!=400d/3d)return [];
        var maximum=(int)Math.Round(((platformInfo>>8)&0xFF)*referenceMhz);var minimum=(int)Math.Round(((platformInfo>>40)&0xFF)*referenceMhz);
        if(maximum is <MinimumMhz or >MaximumMhz||minimum is <MinimumMhz or >MaximumMhz||minimum>maximum)return [];
        return minimum==maximum?[new("Base",maximum)]:[new("Base",maximum),new("Minimum",minimum)];
    }
}
