using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class MandatoryPipeLabel
{
    // LABEL_SECURITY_INFORMATION needs WRITE_OWNER, not the audit-SACL privilege.
    // Set only the label on our new pipe, never an audit policy or another object.
    public static void Apply(SafePipeHandle pipe)
    {
        if(!ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;;NW;;;ME)",1,out var descriptor,out _))
            throw new Win32Exception(Marshal.GetLastWin32Error(),"Could not create pipe integrity label.");
        try {
            if(!SetKernelObjectSecurity(pipe,0x10,descriptor))
                throw new Win32Exception(Marshal.GetLastWin32Error(),"Could not set pipe integrity label.");
        } finally { LocalFree(descriptor); }
    }
    internal static string Read(SafePipeHandle pipe)
    {
        GetKernelObjectSecurity(pipe,0x10,IntPtr.Zero,0,out var size);
        if(size==0)throw new Win32Exception(Marshal.GetLastWin32Error());
        var descriptor=Marshal.AllocHGlobal((int)size);
        try {
            if(!GetKernelObjectSecurity(pipe,0x10,descriptor,size,out _) ||
                !ConvertSecurityDescriptorToStringSecurityDescriptor(descriptor,1,0x10,out var text,out _))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            try { return Marshal.PtrToStringUni(text)!; } finally {LocalFree(text);}
        } finally {Marshal.FreeHGlobal(descriptor);}
    }
    [DllImport("advapi32.dll",EntryPoint="ConvertStringSecurityDescriptorToSecurityDescriptorW",CharSet=CharSet.Unicode,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl,uint revision,out IntPtr descriptor,out uint size);
    [DllImport("advapi32.dll",SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetKernelObjectSecurity(SafePipeHandle handle,uint information,IntPtr descriptor);
    [DllImport("advapi32.dll",SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetKernelObjectSecurity(SafePipeHandle handle,uint information,IntPtr descriptor,uint length,out uint needed);
    [DllImport("advapi32.dll",EntryPoint="ConvertSecurityDescriptorToStringSecurityDescriptorW",CharSet=CharSet.Unicode,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr descriptor,uint revision,uint information,out IntPtr text,out uint length);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}
