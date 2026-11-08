using System.Management;
using System.Runtime.InteropServices;

internal sealed class RyzenTuning : IAsyncDisposable
{
    private readonly CancellationTokenSource stop=new();
    private readonly object operation=new();
    private readonly Task task;
    private RyzenTransport? transport;
    private RyzenController? controller;
    private long sampled;
    private RyzenLimits? current;
    private string reason="Discovering direct Ryzen controls…";
    private string status="No tuning changes requested.";
    private byte initialSource;
    private bool stapmReadOnly;
    private string detectedModel="Discovering Ryzen family";
    [StructLayout(LayoutKind.Sequential)] private struct PowerStatus { public byte Ac,Battery,Percent,Reserved;public uint Life,FullLife; }
    [DllImport("kernel32.dll")] private static extern bool GetSystemPowerStatus(out PowerStatus status);
    private static byte Source()=>GetSystemPowerStatus(out var s)?s.Ac:(byte)255;
    public RyzenTuning(string? cpuName) {task=Task.Run(()=>Poll(cpuName));}
    public object Snapshot {
        get {
            var s=Volatile.Read(ref current);var fresh=s is not null&&Environment.TickCount64-Interlocked.Read(ref sampled)<12000;
            var sameSource=Source()==initialSource&&initialSource!=255;
            return new {available=fresh&&sameSource,reason=!fresh?reason:!sameSource?"Power source changed. Use Hardware > Reconnect hardware access to capture a new tuning baseline.":"",current=fresh?s:null,baseline=controller?.Baseline,codeName=transport?.CodeName,sustainedRoute=transport?.LastSustainedRoute,
                fields=RyzenController.Bounds.Keys.ToDictionary(key=>key,key=>new {available=controller is not null && !controller.Unavailable.ContainsKey(key),restoreAvailable=!(stapmReadOnly&&key=="sustainedWatts"),reason=controller?.Unavailable.GetValueOrDefault(key)??""}),
                ranges=RyzenController.Bounds.ToDictionary(e=>e.Key,e=>{var range=controller?.Range(e.Key)??e.Value;return new {min=range.Min,max=range.Max};}),status=Volatile.Read(ref status),model=detectedModel,persistence="Manual changes only; no startup or automatic reapplication. Connection baseline is not a factory reset."};
        }
    }
    private void Publish() {var s=controller!.Observe();Volatile.Write(ref current,s);Interlocked.Exchange(ref sampled,Environment.TickCount64);Volatile.Write(ref status,controller.Status);}
    private async Task Poll(string? cpuName) {
        try {
            if(CpuPStates.Current().Vendor!="AuthenticAMD")throw new InvalidOperationException("Direct Ryzen tuning applies only to AMD Ryzen processors.");
            using var search=new ManagementObjectSearcher("SELECT Manufacturer, Model, SystemFamily FROM Win32_ComputerSystem");using var rows=search.Get();
            string? model=null;var matched=false;
            foreach(ManagementObject row in rows){using(row){model=Convert.ToString(row["Model"]);var family=Convert.ToString(row["SystemFamily"]);matched=Convert.ToString(row["Manufacturer"])?.Contains("LENOVO",StringComparison.OrdinalIgnoreCase)==true && (family?.Contains("ThinkPad",StringComparison.OrdinalIgnoreCase)==true || System.Text.RegularExpressions.Regex.IsMatch(model??"",@"^(20|21)[A-Z0-9]{2}",System.Text.RegularExpressions.RegexOptions.IgnoreCase));}}
            if(!matched)throw new InvalidOperationException("Direct tuning requires a Lenovo ThinkPad with a recognized Ryzen mobile firmware layout.");
            initialSource=Source();transport=new RyzenTransport();detectedModel=$"{model} · {transport.Profile.Name} · table 0x{transport.TableVersion:X8}";
            controller=new RyzenController(transport.Read,(key,value)=>{if(Source()!=initialSource)throw new InvalidOperationException("Power source changed before the firmware write; inspect current limits.");transport.Write(key,value);});
            // This is a narrow machine quirk, not a family-wide STAPM prohibition.
            stapmReadOnly=transport.CodeName==13&&cpuName?.Contains("5650U",StringComparison.OrdinalIgnoreCase)==true&&(model?.StartsWith("20XG",StringComparison.OrdinalIgnoreCase)==true||model?.StartsWith("20XH",StringComparison.OrdinalIgnoreCase)==true);
            if(stapmReadOnly)controller.Unavailable["sustainedWatts"]="Sustained power is read-only on this hardware.";
            while(!stop.IsCancellationRequested){
                try {lock(operation){Publish();reason="";}}catch(Exception e){Volatile.Write(ref current,null);reason="Ryzen tuning unavailable: "+e.Message;}
                try{await Task.Delay(3000,stop.Token);}catch(OperationCanceledException){break;}
            }
        } catch(Exception e){reason=e.Message;}
        finally{transport?.Dispose();}
    }
    public string Apply(string key,float? value,bool restore) {
        lock(operation){
            if(stapmReadOnly&&key=="sustainedWatts")throw new InvalidOperationException("STAPM is read-only: this adapter could not verify changes through either reviewed route.");
            if(controller is null||current is null||Environment.TickCount64-Interlocked.Read(ref sampled)>=12000)throw new InvalidOperationException("Fresh supported Ryzen telemetry is required.");
            if(Source()!=initialSource||initialSource==255)throw new InvalidOperationException("Power source changed. Use Hardware > Reconnect hardware access before tuning.");
            string result;
            try {result=controller.Apply(key,value,restore);}
            catch {Refresh();Volatile.Write(ref status,controller.Status);throw;}
            // The write is already verified. A failed refresh here must not report it as failed.
            Refresh();Volatile.Write(ref status,controller.Status);return result;
        }
    }
    private void Refresh() {try{Publish();}catch{Volatile.Write(ref current,null);reason="Waiting for the next firmware reading.";}}
    public async ValueTask DisposeAsync(){stop.Cancel();await task;stop.Dispose();}
}




