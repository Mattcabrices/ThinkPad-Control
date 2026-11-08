using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// Installer-only configuration. No start/stop, startup-type, reboot or command execution.
internal static class EngineServiceRecovery
{
    internal readonly record struct RecoveryAction(uint Type,uint Delay);
    internal sealed record Policy(uint ResetSeconds,string RebootMessage,string Command,RecoveryAction[] Actions);
    internal static Policy Desired => new(86400,"","",[new(1,5000),new(1,15000),new(0,0)]);
    internal static bool Same(Policy a,Policy b) => a.ResetSeconds==b.ResetSeconds&&a.RebootMessage==b.RebootMessage&&a.Command==b.Command&&a.Actions.SequenceEqual(b.Actions);

    // Fault-injectable transaction: configuration success is established by actual read-back.
    internal static void Apply(Action trusted,Func<Policy> read,Action<Policy> write)
    {
        trusted();var before=read();var desired=Desired;
        if(Same(before,desired))return;
        try {
            trusted();write(desired);trusted();
            if(!Same(read(),desired))throw new InvalidOperationException("Engine recovery policy read-back mismatch.");
        } catch(Exception initial) {
            try {
                trusted();write(before);trusted();
                if(!Same(read(),before))throw new InvalidOperationException("Previous recovery policy read-back mismatch.");
            } catch(Exception rollback) {
                throw new InvalidOperationException("Engine recovery configuration failed; rollback is unverified: "+rollback.Message,initial);
            }
            throw new InvalidOperationException("Engine recovery configuration failed; previous policy restored and verified.",initial);
        }
    }

    public static void Configure()
    {
        TpfcEngineTrust.EnsureTrustedService();
        using var manager=OpenSCManager(null,null,1);
        if(manager.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());
        // SERVICE_QUERY_CONFIG | SERVICE_CHANGE_CONFIG | SERVICE_START.
        // SERVICE_START is required by Windows to configure a restart action; never invoked here.
        using var service=OpenService(manager,"TPFanControl",0x13);
        if(service.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());
        Apply(TpfcEngineTrust.EnsureTrustedService,()=>Read(service),p=>Write(service,p));
    }

    private static Policy Read(ServiceHandle service)
    {
        QueryServiceConfig2(service,2,IntPtr.Zero,0,out var needed);
        if(Marshal.GetLastWin32Error()!=122||needed<Marshal.SizeOf<FailureActions>()||needed>1048576)
            throw new Win32Exception(Marshal.GetLastWin32Error(),"Could not size engine recovery configuration.");
        var buffer=Marshal.AllocHGlobal(checked((int)needed));
        try {
            if(!QueryServiceConfig2(service,2,buffer,needed,out _))throw new Win32Exception(Marshal.GetLastWin32Error());
            var raw=Marshal.PtrToStructure<FailureActions>(buffer);
            if(raw.Count>32||raw.Count>0&&raw.Actions==IntPtr.Zero)throw new InvalidOperationException("Invalid engine recovery action layout.");
            var actions=new RecoveryAction[raw.Count];
            for(var i=0;i<actions.Length;i++) {
                var action=Marshal.PtrToStructure<NativeAction>(IntPtr.Add(raw.Actions,i*Marshal.SizeOf<NativeAction>()));
                actions[i]=new(action.Type,action.Delay);
            }
            return new(raw.Reset,raw.RebootMessage??"",raw.Command??"",actions);
        } finally {Marshal.FreeHGlobal(buffer);}
    }
    private static void Write(ServiceHandle service,Policy policy)
    {
        // A non-null array with count zero deletes a previous action list during rollback.
        var actions=Marshal.AllocHGlobal(Math.Max(1,policy.Actions.Length)*Marshal.SizeOf<NativeAction>());
        try {
            for(var i=0;i<policy.Actions.Length;i++)Marshal.StructureToPtr(new NativeAction{Type=policy.Actions[i].Type,Delay=policy.Actions[i].Delay},IntPtr.Add(actions,i*Marshal.SizeOf<NativeAction>()),false);
            var raw=new FailureActions{Reset=policy.ResetSeconds,RebootMessage=policy.RebootMessage,Command=policy.Command,Count=(uint)policy.Actions.Length,Actions=actions};
            if(!ChangeServiceConfig2(service,2,ref raw))throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {Marshal.FreeHGlobal(actions);}
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativeAction {public uint Type,Delay;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private struct FailureActions {
        public uint Reset;
        [MarshalAs(UnmanagedType.LPWStr)] public string? RebootMessage;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Command;
        public uint Count;public IntPtr Actions;
    }
    private sealed class ServiceHandle:SafeHandleZeroOrMinusOneIsInvalid {
        public ServiceHandle():base(true){}
        protected override bool ReleaseHandle()=>CloseServiceHandle(handle);
    }
    [DllImport("advapi32.dll",EntryPoint="OpenSCManagerW",CharSet=CharSet.Unicode,SetLastError=true)] private static extern ServiceHandle OpenSCManager(string? machine,string? database,uint access);
    [DllImport("advapi32.dll",EntryPoint="OpenServiceW",CharSet=CharSet.Unicode,SetLastError=true)] private static extern ServiceHandle OpenService(ServiceHandle manager,string name,uint access);
    [DllImport("advapi32.dll",EntryPoint="QueryServiceConfig2W",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool QueryServiceConfig2(ServiceHandle service,uint level,IntPtr buffer,uint size,out uint needed);
    [DllImport("advapi32.dll",EntryPoint="ChangeServiceConfig2W",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool ChangeServiceConfig2(ServiceHandle service,uint level,ref FailureActions info);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CloseServiceHandle(IntPtr handle);
}
