using System.Security.Principal;

namespace ThinkPad.Desktop;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        var mode=StartupMode.Parse(args);
        var smoke=mode.Unattended;
        // Unattended checks must never enter live hardware mode or activate an existing live instance.
        var demo=mode.Demo;
        if(!mode.Allowed){Environment.ExitCode=2;return;}
        if(smoke)Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        // Independent of the UI message pump: even a blocked COM call cannot leave
        // an unattended demo process alive indefinitely. No live mode can reach this.
        using var smokeDeadline=smoke?new System.Threading.Timer(_=>Environment.Exit(1),null,TimeSpan.FromSeconds(55),Timeout.InfiniteTimeSpan):null;
        ApplicationConfiguration.Initialize();
        var sid=WindowsIdentity.GetCurrent().User!.Value;
        var suffix=smoke?"Smoke_"+Environment.ProcessId:demo?(args.Contains("--demo-intel")?"DemoIntel":"Demo"):"Live";
        using var mutex=new Mutex(true,@"Local\ThinkPadControl_"+sid+"_"+suffix,out var first);
        using var installerLock=new Mutex(false,@"Local\ThinkPadControlInstallerLock");
        using var activation=new EventWaitHandle(false,EventResetMode.AutoReset,@"Local\ThinkPadControl_Activate_"+sid+"_"+suffix);
        if(!first) { activation.Set(); return; }
        try { Application.Run(new MainWindow(args,activation)); }
        catch(Exception e) {
            if(smoke){Console.Error.WriteLine(e.Message);Environment.ExitCode=1;}
            else MessageBox.Show(e.Message,"ThinkPad Control",MessageBoxButtons.OK,MessageBoxIcon.Error);
        }
        finally { mutex.ReleaseMutex(); }
    }
}
