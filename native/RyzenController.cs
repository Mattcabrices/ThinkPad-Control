// Original MIT implementation. Protocol facts/provenance: docs/RYZEN-TUNING.md.
internal sealed record RyzenLimits(float SustainedWatts, float FastWatts, float SlowWatts, float TemperatureLimit);
internal sealed class RyzenController(Func<RyzenLimits> read, Action<string,float> write)
{
    public static readonly IReadOnlyDictionary<string,(float Min,float Max)> Bounds = new Dictionary<string,(float,float)> {
        ["sustainedWatts"]=(5,25),["fastWatts"]=(5,40),["slowWatts"]=(5,30),["temperatureLimit"]=(60,90)
    };
    public readonly System.Collections.Concurrent.ConcurrentDictionary<string,string> Unavailable = new();
    public RyzenLimits? Baseline { get; private set; }
    public string Status { get; private set; } = "No tuning changes requested.";
    private readonly Dictionary<string,float> expected = new();
    // Machines with higher firmware limits may return to them, but never go above what firmware itself reported.
    public (float Min,float Max) Range(string key) {
        var bound=Bounds[key];
        return Baseline is null?bound:(bound.Min,MathF.Max(bound.Max,MathF.Floor(Value(Baseline,key)*10)/10));
    }
    public static float Value(RyzenLimits s,string key) => key switch {
        "sustainedWatts"=>s.SustainedWatts,"fastWatts"=>s.FastWatts,"slowWatts"=>s.SlowWatts,"temperatureLimit"=>s.TemperatureLimit,
        _=>throw new ArgumentException("Unknown Ryzen tuning setting.")
    };
    public static void Validate(RyzenLimits s) {
        foreach(var key in Bounds.Keys) if(!float.IsFinite(Value(s,key)) || Value(s,key)<=0 || Value(s,key)>(key=="temperatureLimit"?110:100))
            throw new InvalidOperationException("Firmware returned invalid Ryzen limits.");
    }
    public RyzenLimits Observe() {
        var s=read();Validate(s);Baseline??=s;
        if(expected.Any(e=>Math.Abs(Value(s,e.Key)-e.Value)>0.1f))Status="Firmware changed one or more requested limits. Values have not been reapplied.";
        return s;
    }
    public string Apply(string key,float? requested,bool restore) {
        if(!Bounds.ContainsKey(key))throw new ArgumentException("Unsupported Ryzen setting.");
        if(!restore&&Unavailable.TryGetValue(key,out var blocked))throw new InvalidOperationException(blocked);
        var before=Observe();var target=restore?Value(Baseline!,key):requested??float.NaN;var bound=Range(key);
        if(!restore&&((key=="temperatureLimit"&&target!=MathF.Round(target))||!float.IsFinite(target)||target<bound.Min||target>bound.Max||Math.Abs(target*10-MathF.Round(target*10))>0.01f))
            throw new ArgumentException("Ryzen setting is outside the supported range or precision (0.1 units).");
        try {
            write(key,target);
            if(Settle(key,target,2500,out var readError) is {} after){expected[key]=target;return Status="SMU setting verified: "+key+" = "+Text(target)+(restore?" (connection baseline).":".")+OtherChanges(key,restore?Baseline!:before,after,restore);}
            throw new InvalidOperationException(readError is null?"SMU read-back did not match the requested value; firmware may have capped or overwritten it.":"SMU read-back failed: "+readError.Message);
        } catch(Exception original) {
            Unavailable[key]="Firmware did not accept a verified change to this setting. Reconnect hardware access to retest.";
            try {write(key,Value(before,key));if(Settle(key,Value(before,key),1000,out var rollbackError) is null)throw new InvalidOperationException(rollbackError is null?"Rollback read-back mismatch.":"Rollback read-back failed: "+rollbackError.Message);}
            catch(Exception recovery){Status="Ryzen change failed; restoration UNVERIFIED: "+recovery.Message;throw new InvalidOperationException(Status,original);}
            Status="Ryzen change failed; previous observed value restored. "+original.Message;throw new InvalidOperationException(Status,original);
        }
    }
    // A failed firmware table read says nothing about the write, so keep reading until the deadline.
    private RyzenLimits? Settle(string key,float target,int milliseconds,out Exception? readError) {
        readError=null;var deadline=Environment.TickCount64+milliseconds;
        do {
            Thread.Sleep(150);
            try {var after=read();Validate(after);readError=null;if(Math.Abs(Value(after,key)-target)<=0.1f)return after;}
            catch(Exception e){readError=e;}
        } while(Environment.TickCount64<deadline);
        return null;
    }
    private static string Text(float value)=>value.ToString("0.#",System.Globalization.CultureInfo.InvariantCulture);
    // A T14 Gen 3 moved its sustained limit when only the fast limit was written, so say so.
    private static string OtherChanges(string key,RyzenLimits reference,RyzenLimits after,bool restore) {
        var moved=Bounds.Keys.Where(k=>k!=key&&Math.Abs(Value(after,k)-Value(reference,k))>0.1f).Select(k=>k+" = "+Text(Value(after,k))).ToList();
        return moved.Count==0?"":(restore?" Still different from the connection baseline: ":" Firmware also changed: ")+string.Join(", ",moved)+".";
    }
}



