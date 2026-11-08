using System.Management;
using LibreHardwareMonitor.PawnIo;

// Slow firmware queries never take the fan watchdog's lock. Failed/old readings expire.
internal sealed class SupplementalThermals : IAsyncDisposable
{
    private readonly CancellationTokenSource stop = new();
    private readonly Task acpiTask, smuTask;
    private sealed record Sample(ThermalSensor[] Sensors, long At, string? Warning);
    private Sample acpi = new([], 0, "ACPI thermal-zone discovery pending.");
    private Sample smu = new([], 0, "APU GFX temperature discovery pending.");
    public SupplementalThermals()
    {
        acpiTask = Task.Run(ReadAcpi);
        smuTask = Task.Run(ReadSmu);
    }
    private static Sample Fresh(ThermalSensor[] sensors, string? warning = null) => new(sensors, Environment.TickCount64, warning);
    public ThermalSensor[] Sensors => new[] { Volatile.Read(ref acpi), Volatile.Read(ref smu) }
        .Where(s => Environment.TickCount64 - s.At < 12000).SelectMany(s => s.Sensors).ToArray();
    public string[] Warnings => new[] { Volatile.Read(ref acpi), Volatile.Read(ref smu) }
        .Select(s => Environment.TickCount64 - s.At >= 12000 && s.Sensors.Length > 0 ? "Supplemental thermal readings expired; waiting for firmware." : s.Warning)
        .Where(s => s is not null).Cast<string>().Distinct().ToArray();
    private async Task ReadAcpi()
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var search = new ManagementObjectSearcher(new ManagementScope(@"\\.\root\WMI"),
                    new ObjectQuery("SELECT InstanceName, CurrentTemperature FROM MSAcpi_ThermalZoneTemperature"),
                    new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(2), ReturnImmediately = true });
                using var rows = search.Get();
                var sensors = new List<ThermalSensor>();
                foreach (ManagementObject row in rows)
                {
                    using (row)
                    {
                        var name = Convert.ToString(row["InstanceName"]) ?? "Unknown zone";
                        var value = row["CurrentTemperature"] is null ? null : ThermalReadings.AcpiCelsius(Convert.ToUInt32(row["CurrentTemperature"]));
                        sensors.Add(new("acpi/" + name, "Firmware", "acpi/thermal-zone", name, "Temperature", value, "°C", "Windows ACPI thermal zone · physical location unspecified"));
                    }
                }
                Volatile.Write(ref acpi, Fresh(sensors.OrderBy(s => s.Name, StringComparer.Ordinal).ToArray(), sensors.Any(s => s.Value.HasValue) ? null : "Firmware exposes no valid ACPI thermal-zone temperature."));
            }
            catch (Exception e) { Volatile.Write(ref acpi, Fresh([], "ACPI thermal zones unavailable: " + e.Message)); }
            try { await Task.Delay(3000, stop.Token); } catch (OperationCanceledException) { break; }
        }
    }
    private async Task ReadSmu()
    {
        // Other CPU vendors have no Ryzen SMU. This is expected, not something to warn about.
        if (CpuPStates.Current().Vendor != "AuthenticAMD") { Volatile.Write(ref smu, new([], 0, null)); return; }
        RyzenSmu? module = null;
        try
        {
            module = new RyzenSmu();
            var code = module.GetCodeName();
            module.ResolvePmTable(out var version, out _);
            if (code == 0 || version == 0) { Volatile.Write(ref smu, Fresh([], "Enable hardware access to read the APU GFX temperature.")); return; }
            if (RyzenProfile.GfxMapping(code, version) is not { } mapping) { Volatile.Write(ref smu, Fresh([], $"No reviewed APU GFX mapping for codename {code}, table 0x{version:X8}; other GPUs use their driver sensors.")); return; }
            while (!stop.IsCancellationRequested)
            {
                try
                {
                    module.UpdatePmTable(); // Firmware telemetry refresh only; no power/clock/fan settings.
                    var value = ThermalReadings.ApuGfx(code, version, module.ReadPmTable((mapping.TableBytes + 7) / 8));
                    Volatile.Write(ref smu, Fresh([new("smu/apu/gfx-temperature", "APU", "smu/apu", "GFX temperature", "Temperature", value, "°C", $"Ryzen SMU · codename {code} · table 0x{version:X8} · offset 0x{mapping.Offset:X}")], value.HasValue ? null : "SMU returned an invalid GFX temperature."));
                }
                catch (Exception e) { Volatile.Write(ref smu, Fresh([], "APU GFX temperature unavailable: " + e.Message)); }
                try { await Task.Delay(3000, stop.Token); } catch (OperationCanceledException) { break; }
            }
        }
        catch (Exception e) { Volatile.Write(ref smu, Fresh([], "APU GFX initialization unavailable: " + e.Message)); }
        finally { try { module?.Close(); } catch (Exception e) { Console.Error.WriteLine("SMU cleanup: " + e.Message); } }
    }
    public async ValueTask DisposeAsync()
    {
        stop.Cancel();
        await Task.WhenAll(acpiTask, smuTask);
        stop.Dispose();
    }
}


