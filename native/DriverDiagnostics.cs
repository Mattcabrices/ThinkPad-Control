using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

internal static class DriverDiagnostics
{
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);

    public record Result(bool Administrator,bool DeviceAccessible,int ErrorCode,string Message);
    public static Result Inspect()
    {
        var admin=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        // Open/close only: no reads, IOCTLs, register writes or driver installation.
        using var handle=CreateFileW(@"\\?\GLOBALROOT\Device\PawnIO",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
        var error=handle.IsInvalid?Marshal.GetLastWin32Error():0;
        return new(admin,!handle.IsInvalid,error,error==0?"PawnIO device handle accessible.":new Win32Exception(error).Message);
    }
}
