// Original MIT implementation. Read-only package RAPL decoding; no write transport.
// Layout/model provenance: Intel SDM vol.4 and Linux v6.12 powercap model registry.
internal sealed record IntelPowerLimit(double? Watts,bool Enabled,bool Clamp,double WindowSeconds);
internal sealed record IntelPackagePower(bool Available,string Reason,IntelPowerLimit? Pl1=null,IntelPowerLimit? Pl2=null,bool? Locked=null,string? ReadAt=null)
{
    public bool ReadOnly=>true;
    public string Source=>"Intel package RAPL MSRs · read at hardware connection";
}
internal static class IntelPowerLimits
{
    public const uint UnitsRegister=0x606,LimitRegister=0x610;
    public static bool Supports(CpuIdentity cpu)=>cpu.Vendor=="GenuineIntel"&&cpu.Family==6&&cpu.Model is
        0x2A or 0x3A or 0x3C or 0x45 or 0x46 or 0x3D or 0x47 or 0x4E or 0x5E or
        0x8E or 0x9E or 0x66 or 0x7D or 0x7E or 0xA5 or 0xA6 or 0x8C or 0x8D or
        0xA7 or 0x97 or 0x9A or 0xB7 or 0xBA or 0xBF or 0xAA or 0xAC;
    public static IntelPackagePower Read(CpuIdentity cpu,Func<uint,ulong> read)
    {
        if(!Supports(cpu))return new(false,"Package power-limit decoding is unavailable for this processor model.");
        try{return Decode(read(UnitsRegister),read(LimitRegister)) with {ReadAt=DateTimeOffset.UtcNow.ToString("O")};}
        catch(Exception e) when(e is System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException or InvalidOperationException)
        {return new(false,"Package power limits could not be read: "+e.Message);}
    }
    public static IntelPackagePower Decode(ulong units,ulong limits)
    {
        if((units&~0xF1F0FUL)!=0||limits is 0 or ulong.MaxValue)return new(false,"Package power registers contain invalid or unavailable data.");
        var powerUnit=Math.Pow(2,-(int)(units&15));var timeUnit=Math.Pow(2,-(int)((units>>16)&15));
        IntelPowerLimit Part(int shift)
        {
            var watts=((limits>>shift)&0x7FFF)*powerUnit;
            var enabled=((limits>>(shift+15))&1)!=0;
            var window=(int)((limits>>(shift+17))&127);
            return new(watts==0?null:watts,enabled,((limits>>(shift+16))&1)!=0,Math.Pow(2,window&31)*(1+((window>>5)&3)/4d)*timeUnit);
        }
        var pl1=Part(0);var pl2=Part(32);
        if((pl1.Enabled&&pl1.Watts is null)||(pl2.Enabled&&pl2.Watts is null)||pl1.Watts>500||pl2.Watts>500)return new(false,"Package power limits are outside the supported telemetry range.");
        return new(true,"",pl1,pl2,(limits&(1UL<<63))!=0);
    }
}
