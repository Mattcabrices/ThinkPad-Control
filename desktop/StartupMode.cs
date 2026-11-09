namespace ThinkPad.Desktop;

// Parsed before any window, mutex activation or hardware worker is created.
internal readonly record struct StartupMode(bool Demo,bool Intel,bool Smoke,bool Visual)
{
    public bool Unattended=>Smoke||Visual;
    public bool Allowed=>!Unattended||Demo;
    public static StartupMode Parse(string[] args)
    {
        var intel=args.Contains("--demo-intel");
        return new(args.Contains("--demo")||intel,intel,args.Contains("--smoke-test"),args.Contains("--visual-test"));
    }
}
