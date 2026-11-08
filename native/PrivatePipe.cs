using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;

internal static class PrivatePipe
{
    [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe,out uint clientProcessId);
    // The worker runs from <install>\bridge, and the client must be <install>\runtime\node.exe.
    public static bool IsBundledRuntime(string? clientPath,string workerDirectory)
    {
        if(string.IsNullOrEmpty(clientPath))return false;
        var install=Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(Path.GetFullPath(workerDirectory)));
        return install is not null&&string.Equals(Path.GetFullPath(clientPath),Path.Combine(install,"runtime","node.exe"),StringComparison.OrdinalIgnoreCase);
    }
    public static async Task<NamedPipeServerStream?> Connect(string[] args)
    {
        if(args.Length==0)return null;
        if((args.Length!=4&&!(args.Length==5&&args[4]=="--tpfc"))||args[0]!="--pipe"||args[2]!="--owner"||!Regex.IsMatch(args[1],@"^ThinkPadControl-[a-f0-9]{32}$"))
            throw new ArgumentException("Invalid hardware worker arguments.");
        var owner=new SecurityIdentifier(args[3]);
        if(args.Contains("--tpfc"))Environment.SetEnvironmentVariable("THINKPAD_TPFC","1");
        if(owner!=WindowsIdentity.GetCurrent().User)throw new UnauthorizedAccessException("Hardware worker must run as the same Windows user.");
        var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);security.SetOwner(owner);
        // The owner can configure this pipe; other users receive no access.
        security.AddAccessRule(new PipeAccessRule(owner,PipeAccessRights.FullControl,AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),PipeAccessRights.FullControl,AccessControlType.Allow));
        var pipe=NamedPipeServerStreamAcl.Create(args[1],PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,16384,16384,security,additionalAccessRights:PipeAccessRights.TakeOwnership);
        try {
            // Medium UI can reach its elevated worker; low-integrity clients remain blocked.
            MandatoryPipeLabel.Apply(pipe.SafePipeHandle);
            using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(30));
            await pipe.WaitForConnectionAsync(timeout.Token);
            var reader=new StreamReader(pipe,new UTF8Encoding(false),false,16384,true);
            // Windows requires reading client data before RunAsClient can inspect its identity.
            var firstLine=await reader.ReadLineAsync(timeout.Token)??throw new IOException("Client disconnected before handshake.");
            if(firstLine.Length>16384)throw new IOException("Handshake request is too large.");
            SecurityIdentifier? client=null;
            pipe.RunAsClient(()=>client=WindowsIdentity.GetCurrent(true)?.User);
            if(client!=owner)throw new UnauthorizedAccessException("Unexpected hardware worker client.");
            // The worker can start without a prompt, so it also accepts only the app's own bundled runtime.
            if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out var clientId))throw new UnauthorizedAccessException("Could not identify the hardware worker client.");
            using(var process=System.Diagnostics.Process.GetProcessById((int)clientId))
                if(!IsBundledRuntime(process.MainModule?.FileName,AppContext.BaseDirectory))throw new UnauthorizedAccessException("Only ThinkPad Control can connect to its hardware worker.");
            Console.SetIn(new PrefixReader(firstLine,reader));
            Console.SetOut(new StreamWriter(pipe,new UTF8Encoding(false),16384,true){AutoFlush=true});
            return pipe;
        } catch {pipe.Dispose();throw;}
    }
    private sealed class PrefixReader(string firstLine,TextReader reader) : TextReader
    {
        private string? pending=firstLine;
        public override string? ReadLine(){if(pending is null)return reader.ReadLine();var result=pending;pending=null;return result;}
        protected override void Dispose(bool disposing){if(disposing)reader.Dispose();base.Dispose(disposing);}
    }
}
