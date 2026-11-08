// Original MIT code. Unknown/nonfinite readings stay unavailable; genuine zero RPM/load is retained.
internal static class SensorReadings
{
    public static float? Clock(float? value,string name) => Normalize(value,positive:!name.Contains("Effective",StringComparison.OrdinalIgnoreCase));
    public static float? Normalize(float? value,bool temperature=false,bool positive=false)
    {
        if(value is not float number||!float.IsFinite(number))return null;
        if(temperature)return ThermalReadings.Celsius(number);
        return positive&&number<=0?null:number;
    }
}
