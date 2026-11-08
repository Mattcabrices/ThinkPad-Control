// Original MIT code. Writes only validated fan curves, offsets and manual temperature policy.
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

internal static class FanCurveConfig
{
    public const int FirmwareLevel=128,MaximumLevel=64,ModeFirmware=1,ModeCurve=2;
    private static readonly Regex ActiveLine=new(@"^Active=\d[ \t]*\r?$",RegexOptions.Multiline);
    private static readonly Regex LevelLine=new(@"^Level=.*(?:\r?\n|$)",RegexOptions.Multiline);
    private static readonly Regex OffsetLine=new(@"^SensorOffset(\d+)=.*(?:\r?\n|$)",RegexOptions.Multiline);
    private static readonly Regex DormantOffsetLine=new(@"^// ThinkPadControlDormantAdjustment(\d+)=.*(?:\r?\n|$)",RegexOptions.Multiline);
    private static readonly Regex ManualLimitLine=new(@"^ManModeExit=([^\r\n]*)(?:\r?\n|$)",RegexOptions.Multiline);
    private static readonly Regex ManualAutomaticLine=new(@"^// ThinkPadControlManualLimitAutomatic=([^\r\n]*)(?:\r?\n|$)",RegexOptions.Multiline);
    private static string IniPath=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ThinkPad Control","engine","TPFanControl.ini");

    // Checked here as well as in the app: callers supply only numbers, and the top must be maximum fan speed.
    public static void Validate(int[][] rows)
    {
        if(rows.Length is <2 or >16)throw new InvalidOperationException("A fan curve has an invalid number of rows.");
        for(var i=0;i<rows.Length;i++)
        {
            if(rows[i].Length!=2||rows[i][0] is <0 or >115||rows[i][1] is not (>=0 and <=7 or MaximumLevel))throw new InvalidOperationException("A fan curve row is outside the permitted range.");
            if(i>0&&(rows[i][0]<=rows[i-1][0]||rows[i][1]<=rows[i-1][1]))throw new InvalidOperationException("Fan curve rows must rise in temperature and level.");
        }
        if(rows[^1][1]!=MaximumLevel||rows[^2][1]!=7)throw new InvalidOperationException("A fan curve must reach level 7 and then maximum fan speed.");
    }
    // A flat slot's reading is lowered by a fixed amount, not hidden. Slot 0 is the reference and is never changed.
    public static void ValidateMasks(int[][] masks)
    {
        if(masks.Length>6)throw new InvalidOperationException("Too many sensor adjustments.");
        foreach(var mask in masks)if(mask.Length!=2||mask[0] is <1 or >11||mask[1] is <1 or >70)throw new InvalidOperationException("A sensor adjustment is outside the permitted range.");
        if(masks.Select(m=>m[0]).Distinct().Count()!=masks.Length)throw new InvalidOperationException("A sensor can only be adjusted once.");
    }
    // Firmware has no active adjustments. Keep the earlier valid offsets only as
    // comments in this same protected configuration for an explicit curve restore.
    public static string Rewrite(string ini,int[][]? rows,int[][]? masks=null)
    {
        var previous=Parse(ini);
        var dormant=rows is null?(previous?.Active==ModeCurve?previous.Masks:previous?.DormantMasks??[]):[];
        try{ValidateMasks(dormant);}catch(InvalidOperationException){dormant=[];}
        masks=rows is null?[]:masks??[];
        ValidateMasks(masks);
        ini=OffsetLine.Replace(ini,"");
        ini=DormantOffsetLine.Replace(ini,"");
        if(rows is not null)Validate(rows);
        if(ActiveLine.Matches(ini).Count!=1)throw new InvalidOperationException("The fan engine configuration has an unexpected layout.");
        var levels=LevelLine.Matches(ini);
        if(levels.Count==0)throw new InvalidOperationException("The fan engine configuration has an unexpected layout.");
        var newline=levels[0].Value.EndsWith("\r\n",StringComparison.Ordinal)||!levels[0].Value.EndsWith('\n')?"\r\n":"\n";
        var block=new StringBuilder();
        foreach(var row in rows??[[0,FirmwareLevel]])block.Append($"Level={row[0]} {row[1]} 0 0{newline}");
        // The engine subtracts this when reading the sensor. The wide range stops it being subtracted twice.
        foreach(var mask in masks)block.Append($"SensorOffset{mask[0]+1}={mask[1]} -128 127{newline}");
        foreach(var mask in dormant)block.Append($"// ThinkPadControlDormantAdjustment{mask[0]+1}={mask[1]}{newline}");
        var start=levels[0].Index;
        var result=LevelLine.Replace(ini,"");
        result=result.Insert(start,block.ToString());
        return ActiveLine.Replace(result,m=>$"Active={(rows is null?ModeFirmware:ModeCurve)}"+(m.Value.EndsWith('\r')?"\r":""),1);
    }
    public static (int Celsius,bool Automatic) ManualLimit(string ini) {
        var limits=ManualLimitLine.Matches(ini);var modes=ManualAutomaticLine.Matches(ini);
        if(limits.Count>1||modes.Count>1||limits.Count==1&&(!int.TryParse(limits[0].Groups[1].Value.Trim(),out var value)||value is <60 or >110)||
           modes.Count==1&&modes[0].Groups[1].Value.Trim() is not ("0" or "1"))throw new InvalidOperationException("The fan engine's manual temperature policy is invalid.");
        return (limits.Count==0?85:int.Parse(limits[0].Groups[1].Value.Trim()),modes.Count==0||modes[0].Groups[1].Value.Trim()=="1");
    }
    public static string RewriteManualLimit(string ini,int limit,bool automatic) {
        if(limit is <60 or >110)throw new InvalidOperationException("Manual fan temperature limit must be 60–110°C.");
        _=ManualLimit(ini);
        var newline=ini.Contains("\r\n",StringComparison.Ordinal)?"\r\n":"\n";
        var policy=$"ManModeExit={limit}{newline}// ThinkPadControlManualLimitAutomatic={(automatic?1:0)}{newline}";
        var result=ManualAutomaticLine.Replace(ini,"");
        return ManualLimitLine.IsMatch(result)?ManualLimitLine.Replace(result,_=>policy,1):result.TrimEnd('\r','\n')+newline+policy;
    }
    public static int ReadManualLimitInstalled() => ManualLimit(File.ReadAllText(IniPath,Encoding.Latin1)).Celsius;
    public sealed record Curve(int Active,int[][] Rows,int[][] Masks) {public int[][] DormantMasks {get;init;}=[];}
    public static Curve? Parse(string ini)
    {
        var active=ActiveLine.Match(ini);
        if(!active.Success||!int.TryParse(active.Value.AsSpan(7,1),out var mode))return null;
        var rows=new List<int[]>();
        foreach(Match line in LevelLine.Matches(ini))
        {
            var parts=line.Value[6..].Split((char[]?)null,StringSplitOptions.RemoveEmptyEntries);
            if(parts.Length<2||!int.TryParse(parts[0],out var temp)||!int.TryParse(parts[1],out var level))return null;
            rows.Add([temp,level]);
        }
        var masks=new List<int[]>();
        foreach(Match line in OffsetLine.Matches(ini))
        {
            var parts=line.Value[(line.Value.IndexOf('=')+1)..].Split((char[]?)null,StringSplitOptions.RemoveEmptyEntries);
            if(parts.Length<1||!int.TryParse(parts[0],out var shift))return null;
            if(!int.TryParse(line.Groups[1].Value,out var sensor))return null;
            masks.Add([sensor-1,shift]);
        }
        var dormant=new List<int[]>();
        foreach(Match line in DormantOffsetLine.Matches(ini)) {
            if(!int.TryParse(line.Value.AsSpan(line.Value.IndexOf('=')+1).Trim(),out var shift))return null;
            if(!int.TryParse(line.Groups[1].Value,out var sensor))return null;
            dormant.Add([sensor-1,shift]);
        }
        return new(mode,[.. rows],[.. masks]){DormantMasks=[.. dormant]};
    }
    public static object? ReadInstalled()
    {
        try{var ini=File.ReadAllText(IniPath,Encoding.Latin1);var curve=Parse(ini);var manual=ManualLimit(ini);return curve is null?null:new{active=curve.Active,rows=curve.Rows,masks=curve.Masks,dormantMasks=curve.DormantMasks,manualTemperatureLimit=manual.Celsius,manualTemperatureAutomatic=manual.Automatic};}
        catch(Exception e) when(e is IOException or UnauthorizedAccessException or InvalidOperationException){return null;}
    }
    // The engine reads its configuration only when it starts. It returns the fan to firmware while stopped.
    // Latin1 keeps the upstream file's non-UTF-8 comments byte for byte.
    public static void Apply(int[][]? rows,int[][]? masks,Func<int,bool> confirmed)
        => ApplyContent(ini=>Rewrite(ini,rows,masks),rows is null?ModeFirmware:ModeCurve,confirmed);
    public static void ApplyManualLimit(int limit,bool automatic,Func<int,bool> confirmed) {
        var mode=Parse(File.ReadAllText(IniPath,Encoding.Latin1))?.Active;
        if(mode is not (ModeFirmware or ModeCurve))throw new InvalidOperationException("Return the fan to firmware or a saved curve before changing its temperature limit.");
        ApplyContent(ini=>RewriteManualLimit(ini,limit,automatic),mode.Value,confirmed);
    }
    private static void ApplyContent(Func<string,string> rewrite,int mode,Func<int,bool> confirmed)
    {
        TpfcEngineTrust.EnsureTrustedService();
        var previous=File.ReadAllText(IniPath,Encoding.Latin1);
        var candidate=rewrite(previous);
        // The same INI can be running in temporary firmware/manual mode. An
        // explicit Apply must restart and confirm the requested operating mode.
        Write(candidate);
        try
        {
            RestartService();
            if(!confirmed(mode))throw new InvalidOperationException("The fan engine did not confirm the new mode.");
        }
        catch(Exception original)
        {
            try{Write(previous);RestartService();}
            catch(Exception recovery){throw new InvalidOperationException("Fan curve failed and the earlier configuration could not be restarted: "+recovery.Message,original);}
            throw new InvalidOperationException("Fan curve not applied; the earlier configuration was restored. "+original.Message,original);
        }
    }
    private static void Write(string content)
    {
        var temporary=IniPath+".tmp";
        File.WriteAllText(temporary,content,Encoding.Latin1);
        File.Move(temporary,IniPath,true);
    }
    private static string Sc(string arguments)
    {
        var path=Path.Combine(Environment.SystemDirectory,"sc.exe");
        using var process=Process.Start(new ProcessStartInfo(path,arguments){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true})??throw new InvalidOperationException("Could not run the Windows service tool.");
        var output=process.StandardOutput.ReadToEnd();process.WaitForExit();return output;
    }
    private static void RestartService()
    {
        Sc("stop TPFanControl");
        var deadline=Environment.TickCount64+12000;
        while(!Sc("query TPFanControl").Contains("STOPPED",StringComparison.Ordinal))
        {
            if(Environment.TickCount64>=deadline)throw new TimeoutException("The fan engine did not stop in time.");
            Thread.Sleep(500);
        }
        Sc("start TPFanControl");
    }
}
