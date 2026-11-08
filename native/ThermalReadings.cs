// Original application code, MIT. Sensor layout provenance: docs/THERMAL-SENSORS.md.
internal static class ThermalReadings
{
    // Reject firmware sentinels rather than displaying plausible-looking converted values.
    public static float? Celsius(double value) => double.IsFinite(value) && value > 0 && value <= 125 ? (float)value : null;
    public static float? AcpiCelsius(uint tenthsKelvin) => Celsius(tenthsKelvin / 10.0 - 273.15);
    public static float? ApuGfx(long codeName, uint version, long[] table)
    {
        if (RyzenProfile.GfxMapping(codeName, version) is not { } mapping || table.Length != (mapping.TableBytes + 7) / 8) return null;
        var bytes = new byte[table.Length * sizeof(long)];
        Buffer.BlockCopy(table, 0, bytes, 0, bytes.Length);
        return Celsius(BitConverter.ToSingle(bytes, mapping.Offset));
    }
    // Other driver sensors, such as "GPU VR SoC" on Rembrandt, are not the graphics core temperature.
    public static bool IsGpuCoreSensor(string name) => name.Contains("core", StringComparison.OrdinalIgnoreCase) && !name.Contains(" VR ", StringComparison.OrdinalIgnoreCase);
    public static bool IsAmdGpu(string? deviceId) => deviceId is not null &&
        System.Text.RegularExpressions.Regex.IsMatch(deviceId, @"(?:^|[\\&])VEN_1002&DEV_[0-9A-F]{4}(?:&|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    // Only the sole AMD GPU, with no core sensor of its own, can inherit the APU reading.
    // With two AMD GPUs the owner of the reading is unknown, so neither inherits it.
    public static bool InheritsApuReading(string? deviceId, int amdGpuCount) => amdGpuCount == 1 && IsAmdGpu(deviceId);
}
internal sealed record ThermalSensor(string Id, string Group, string HardwareId, string Name, string Type, float? Value, string Unit, string Source);
