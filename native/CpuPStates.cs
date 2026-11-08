using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Intrinsics.X86;
using System.Text;
using Microsoft.Win32.SafeHandles;
using LibreHardwareMonitor.PawnIo;

// Original MIT code. Read-only hardware P-state discovery; this file performs no MSR writes.
internal static class CpuPStates
{
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool DeviceIoControl(SafeFileHandle h,uint code,byte[] input,int inputSize,byte[] output,int outputSize,out int returned,IntPtr overlapped);

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("kernel32.dll",SetLastError=true)] private static extern UIntPtr SetThreadAffinityMask(IntPtr thread,UIntPtr mask);

    // The best core may differ from the others, so CPPC capabilities are read on each logical processor.
    private static CppcCapabilities? BestCppc(SafeFileHandle handle)
    {
        CppcCapabilities? best=null;
        Thread.BeginThreadAffinity();
        var original=UIntPtr.Zero;
        try
        {
            for(var cpu=0;cpu<Math.Min(Environment.ProcessorCount,64);cpu++)
            {
                var previous=SetThreadAffinityMask(GetCurrentThread(),(UIntPtr)(1UL<<cpu));
                if(previous==UIntPtr.Zero)continue;
                if(original==UIntPtr.Zero)original=previous;
                Thread.Sleep(0); // Let Windows move this thread onto the requested processor.
                var caps=CpuPStateDecoder.DecodeCppc(ReadMsr(handle,CpuPStateDecoder.AmdCppcCapabilities));
                if(caps is not null&&(best is null||caps.Highest>best.Highest))best=caps;
            }
        }
        finally
        {
            if(original!=UIntPtr.Zero)SetThreadAffinityMask(GetCurrentThread(),original);
            Thread.EndThreadAffinity();
        }
        return best;
    }

    internal static CpuIdentity Current()
    {
        var leaf0=X86Base.CpuId(0,0);var leaf1=X86Base.CpuId(1,0);
        return CpuPStateDecoder.Identify(leaf0.Ebx,leaf0.Ecx,leaf0.Edx,leaf1.Eax,leaf0.Eax>=7?X86Base.CpuId(7,0).Edx:0);
    }
    internal static string? BrandName()
    {
        try {
            if(!X86Base.IsSupported||(uint)X86Base.CpuId(unchecked((int)0x80000000),0).Eax<0x80000004u)return null;
            var registers=new List<int>();
            for(uint leaf=0x80000002;leaf<=0x80000004;leaf++){var r=X86Base.CpuId(unchecked((int)leaf),0);registers.AddRange([r.Eax,r.Ebx,r.Ecx,r.Edx]);}
            return CpuPStateDecoder.DecodeBrand(registers);
        }catch{return null;}
    }

    private static object Unavailable(CpuIdentity? cpu,string reason)=>new{available=false,reason,vendor=cpu?.Vendor,family=cpu?.Family,model=cpu?.Model,hybrid=cpu?.Hybrid??false};

    // Each register address below is fixed. No caller supplies a module name or an MSR.
    public static object Discover()
    {
        CpuIdentity? cpu=null;
        try
        {
            cpu=Current();
            var amd=cpu.Vendor=="AuthenticAMD";
            if(!amd&&cpu.Vendor!="GenuineIntel")return Unavailable(cpu,"No reviewed P-state layout for this processor vendor.");
            if(amd&&cpu.Family is not (0x17 or 0x19 or 0x1A))return Unavailable(cpu,$"No reviewed P-state layout for AMD family 0x{cpu.Family:X}.");
            var referenceMhz=amd?null:CpuPStateDecoder.IntelReferenceMhz(cpu);
            if(!amd&&referenceMhz is null)return Unavailable(cpu,$"No reviewed Intel ratio reference for family 0x{cpu.Family:X}, model 0x{cpu.Model:X}. Windows frequency policy remains separate.");
            using var handle=CreateFile(@"\\?\GLOBALROOT\Device\PawnIO",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
            if(handle.IsInvalid)return Unavailable(cpu,"Enable hardware access to read hardware P-states.");
            using var stream=typeof(RyzenSmu).Assembly.GetManifestResourceStream("LibreHardwareMonitor.Resources.PawnIo."+(amd?"AMDFamily17":"IntelMSR")+".bin")??throw new IOException("Pinned signed MSR module is missing.");
            using var memory=new MemoryStream();stream.CopyTo(memory);var module=memory.ToArray();
            if(!DeviceIoControl(handle,0xA1B22084,module,module.Length,[],0,out _,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"Signed MSR module load failed.");
            IReadOnlyList<CpuPState> states;bool? cppc=null;CppcCapabilities? caps=null;int? boostMhz=null;IReadOnlyList<int> turbo=[];int? thermalTarget=null;IntelPackagePower? packagePower=null;
            if(amd)
            {
                var registers=new ulong[CpuPStateDecoder.AmdPStateCount];
                for(uint i=0;i<registers.Length;i++)registers[i]=ReadMsr(handle,CpuPStateDecoder.AmdPStateBase+i);
                states=CpuPStateDecoder.DecodeAmd(cpu.Family,registers);
                try{cppc=(ReadMsr(handle,CpuPStateDecoder.AmdCppcEnable)&1)!=0;}catch(Win32Exception){}
                // Optional: failing to read these must not hide the P-states. They don't convert directly to MHz:
                // a 5650U reports 186/89, which scales P0 to 4807 MHz against its rated 4.2 GHz.
                if(cppc==true&&states.Count>0)try{caps=BestCppc(handle);}catch(Win32Exception){}
            }
            else
            {
                packagePower=IntelPowerLimits.Read(cpu,register=>ReadMsr(handle,register));
                states=CpuPStateDecoder.DecodeIntel(ReadMsr(handle,CpuPStateDecoder.IntelPlatformInfo),referenceMhz!.Value);
                try{thermalTarget=CpuPStateDecoder.DecodeIntelThermalTarget(ReadMsr(handle,CpuPStateDecoder.IntelTemperatureTarget));}catch(Win32Exception){}
                if(states.Count>0)try{turbo=CpuPStateDecoder.DecodeIntelTurbo(ReadMsr(handle,CpuPStateDecoder.IntelTurboRatioLimit),states[0].Mhz,cpu.Hybrid,referenceMhz.Value);boostMhz=turbo.Count>0?turbo[0]:null;}catch(Win32Exception){}
            }
            if(states.Count==0)return Unavailable(cpu,"Hardware P-state registers held no valid entry.");
            return new{available=true,reason="",vendor=cpu.Vendor,family=cpu.Family,model=cpu.Model,hybrid=cpu.Hybrid,
                source=amd?"AMD P-state MSRs":"Intel PLATFORM_INFO",cppcEnabled=cppc,states=states.Select(s=>new{label=s.Label,mhz=s.Mhz}),
                referenceClockMhz=referenceMhz,boostMhz,thermalTargetC=thermalTarget,powerLimits=packagePower,cppc=caps is null?null:(object)new{highest=caps.Highest,nominal=caps.Nominal,lowestNonlinear=caps.LowestNonlinear,lowest=caps.Lowest},turboByActiveCores=turbo};
        }
        catch(Exception e){return Unavailable(cpu,"Hardware P-states unavailable: "+e.Message);}
    }

    private static ulong ReadMsr(SafeFileHandle handle,uint register)
    {
        var input=new byte[40];Encoding.ASCII.GetBytes("ioctl_read_msr").CopyTo(input,0);BitConverter.GetBytes((long)register).CopyTo(input,32);
        var output=new byte[8];
        if(!DeviceIoControl(handle,0xA1B22104,input,input.Length,output,output.Length,out var returned,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"MSR read failed.");
        if(returned!=output.Length)throw new IOException("MSR read returned an incomplete response.");
        return BitConverter.ToUInt64(output,0);
    }
}
