// Original MIT decoder. Protocol facts: docs/FIRMWARE-POWER-LIMITS.md.
// Advisory metadata only: this type never changes tuning ranges or settings.
internal sealed record FirmwarePowerRow(uint Id,uint Capability,uint DefaultValue,uint Step,uint MinValue,uint MaxValue);
internal sealed record FirmwarePowerRange(string Field,int ProfileId,string Profile,string CapabilityId,
    uint MinimumWatts,uint DefaultWatts,uint MaximumWatts,uint StepWatts);
internal sealed record FirmwarePowerReport(bool Available,string Status,string Reason,FirmwarePowerRange[] Limits,
    string? ReadAt=null,string Source="Lenovo WMI · LENOVO_CAPABILITY_DATA_01",bool ReadOnly=true);
internal static class FirmwarePowerRanges
{
    public static FirmwarePowerReport Missing(string status="not-reported",string reason="Not reported by this firmware.")=>new(false,status,reason,[]);
    public static FirmwarePowerReport Decode(IEnumerable<FirmwarePowerRow> input)
    {
        var rows=input.Take(257).ToArray();
        if(rows.Length>256)return Missing("invalid","Firmware power-range data exceeded the supported size.");
        var limits=new List<FirmwarePowerRange>();
        foreach(var group in rows.GroupBy(r=>r.Id))
        {
            // Ambiguous instances must not be resolved by picking the highest.
            if(group.Count()!=1)continue;
            var row=group.Single();
            if((row.Id>>24)!=1||(row.Id&255)!=0||(row.Capability&1)==0||(row.Capability&~7u)!=0)continue;
            var field=((row.Id>>16)&255) switch {1=>"cpuAverageWatts",2=>"cpuSustainedWatts",3=>"cpuBurstWatts",5=>"apuSustainedWatts",_=>null};
            if(field is null||row.MaxValue==0||row.MaxValue>500||row.MinValue>row.MaxValue||
                row.DefaultValue<row.MinValue||row.DefaultValue>row.MaxValue||row.Step>500||
                row.Step==0&&row.MinValue!=row.MaxValue)continue;
            var profile=(int)((row.Id>>8)&255);
            var label=profile switch {0=>"Platform-defined",255=>"Custom",_=>$"Profile {profile}"};
            limits.Add(new(field,profile,label,$"0x{row.Id:X8}",row.MinValue,row.DefaultValue,row.MaxValue,row.Step));
        }
        return limits.Count==0?Missing():new(true,"reported","",limits.OrderBy(v=>v.ProfileId).ThenBy(v=>v.Field).ToArray(),DateTimeOffset.UtcNow.ToString("O"));
    }
    public static FirmwarePowerReport Fresh(FirmwarePowerReport report,long ageMilliseconds)=>ageMilliseconds is >=0 and <60000
        ?report:Missing("stale","Firmware power-range data expired; waiting for a new read.");
}
