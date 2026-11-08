using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
using LibreHardwareMonitor.PawnIo;

// No caller-supplied module names, register addresses or firmware command IDs.
internal sealed class RyzenTransport : IDisposable
{
    private readonly SafeFileHandle handle;
    private readonly Mutex pci;
    public RyzenProfile Profile {get; private set;} = null!;
    public long CodeName {get; private set;}
    public uint TableVersion {get; private set;}
    // Testers need this: an acknowledged request never reaches the fallback route.
    public string? LastSustainedRoute {get; private set;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool DeviceIoControl(SafeFileHandle h,uint code,byte[] input,int inputSize,byte[] output,int outputSize,out int returned,IntPtr overlapped);
    public RyzenTransport() {
        handle=CreateFile(@"\\?\GLOBALROOT\Device\PawnIO",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
        if(handle.IsInvalid){handle.Dispose();throw new Win32Exception(Marshal.GetLastWin32Error(),"Enable hardware access to use Ryzen tuning.");}
        try {
            using var stream=typeof(RyzenSmu).Assembly.GetManifestResourceStream("LibreHardwareMonitor.Resources.PawnIo.RyzenSMU.bin")??throw new IOException("Pinned signed SMU module is missing.");
            using var memory=new MemoryStream();stream.CopyTo(memory);var module=memory.ToArray();
            if(!DeviceIoControl(handle,0xA1B22084,module,module.Length,[],0,out _,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"Signed SMU module load failed.");
            pci=Mutex.OpenExisting(@"Global\Access_PCI");
            WithPci(()=>{CodeName=Call("ioctl_get_code_name",[],1)[0];var resolved=Call("ioctl_resolve_pm_table",[],2);TableVersion=(uint)resolved[0];Profile=RyzenProfile.Resolve(CodeName,TableVersion);return true;});
        } catch { pci?.Dispose();handle.Dispose();throw; }
    }
    private long[] Call(string name,long[] args,int count) {
        var input=new byte[32+args.Length*8];Encoding.ASCII.GetBytes(name).CopyTo(input,0);Buffer.BlockCopy(args,0,input,32,args.Length*8);var output=new byte[count*8];
        if(!DeviceIoControl(handle,0xA1B22104,input,input.Length,output,output.Length,out var returned,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"SMU operation failed: "+name);
        if(returned!=output.Length)throw new IOException("SMU returned an incomplete response.");var result=new long[count];Buffer.BlockCopy(output,0,result,0,output.Length);return result;
    }
    private T WithPci<T>(Func<T> action) {
        var acquired=false;try {try{acquired=pci.WaitOne(2000);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new TimeoutException("PCI access is busy.");return action();}finally{if(acquired)pci.ReleaseMutex();}
    }
    public RyzenLimits Read() => WithPci(()=> {
        Call("ioctl_update_pm_table",[],0);return Profile.Decode(Call("ioctl_read_pm_table",[],(Profile.ReadBytes+7)/8));
    });
    private uint ReadRegister(uint address)=>(uint)Call("ioctl_read_smu_register",[address],1)[0];
    private void WriteRegister(uint address,uint value)=>Call("ioctl_write_smu_register",[address,value],0);
    public void Write(string key,float value) => WithPci(()=> {
        var scaled=(uint)MathF.Round(value*(key=="temperatureLimit"?1:1000));
        var status=Send(Profile.Message,Profile.Response,RyzenProfile.Arguments,Profile.Command(key),scaled);
        // The controller still verifies the result through read-back, whichever route acknowledged it.
        if(key=="sustainedWatts")LastSustainedRoute=status==1?"MP1 acknowledged":"MP1 rejected";
        if(status!=1&&key=="sustainedWatts"&&Profile.SustainedFallback is {} fallback){status=Send(fallback.Message,fallback.Response,fallback.Arguments,fallback.Command,scaled);LastSustainedRoute=status==1?"MP1 rejected, PSMU acknowledged":"MP1 and PSMU rejected";}
        if(status!=1)throw new InvalidOperationException($"SMU rejected {key}: response 0x{status:X}.");return true;
    });
    // Addresses and commands come only from the reviewed profile; none are supplied by a caller.
    private uint Send(uint message,uint response,uint arguments,uint command,uint value) {
        var deadline=Environment.TickCount64+500;
        while(ReadRegister(response)==0){if(Environment.TickCount64>=deadline)throw new TimeoutException("SMU mailbox is busy.");Thread.Sleep(1);}
        WriteRegister(response,0);for(uint i=0;i<6;i++)WriteRegister(arguments+i*4,i==0?value:0);
        WriteRegister(message,command);deadline=Environment.TickCount64+1000;uint status;
        while((status=ReadRegister(response))==0){if(Environment.TickCount64>=deadline)throw new TimeoutException("SMU acknowledgement timed out.");Thread.Sleep(1);}
        return status;
    }
    public void Dispose(){handle.Dispose();pci.Dispose();}
}





