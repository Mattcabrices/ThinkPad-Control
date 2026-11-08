// Original MIT code. Starts the hardware worker through the scheduled task that setup registers, so opening
// the app doesn't need a UAC prompt each time. The task and its settings file are written only by elevated
// setup into Program Files, so a standard user can run the task but can't change what it runs.
using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record WorkerTask(string TaskName,string Pipe,string Owner)
{
    private const string ExpectedTaskName="ThinkPad Control Hardware Worker";

    public static WorkerTask? Read(string root)
    {
        var installed=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ThinkPad Control");
        if(!string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)),installed,StringComparison.OrdinalIgnoreCase))return null;
        try { return Parse(File.ReadAllText(Path.Combine(root,"worker-task.json")),WindowsIdentity.GetCurrent().User?.Value); }
        catch(Exception e) when(e is IOException or UnauthorizedAccessException) { return null; }
    }
    // Another Windows account can't use a task registered for this one, so it falls back to asking UAC.
    internal static WorkerTask? Parse(string json,string? currentUser)
    {
        try {
            using var document=JsonDocument.Parse(json);
            var root=document.RootElement;
            var task=new WorkerTask(root.GetProperty("taskName").GetString()??"",root.GetProperty("pipe").GetString()??"",root.GetProperty("owner").GetString()??"");
            return task.TaskName==ExpectedTaskName&&Regex.IsMatch(task.Pipe,@"^ThinkPadControl-[a-f0-9]{32}$")&&task.Owner==currentUser?task:null;
        } catch(Exception e) when(e is JsonException or KeyNotFoundException or InvalidOperationException) { return null; }
    }
    public async Task Run()
    {
        var start=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"schtasks.exe")) {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        foreach(var argument in new[]{"/Run","/TN",TaskName})start.ArgumentList.Add(argument);
        using var process=Process.Start(start)??throw new InvalidOperationException("Windows Task Scheduler did not start.");
        var errors=process.StandardError.ReadToEndAsync();_=process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        if(process.ExitCode!=0)throw new InvalidOperationException("Windows couldn't start the hardware worker task. "+(await errors).Trim());
    }
    // The worker restores owned fans and exits when its client disconnects. It is never forced to stop.
    public static async Task WaitForExit()
    {
        var deadline=Environment.TickCount64+15000;
        while(Environment.TickCount64<deadline) {
            var running=Process.GetProcessesByName("ThinkPad.Bridge");
            var any=running.Length>0;foreach(var process in running)process.Dispose();
            if(!any)return;
            await Task.Delay(250);
        }
        throw new TimeoutException("The previous hardware worker is still closing. Try reconnecting in a moment.");
    }
}
