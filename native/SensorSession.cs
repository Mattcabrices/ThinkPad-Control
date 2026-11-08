// Original MIT code. Isolates provider faults without retaining old device readings.
internal sealed record SensorCycle<TDevice,TSensor>(IReadOnlyList<TDevice> Devices,IReadOnlyList<TSensor> Sensors,IReadOnlyList<string> Warnings,bool Complete) where TDevice:class;

internal sealed class SensorSession<TDevice,TSensor> : IDisposable where TDevice:class
{
    private readonly Action close;
    private readonly Func<IEnumerable<TDevice>> roots;
    private readonly Func<TDevice,IEnumerable<TDevice>> children;
    private readonly Action<TDevice> update;
    private readonly Func<TDevice,IEnumerable<TSensor>> sensors;
    private readonly Func<TDevice,string> name;
    private bool closed;
    private bool disposed;
    private string? initializationError;
    public bool Initialized {get;}
    public SensorCycle<TDevice,TSensor> Current {get;private set;}=new([],[],[],false);

    public SensorSession(Action open,Action close,Func<IEnumerable<TDevice>> roots,Func<TDevice,IEnumerable<TDevice>> children,Action<TDevice> update,Func<TDevice,IEnumerable<TSensor>> sensors,Func<TDevice,string> name)
    {
        this.close=close;this.roots=roots;this.children=children;this.update=update;this.sensors=sensors;this.name=name;
        try{open();Initialized=true;}
        catch(Exception e){initializationError="Sensor initialization unavailable: "+e.Message;TryClose();}
    }
    public SensorCycle<TDevice,TSensor> Refresh()
    {
        if(!Initialized||closed||disposed)return Current=new([],[],[initializationError??"Sensor session is closed."],false);
        var devices=new List<TDevice>();var readings=new List<TSensor>();var warnings=new List<string>();
        var seen=new HashSet<TDevice>(ReferenceEqualityComparer.Instance);
        void Visit(TDevice device)
        {
            string label;try{label=name(device);}catch{label="Sensor device";}
            if(!seen.Add(device)){warnings.Add(label+": repeated/cyclic device reference ignored.");return;}
            TDevice[] descendants;TSensor[] fresh;
            try{update(device);fresh=sensors(device).ToArray();descendants=children(device).ToArray();}
            catch(Exception e){warnings.Add(label+": refresh unavailable: "+e.Message);return;}
            devices.Add(device);readings.AddRange(fresh);
            foreach(var child in descendants)Visit(child);
        }
        try{foreach(var root in roots())Visit(root);}catch(Exception e){warnings.Add("Sensor enumeration unavailable: "+e.Message);}
        return Current=new(devices,readings,warnings,warnings.Count==0);
    }
    private void TryClose()
    {
        try{close();closed=true;}
        catch(Exception e){initializationError=(initializationError??"")+" Sensor cleanup unavailable: "+e.Message;}
    }
    public void Dispose(){disposed=true;if(!closed)TryClose();}
}
