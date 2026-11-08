using System.IO.MemoryMappedFiles;
using System.Text;

// Optional client of mews-se/TPFanCtrl2's existing EC engine. No raw EC writes.
// Protocol reference: sharedstate.h a06b26663fa449b9232755a7633eb62de50e2368.
// Upstream protocol has no version field. Enable only for this reviewed layout.
internal sealed class TpfcAdapter : IDisposable
{
    public const string FanId = "tpfc/cooling-system";
    public const int LayoutSize = 7796;
    public const int FullSpeedLevel = 64;
    private readonly MemoryMappedFile mapping;
    private readonly MemoryMappedViewAccessor view;
    private int lastSequence;
    private TimeSpan lastChange;
    private readonly Func<TimeSpan> now;
    private bool observedUpdate;
    private TimeSpan leaseUntil = TimeSpan.Zero;
    private int? pendingSequence;
    private bool restoring;
    private TimeSpan lastRestoreRequest = TimeSpan.Zero;
    public bool OwnsManual { get; private set; }
    public string Status { get; private set; } = "TPFanCtrl2 connected. Read-back determines the current fan mode.";

    public TpfcAdapter(string mapName = @"Global\TPFanControl_State", Func<TimeSpan>? clock = null)
    {
        now=clock ?? (()=>TimeSpan.FromMilliseconds(Environment.TickCount64)); lastChange=now();
        mapping = MemoryMappedFile.OpenExisting(mapName, MemoryMappedFileRights.ReadWrite);
        view = mapping.CreateViewAccessor(0,LayoutSize,MemoryMappedFileAccess.ReadWrite);
        lastSequence = view.ReadInt32(0);
        var mode = view.ReadInt32(12);
        if (mode < 1 || mode > 3) { Dispose(); throw new InvalidOperationException("TPFanCtrl2 state layout is not initialized or compatible."); }
    }
    public record State(int Sequence,int Command,int Acknowledged,int Mode,int RawLevel,int? Rpm,int? SecondaryRpm,int[] Temperatures,bool Fresh);
    public State Read()
    {
        for (var attempt=0;attempt<4;attempt++)
        {
            var seq=view.ReadInt32(0);
            var temps=Enumerable.Range(0,12).Select(i=>view.ReadInt32(40+i*4)).ToArray();
            var state=new State(seq,view.ReadInt32(4),view.ReadInt32(8),view.ReadInt32(12),view.ReadInt32(20),
                Rpm(view.ReadInt32(24),view.ReadInt32(28)),Rpm(view.ReadInt32(32),view.ReadInt32(36)),temps,true);
            Thread.MemoryBarrier();
            if (seq != view.ReadInt32(0)) continue;
            if (seq != lastSequence) { lastSequence=seq; lastChange=now(); observedUpdate=true; }
            return state with { Fresh = observedUpdate && now()-lastChange < TimeSpan.FromSeconds(12) };
        }
        throw new InvalidOperationException("TPFanCtrl2 state changed during snapshot; retry.");
    }
    private static int? Rpm(int lo,int hi) => lo is >=0 and <=255 && hi is >=0 and <=255 && (hi*256+lo)<20000 ? hi*256+lo : null;
    // A T14 Gen 3 has a slot fixed at 1, which must not count as the valid reading this requires.
    public static bool ThermalSafe(State state) => state.Fresh && state.Temperatures.Any(t=>t>=10&&t<85) &&
        state.Temperatures.Where(t=>t>0&&t<128).All(t=>t<85);
    public void Renew(bool active)
    {
        if (active) leaseUntil=now().Add(TimeSpan.FromSeconds(10));
        else if (OwnsManual) Send("auto",null);
    }
    public void Send(string mode,int? level)
    {
        if (mode=="auto" && OwnsManual) restoring=true;
        var state=Read();
        if (mode == "manual")
        {
            if (restoring) throw new InvalidOperationException("Wait for verified firmware restoration before requesting manual control.");
            if (level is not (>=1 and <=7 or FullSpeedLevel)) throw new InvalidOperationException("ThinkPad fan level must be 1–7, or full speed.");
            if (!ThermalSafe(state)) throw new InvalidOperationException("Valid, fresh EC temperatures below 85°C are required.");
            if (state.Command!=state.Acknowledged) throw new InvalidOperationException("Another TPFanCtrl2 command is pending.");
            OwnsManual=true; restoring=false; leaseUntil=now().Add(TimeSpan.FromSeconds(10));
        }
        else if (mode!="auto") throw new InvalidOperationException("Unknown TPFanCtrl2 mode.");
        if (mode=="auto") { restoring=OwnsManual; lastRestoreRequest=now(); }
        // The service processes cmdSmart before cmdMode. -1 selects a mode command.
        view.Write(88,mode=="manual"?3:1); view.Write(92,-1);
        var text=new byte[16]; if(level.HasValue) Encoding.ASCII.GetBytes(level.Value.ToString()).CopyTo(text,0);
        view.WriteArray(96,text,0,text.Length); Thread.MemoryBarrier();
        var sequence=unchecked(view.ReadInt32(4)+1); view.Write(4,sequence); view.Flush(); pendingSequence=sequence;
        Status=mode=="manual" ? "Manual fan level requested; waiting for EC read-back." : "Firmware return requested; waiting for EC read-back.";
        // Keep ownership until auto is acknowledged so the watchdog can retry restoration.
    }
    public void Watchdog()
    {
        var state=Read();
        // A repeated firmware request arrives with nothing owned, and must still clear its own status.
        if(state.Fresh && (restoring || !OwnsManual) && pendingSequence.HasValue && state.Acknowledged==pendingSequence && state.Mode==1 && state.RawLevel==128)
        { OwnsManual=false; restoring=false; pendingSequence=null; Status="Firmware control verified by EC read-back."; }
        else if(state.Fresh && OwnsManual && !restoring && pendingSequence.HasValue && state.Acknowledged==pendingSequence && state.Mode==3 && state.RawLevel is >=1 and <=7 or FullSpeedLevel)
        { pendingSequence=null; Status="Manual fan level verified by EC read-back."; }
        if (!OwnsManual) return;
        if(restoring || now()>=leaseUntil || !ThermalSafe(state))
        {
            // A lost acknowledgement must never leave a pending manual request in place.
            // Allow one normal five-second engine cycle before retrying a BIOS request.
            // Continue restoration even if the UI subsequently renews its lease.
            if(!restoring || now()-lastRestoreRequest>=TimeSpan.FromSeconds(6)) Send("auto",null);
            Status="Fan lease/thermal watchdog requested firmware control.";
        }
    }
    public object FanSnapshot()
    {
        Watchdog(); var s=Read();
        return new {
            id=FanId,name="ThinkPad primary fan · TPFanCtrl2",rpm=s.Fresh?s.Rpm:null,
            // SingleFan=1 mirrors the primary tachometer into fan 2 upstream; it is not a second physical measurement.
            secondaryRpm=(int?)null,
            mode=!s.Fresh?"unknown":s.Mode is 1 or 2 && s.RawLevel==128?"auto":s.Mode==3 && s.RawLevel is >=0 and <=7 or FullSpeedLevel?"manual":s.Mode==2 && s.RawLevel is >=0 and <=7 or FullSpeedLevel?"curve":"unknown",
            level=s.Fresh && s.RawLevel is >=1 and <=7 or FullSpeedLevel?(int?)s.RawLevel:null,percent=(float?)null,
            controlUnit="level",min=1,max=7,
            capability=new { available=s.Fresh,reason=s.Fresh?"":"TPFanCtrl2 engine has stopped publishing. Current cooling state is unverified." }
        };
    }
    public IEnumerable<object> SensorSnapshots()
    {
        var s=Read();
        return s.Temperatures.Select((value,index)=>new {id=$"tpfc/ec/temperature/{index}",group="EC",hardwareId="tpfc",
            name=$"EC temperature {index+1} (unmapped)",type="Temperature",value=s.Fresh&&value>0&&value<128?(float?)value:null,unit="°C"}).Cast<object>();
    }
    public void Dispose() { view.Dispose(); mapping.Dispose(); }
}
