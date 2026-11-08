using System.Diagnostics;
using System.Text.RegularExpressions;

internal static class PowerPolicy
{
    private static readonly string PowerCfg=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"powercfg.exe");
    internal static string Execute(string executable,params string[] arguments)
    {
        var start=new ProcessStartInfo(executable){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        foreach(var arg in arguments)start.ArgumentList.Add(arg);
        using var process=Process.Start(start)??throw new InvalidOperationException("Hardware command did not start.");
        var output=process.StandardOutput.ReadToEndAsync();var error=process.StandardError.ReadToEndAsync();
        if(!process.WaitForExit(10000)){process.Kill();throw new TimeoutException("Hardware policy command timed out; inspect actual state.");}
        Task.WaitAll(output,error);
        if(process.ExitCode!=0)throw new InvalidOperationException((error.Result+output.Result).Trim());
        return output.Result.Trim();
    }
    private record Policy(string Scheme,int Ac,int Dc);
    private static Policy Query(Func<string[],string> execute)
    {
        var scheme=Regex.Match(execute(["/getactivescheme"]),@"[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}").Value;
        if(scheme.Length!=36)throw new InvalidOperationException("Active power plan could not be read.");
        var matches=Regex.Matches(execute(["/qh",scheme,"SUB_PROCESSOR","PERFBOOSTMODE"]),@"0x[0-9a-fA-F]{8}");
        if(matches.Count<2)throw new InvalidOperationException("Boost policy indices could not be read.");
        return new(scheme,Convert.ToInt32(matches[^2].Value[2..],16),Convert.ToInt32(matches[^1].Value[2..],16));
    }
    public static string Apply(string source,bool enabled)=>ApplyWithRunner(source,enabled,args=>Execute(PowerCfg,args));
    // Isolated tests supply an in-memory runner. IPC never exposes this delegate or an executable path.
    internal static string ApplyWithRunner(string source,bool enabled,Func<string[],string> execute)
    {
        if(source is not ("ac" or "dc" or "all"))throw new ArgumentException("Invalid boost power source.");
        var before=Query(execute);var sources=source=="all"?new[]{"ac","dc"}:new[]{source};var attempted=new List<string>();
        try {
            foreach(var s in sources){attempted.Add(s);execute(["/set"+s+"valueindex",before.Scheme,"SUB_PROCESSOR","PERFBOOSTMODE",enabled?"1":"0"]);}
            execute(["/setactive",before.Scheme]);
            var after=Query(execute);
            if(after.Scheme!=before.Scheme||sources.Any(s=>(s=="ac"?after.Ac:after.Dc)!=(enabled?1:0)))throw new InvalidOperationException("CPU policy read-back mismatch or active plan changed.");
            return "CPU boost policy applied by hardware worker and verified.";
        } catch(Exception error) {
            var failures=new List<string>();
            foreach(var s in attempted)try{execute(["/set"+s+"valueindex",before.Scheme,"SUB_PROCESSOR","PERFBOOSTMODE",(s=="ac"?before.Ac:before.Dc).ToString()]);}catch(Exception e){failures.Add(e.Message);}
            try{
                if(Query(execute).Scheme!=before.Scheme)throw new InvalidOperationException("Active power plan changed; original policy restoration is unverified.");
                execute(["/setactive",before.Scheme]);
                var restored=Query(execute);
                if(restored.Scheme!=before.Scheme||attempted.Any(s=>(s=="ac"?restored.Ac:restored.Dc)!=(s=="ac"?before.Ac:before.Dc)))throw new InvalidOperationException("Restoration read-back mismatch or active power plan changed.");
            }catch(Exception e){failures.Add(e.Message);}
            throw new InvalidOperationException(error.Message+(failures.Count==0?" Original policy indices restored and verified.":" Rollback incomplete or unverified: "+string.Join("; ",failures)));
        }
    }
    public static string ApplyGpu(string id,bool enabled)
    {
        if(!Regex.IsMatch(id,@"^GPU-[a-zA-Z0-9-]{1,128}$"))throw new ArgumentException("Invalid GPU UUID.");
        var candidates=new[]{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"nvidia-smi.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"NVIDIA Corporation","NVSMI","nvidia-smi.exe")};
        var smi=candidates.FirstOrDefault(File.Exists)??throw new InvalidOperationException("NVIDIA management executable not found in a trusted installation path.");
        return ApplyGpuWithRunner(id,enabled,args=>Execute(smi,args));
    }
    internal static string ApplyGpuWithRunner(string id,bool enabled,Func<string[],string> execute)
    {
        if(!Regex.IsMatch(id,@"^GPU-[a-zA-Z0-9-]{1,128}$"))throw new ArgumentException("Invalid GPU UUID.");
        string QueryGpu()=>execute(["-i",id,"--query-gpu=auto_boost.default","--format=csv,noheader,nounits"]);
        void WriteGpu(bool value)=>execute(["-i",id,"--auto-boost-default="+(value?"1":"0")]);
        var before=QueryGpu();
        if(!Regex.IsMatch(before,@"^(Enabled|Disabled|On|Off|0|1)$",RegexOptions.IgnoreCase))throw new InvalidOperationException("Independent GPU auto-boost is not supported.");
        var original=Regex.IsMatch(before,@"^(Enabled|On|1)$",RegexOptions.IgnoreCase);
        try {
            WriteGpu(enabled);
            if(!Regex.IsMatch(QueryGpu(),enabled?@"^(Enabled|On|1)$":@"^(Disabled|Off|0)$",RegexOptions.IgnoreCase))throw new InvalidOperationException("GPU policy read-back mismatch.");
        } catch(Exception error) {
            var failures=new List<string>();
            try{WriteGpu(original);}catch(Exception e){failures.Add(e.Message);}
            try{if(!Regex.IsMatch(QueryGpu(),original?@"^(Enabled|On|1)$":@"^(Disabled|Off|0)$",RegexOptions.IgnoreCase))failures.Add("GPU restoration read-back mismatch.");}catch(Exception e){failures.Add(e.Message);}
            throw new InvalidOperationException(error.Message+(failures.Count==0?" Original GPU default restored and verified.":" Rollback incomplete or unverified: "+string.Join("; ",failures)));
        }
        return "GPU default auto-boost policy applied by hardware worker and verified.";
    }
}
