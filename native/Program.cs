using System.Text.Json;
using LibreHardwareMonitor.Hardware;
using var privatePipe = await PrivatePipe.Connect(args);

// Private stdio protocol. Never bind a privileged sensor bridge to a network port.
var computer = new Computer { IsCpuEnabled = true, IsGpuEnabled = true,
    IsMotherboardEnabled = true, IsControllerEnabled = true, IsMemoryEnabled = true };
var gate = new object();
var tpfcGate = new object();
var allowed = (Environment.GetEnvironmentVariable("THINKPAD_FAN_ALLOWLIST") ?? "")
    .Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
var owned = new Dictionary<string, IControl>(StringComparer.Ordinal);
var lease = 0L;
var restorePending = false;
var lastReason = "No manual fan control has been requested by this worker.";
var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
SupplementalThermals? thermals = null;
RyzenTuning? ryzen = null;
object? cpuStates = null;
SensorSession<IHardware,ISensor>? monitoring = null;
var cpuBrand=CpuPStates.BrandName();
TpfcAdapter? tpfc = null;
string? tpfcError = null;
if (Environment.GetEnvironmentVariable("THINKPAD_TPFC") == "1")
{
    try { TpfcEngineTrust.EnsureTrustedService(); tpfc = new TpfcAdapter(); }
    catch (Exception e) { tpfcError = "TPFanCtrl2 unavailable: " + e.Message; }
}

List<IHardware> Hardware() => monitoring?.Current.Devices.ToList()??[];
List<ISensor> Sensors()
{
    return monitoring?.Refresh().Sensors.ToList()??[];
}
string Group(IHardware hardware)
{
    var type = hardware.HardwareType.ToString();
    if (type == "Cpu") return "CPU";
    if (type.StartsWith("Gpu")) return "GPU";
    if (type is "Motherboard" or "SuperIO" or "EmbeddedController") return "Motherboard";
    return type;
}
bool TemperatureSafe(List<ISensor> sensors)
{
    if(monitoring?.Current.Complete!=true)return false;
    var cpu = sensors.Where(s => Group(s.Hardware) == "CPU" && s.SensorType == SensorType.Temperature).ToList();
    if (!cpu.Any(s => s.Value.HasValue && s.Value > 0 && s.Value < 85)) return false;
    foreach (var gpu in Hardware().Where(h => Group(h) == "GPU"))
        if (!sensors.Any(s => s.Hardware == gpu && s.SensorType == SensorType.Temperature && s.Value > 0 && s.Value < 85)) return false;
    var critical = sensors.Where(s => s.SensorType == SensorType.Temperature &&
        Group(s.Hardware) is "CPU" or "GPU" or "Motherboard");
    return critical.All(s => !s.Value.HasValue || (s.Value > 0 && s.Value < 85));
}
float? Reading(ISensor sensor) => sensor.SensorType==SensorType.Clock ? SensorReadings.Clock(sensor.Value,sensor.Name) :
    SensorReadings.Normalize(sensor.Value,sensor.SensorType==SensorType.Temperature,sensor.SensorType==SensorType.Power&&Group(sensor.Hardware)=="CPU");
void Restore(string reason)
{
    var failures = new List<string>();
    lock(tpfcGate)if (tpfc?.OwnsManual == true)
    {
        try { tpfc.Send("auto",null); }
        catch (Exception e) { failures.Add("TPFanCtrl2: " + e.Message); }
    }
    foreach (var entry in owned.ToArray())
    {
        try { entry.Value.SetDefault(); owned.Remove(entry.Key); }
        catch (Exception e) { failures.Add(entry.Key + ": " + e.Message); }
    }
    restorePending = failures.Count > 0;
    lastReason = failures.Count == 0 ? reason : "Firmware restoration FAILED: " + string.Join("; ", failures);
    if (failures.Count > 0) Console.Error.WriteLine(lastReason);
}
bool IsFanControl(ISensor s) => s.Control is not null &&
    (s.SensorType == SensorType.Fan || (s.SensorType == SensorType.Control && s.Name.Contains("fan", StringComparison.OrdinalIgnoreCase)));
object Snapshot()
{
    var sensors = Sensors();
    var supplemental = thermals?.Sensors ?? [];
    if (restorePending || owned.Count > 0 && (!TemperatureSafe(sensors) || Environment.TickCount64 >= lease))
        Restore("Manual control released: lease expired or temperatures unsafe/unavailable.");
    var fans = sensors.Where(IsFanControl).Select(s => new {
        id = s.Identifier.ToString(), name = s.Hardware.Name + " · " + s.Name,
        rpm = s.SensorType == SensorType.Fan ? Reading(s) : (float?)null,
        percent = s.Control!.ControlMode == ControlMode.Software ? SensorReadings.Normalize(s.Control.SoftwareValue) : s.SensorType == SensorType.Control ? Reading(s) : null,
        mode = s.Control.ControlMode == ControlMode.Software ? "manual" : "auto",
        capability = new { available = tpfc is null && monitoring?.Current.Complete==true && allowed.Contains(s.Identifier.ToString()), reason = tpfc is not null ? "TPFanCtrl2 owns cooling. Use its fan control." : monitoring?.Current.Complete!=true ? "Sensor refresh is incomplete; manual LHM control requires fresh thermal readings." : allowed.Contains(s.Identifier.ToString()) ? "" : "Detected control is read-only until its identifier is explicitly allowlisted. See Setup." }
    }).ToList();
    // Tachometers with no writable control remain visible independently; do not infer fan mapping.
    var readOnly = sensors.Where(s => s.SensorType == SensorType.Fan && !IsFanControl(s)).Select(s => new {
        id = s.Identifier.ToString(), name = s.Hardware.Name + " · " + s.Name,
        rpm = Reading(s), percent = (float?)null, mode = "unknown",
        capability = new { available = false, reason = "RPM sensor detected; no writable fan interface exposed." }
    });
    var fanObjects = fans.Cast<object>().Concat(readOnly.Cast<object>()).ToList();
    object[] tpfcSensors=[];bool tpfcOwned;string? tpfcStatus;
    lock(tpfcGate) {
        if(tpfc is not null){fanObjects.Insert(0,tpfc.FanSnapshot());tpfcSensors=tpfc.SensorSnapshots().ToArray();}
        tpfcOwned=tpfc?.OwnsManual==true;tpfcStatus=tpfc?.Status;
    }
    float? Pick(IHardware gpu, SensorType type, string preferred) => sensors
        .Where(s => s.Hardware == gpu && s.SensorType == type && s.Value.HasValue)
        .OrderByDescending(s => s.Name.Contains(preferred, StringComparison.OrdinalIgnoreCase)).Select(Reading).FirstOrDefault();
    return new {
        cpuName = Hardware().FirstOrDefault(h => h.HardwareType.ToString() == "Cpu")?.Name??cpuBrand,
        sensorMonitor = new {initialized=monitoring?.Initialized??false,complete=monitoring?.Current.Complete??false,warningCount=monitoring?.Current.Warnings.Count??0},
        driver = DriverDiagnostics.Inspect(),
        ryzen = ryzen?.Snapshot,
        cpuStates,
        fanCurve = tpfc is null ? null : FanCurveConfig.ReadInstalled(),
        sensors = sensors.Select(s => new {
            id = s.Identifier.ToString(), group = Group(s.Hardware), hardwareId = s.Hardware.Identifier.ToString(),
            name = s.Name, type = s.SensorType.ToString(), value = Reading(s),
            unit = s.SensorType switch { SensorType.Temperature => "°C", SensorType.Fan => "RPM", SensorType.Load or SensorType.Control => "%", SensorType.Clock => "MHz", SensorType.Power => "W", SensorType.Voltage => "V", SensorType.Data => "GB", SensorType.SmallData => "MB", _ => "" }
        }).Cast<object>().Concat(tpfcSensors).Concat(supplemental),
        gpus = Hardware().Where(h => Group(h) == "GPU").Select(h => new {
            id = h.Identifier.ToString(), name = h.Name,
            vendor = h.HardwareType.ToString() == "GpuAmd" ? "AMD" : h.HardwareType.ToString() == "GpuNvidia" ? "NVIDIA" : "Intel",
            temperature = sensors.Where(s => s.Hardware == h && s.SensorType == SensorType.Temperature && ThermalReadings.IsGpuCoreSensor(s.Name)).Select(Reading).FirstOrDefault(v => v.HasValue) ?? (monitoring?.Current.Complete==true && h is LibreHardwareMonitor.Hardware.Gpu.GenericGpu gpu && ThermalReadings.InheritsApuReading(gpu.DeviceId,Hardware().Count(x=>x is LibreHardwareMonitor.Hardware.Gpu.GenericGpu g&&ThermalReadings.IsAmdGpu(g.DeviceId))) ? supplemental.FirstOrDefault(s => s.Group == "APU")?.Value : null), load = Pick(h,SensorType.Load,"core"),
            clock = Pick(h,SensorType.Clock,"core"), power = Pick(h,SensorType.Power,"package"),
            memoryUsed = Pick(h,SensorType.SmallData,"used"), memoryTotal = Pick(h,SensorType.SmallData,"total")
        }),
        // The last fan reason only matters while software holds a fan or a restoration is outstanding.
        fans = fanObjects, warnings = new[] { tpfcOwned || owned.Count > 0 || restorePending ? lastReason : null, tpfcStatus, tpfcError }.Where(s=>s is not null).Concat(thermals?.Warnings ?? []).Concat(monitoring?.Current.Warnings??[])
    };
}

using var monitorSession=new SensorSession<IHardware,ISensor>(computer.Open,computer.Close,()=>computer.Hardware,h=>h.SubHardware,h=>h.Update(),h=>h.Sensors,h=>h.Identifier.ToString());
monitoring=monitorSession;
Sensors();
thermals = new SupplementalThermals();
ryzen = new RyzenTuning(Hardware().FirstOrDefault(h => Group(h) == "CPU")?.Name??cpuBrand);
cpuStates = CpuPStates.Discover();
using var watchdog = new Timer(_ => IndependentWatchdog.Tick(gate,()=>{
    lock(tpfcGate) {
        try{tpfc?.Watchdog();}
        catch(Exception e) {
            tpfcError="TPFanCtrl2 watchdog unavailable: "+e.Message;
            try{if(tpfc?.OwnsManual==true)tpfc.Send("auto",null);}catch(Exception recovery){tpfcError+="; firmware recovery unverified: "+recovery.Message;}
        }
    }
},()=>{
        if (restorePending) { Restore("Retrying failed firmware restoration."); return; }
        if (owned.Count == 0) return;
        try {
            if (Environment.TickCount64 >= lease || !TemperatureSafe(Sensors())) Restore("Thermal/lease watchdog requested firmware fan control.");
        } catch { Restore("Sensor failure: firmware control requested."); }
}), null, 1000, 1000);
try
{
    string? line;
    while ((line = Console.ReadLine()) is not null)
    {
        int? id = null;
        // Powercfg/NVIDIA waits never hold the sensor/watchdog lock.
        if(line.Length<=16384)
        {
            try
            {
                using var envelope=JsonDocument.Parse(line);
                var operation=envelope.RootElement.GetProperty("op").GetString();
                if(operation=="fan-curve")
                {
                    id=envelope.RootElement.GetProperty("id").GetInt32();
                    try {
                        if(tpfc is null)throw new InvalidOperationException("Fan curves need the bundled fan engine.");
                        lock(tpfcGate)if(tpfc.OwnsManual)throw new InvalidOperationException("Return the fan to firmware before changing its curve.");
                        var rowsElement=envelope.RootElement.GetProperty("rows");
                        int[][]? rows=rowsElement.ValueKind==JsonValueKind.Null?null:rowsElement.Deserialize<int[][]>();
                        var masks=envelope.RootElement.TryGetProperty("masks",out var masksElement)&&masksElement.ValueKind==JsonValueKind.Array?masksElement.Deserialize<int[][]>():null;
                        FanCurveConfig.Apply(rows,masks,mode=>{
                            int start;lock(tpfcGate)start=tpfc.Read().Sequence;
                            var deadline=Environment.TickCount64+25000;
                            while(Environment.TickCount64<deadline){
                                Thread.Sleep(1000);
                                lock(tpfcGate){var s=tpfc.Read();if(s.Sequence!=start&&s.Fresh&&s.Mode==mode)return true;}
                            }
                            return false;
                        });
                        Console.WriteLine(JsonSerializer.Serialize(new{id,result="Fan engine configuration applied."},jsonOptions));
                    } catch(Exception e){Console.WriteLine(JsonSerializer.Serialize(new{id,error=e.Message},jsonOptions));}
                    continue;
                }
                if(operation is "cpu-boost" or "gpu-boost" or "ryzen-tune")
                {
                    id=envelope.RootElement.GetProperty("id").GetInt32();
                    try {
                        if(operation=="ryzen-tune") {
                            if(ryzen is null)throw new InvalidOperationException("Ryzen adapter unavailable.");
                            var c=envelope.RootElement;var restore=c.GetProperty("restore").GetBoolean();
                            var answer=ryzen.Apply(c.GetProperty("setting").GetString()??"",restore?null:c.GetProperty("value").GetSingle(),restore);
                            Console.WriteLine(JsonSerializer.Serialize(new{id,result=answer},jsonOptions));continue;
                        }
                        var enabled=envelope.RootElement.GetProperty("enabled").GetBoolean();
                        var result=operation=="cpu-boost"?PowerPolicy.Apply(envelope.RootElement.GetProperty("source").GetString()??"",enabled):
                            PowerPolicy.ApplyGpu(envelope.RootElement.GetProperty("gpuId").GetString()??"",enabled);
                        Console.WriteLine(JsonSerializer.Serialize(new{id,result},jsonOptions));
                    } catch(Exception e){Console.WriteLine(JsonSerializer.Serialize(new{id,error=e.Message},jsonOptions));}
                    continue;
                }
            } catch(JsonException) { } catch(KeyNotFoundException) { } catch(InvalidOperationException) { }
        }
        lock (gate)
        {
            try
            {
                if (line.Length > 16384) throw new InvalidOperationException("Request too large.");
                using var document = JsonDocument.Parse(line);
                var command = document.RootElement;
                id = command.GetProperty("id").GetInt32();
                var op = command.GetProperty("op").GetString();
                object result;
                if (op == "snapshot") result = Snapshot();
                else if (op == "diagnostics") result = new { driver=DriverDiagnostics.Inspect(),report=monitoring.Initialized?computer.GetReport():"Sensor provider initialization unavailable; see snapshot warnings." };
                else if (op == "lease")
                {
                    lock(tpfcGate)tpfc?.Renew(command.GetProperty("active").GetBoolean());
                    if (command.GetProperty("active").GetBoolean()) lease = Environment.TickCount64 + 10000;
                    else Restore("Browser disconnected: firmware control requested.");
                    result = new { ok = true };
                }
                else if (op == "fan")
                {
                    var fanId = command.GetProperty("fanId").GetString() ?? "";
                    var mode = command.GetProperty("mode").GetString();
                    if (fanId == TpfcAdapter.FanId)
                    {
                        lock(tpfcGate) {
                            if(tpfc is null) throw new InvalidOperationException("TPFanCtrl2 adapter is not connected.");
                            tpfc.Send(mode ?? "",mode=="manual"?command.GetProperty("level").GetInt32():null);
                        }
                        result=Snapshot();
                        Console.WriteLine(JsonSerializer.Serialize(new { id, result },jsonOptions));
                        continue;
                    }
                    var sensors = Sensors();
                    var sensor = sensors.FirstOrDefault(s => s.Identifier.ToString() == fanId && IsFanControl(s));
                    if (sensor is null || !allowed.Contains(fanId)) throw new InvalidOperationException("Fan not detected or allowlisted.");
                    if (mode == "auto")
                    {
                        sensor.Control!.SetDefault(); owned.Remove(fanId); lastReason = "Firmware control requested.";
                    }
                    else if (mode == "manual")
                    {
                        if(restorePending) throw new InvalidOperationException("Wait for failed firmware restoration to complete before applying manual control.");
                        if(tpfc is not null) throw new InvalidOperationException("TPFanCtrl2 owns cooling; use its fan control.");
                        var percent = command.GetProperty("percent").GetInt32();
                        if (percent < 30 || percent > 100 || percent < sensor.Control!.MinSoftwareValue || percent > sensor.Control.MaxSoftwareValue)
                            throw new InvalidOperationException("Fan percentage outside permitted bounds.");
                        if (!TemperatureSafe(sensors)) throw new InvalidOperationException("Manual mode requires valid CPU/GPU temperatures below 85°C.");
                        owned[fanId] = sensor.Control; // Own before write, so partial failures also get restored.
                        sensor.Control.SetSoftware(percent); lease = Environment.TickCount64 + 10000;
                        lastReason = "Manual fan control active with a 10-second lease.";
                    }
                    else throw new InvalidOperationException("Unknown fan mode.");
                    result = Snapshot();
                }
                else throw new InvalidOperationException("Unknown bridge operation.");
                Console.WriteLine(JsonSerializer.Serialize(new { id, result },jsonOptions));
            }
            catch (Exception e)
            {
                Restore("Command error: firmware control requested.");
                Console.WriteLine(JsonSerializer.Serialize(new { id, error = e.Message },jsonOptions));
            }
        }
    }
}
finally { lock(gate) { Restore("Bridge disconnected: firmware control requested."); } if (ryzen is not null) await ryzen.DisposeAsync(); if (thermals is not null) await thermals.DisposeAsync(); lock(gate) { lock(tpfcGate){tpfc?.Dispose();tpfc=null;} monitorSession.Dispose(); } }



