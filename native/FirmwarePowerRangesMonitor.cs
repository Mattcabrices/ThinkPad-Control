using System.Management;

// Runs separately from sensor/fan locks. No WMI methods, writes, profile switches
// or probing of rejected wattages; only a fixed capability-data SELECT.
internal sealed class FirmwarePowerRangesMonitor : IAsyncDisposable
{
    private sealed record Sample(FirmwarePowerReport Report,long At);
    private readonly CancellationTokenSource stop=new();
    private readonly Task task;
    private Sample sample=new(FirmwarePowerRanges.Missing("discovering","Checking firmware power ranges…"),Environment.TickCount64);
    public FirmwarePowerRangesMonitor()=>task=Task.Run(Poll);
    public FirmwarePowerReport Snapshot {get{var s=Volatile.Read(ref sample);return FirmwarePowerRanges.Fresh(s.Report,Environment.TickCount64-s.At);}}
    private async Task Poll()
    {
        while(!stop.IsCancellationRequested)
        {
            FirmwarePowerReport report;
            try
            {
                using var search=new ManagementObjectSearcher(new ManagementScope(@"\\.\root\WMI"),
                    new ObjectQuery("SELECT IDs, Capability, DefaultValue, Step, MinValue, MaxValue FROM LENOVO_CAPABILITY_DATA_01"),
                    new System.Management.EnumerationOptions {Timeout=TimeSpan.FromSeconds(2),ReturnImmediately=true});
                using var data=search.Get();var rows=new List<FirmwarePowerRow>();
                foreach(ManagementObject row in data)
                {
                    using(row)
                    {
                        stop.Token.ThrowIfCancellationRequested();
                        if(rows.Count>=256)throw new InvalidOperationException("Too many capability rows.");
                        uint Read(string name)=>row[name] is uint value?value:throw new InvalidOperationException("Invalid capability type.");
                        rows.Add(new(Read("IDs"),Read("Capability"),Read("DefaultValue"),Read("Step"),Read("MinValue"),Read("MaxValue")));
                    }
                }
                report=FirmwarePowerRanges.Decode(rows);
            }
            catch(OperationCanceledException){break;}
            catch(ManagementException e) when(e.ErrorCode==ManagementStatus.InvalidClass||e.ErrorCode==ManagementStatus.NotSupported)
            {report=FirmwarePowerRanges.Missing();}
            catch(UnauthorizedAccessException){report=FirmwarePowerRanges.Missing("access-denied","Firmware power-range access was denied.");}
            catch(ManagementException e) when(e.ErrorCode==ManagementStatus.AccessDenied)
            {report=FirmwarePowerRanges.Missing("access-denied","Firmware power-range access was denied.");}
            catch(Exception){report=FirmwarePowerRanges.Missing("unavailable","Firmware power ranges could not be read.");}
            Volatile.Write(ref sample,new(report,Environment.TickCount64));
            try{await Task.Delay(30000,stop.Token);}catch(OperationCanceledException){break;}
        }
    }
    public async ValueTask DisposeAsync()
    {
        stop.Cancel();
        try{await task.WaitAsync(TimeSpan.FromSeconds(3));}catch(TimeoutException){}
        if(task.IsCompleted)stop.Dispose();
    }
}
