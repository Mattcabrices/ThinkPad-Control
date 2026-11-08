using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;

namespace ThinkPad.Desktop;

internal sealed class BackendHost : IAsyncDisposable
{
    private Process? process;
    private readonly HttpClient http=new() { Timeout=TimeSpan.FromSeconds(40) };
    private string? token;
    public string? Url { get; private set; }
    public string LastError { get; private set; }="";
    public event Action? Exited;
    public string Root { get; }
    public string DataDirectory { get; }
    public BackendHost(string root,string dataDirectory) { Root=root;DataDirectory=dataDirectory; }
    public async Task Start(bool demo,string? pipe=null,bool useTpfc=false,bool intelDemo=false)
    {
        await Stop();
        var node=Path.Combine(Root,"runtime","node.exe");
        var entry=Path.Combine(Root,"app","src","server.js");
        if(!File.Exists(node)||!File.Exists(entry)) throw new FileNotFoundException("Application files are missing. Reinstall ThinkPad Control or extract the complete portable package.");
        var psi=new ProcessStartInfo(node) { UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.Combine(Root,"app"),RedirectStandardOutput=true,RedirectStandardError=true };
        psi.ArgumentList.Add(entry);psi.ArgumentList.Add("--desktop");if(demo)psi.ArgumentList.Add("--demo");
        if(demo&&intelDemo)psi.ArgumentList.Add("--demo-intel");
        psi.Environment["PORT"]="0";psi.Environment["THINKPAD_DATA_DIR"]=DataDirectory;
        psi.Environment["THINKPAD_PARENT_PID"]=Environment.ProcessId.ToString();
        psi.Environment["THINKPAD_BRIDGE"]=Path.Combine(Root,"bridge","ThinkPad.Bridge.exe");
        // Desktop controls executable paths; never inherit a user-supplied bridge pipe or nvidia executable override.
        psi.Environment.Remove("THINKPAD_BRIDGE_PIPE");psi.Environment.Remove("THINKPAD_NVIDIA_SMI");
        psi.Environment["THINKPAD_TPFC"]=useTpfc?"1":"0";
        psi.Environment.Remove("THINKPAD_FAN_ALLOWLIST");
        if(pipe is not null)psi.Environment["THINKPAD_BRIDGE_PIPE"]=pipe;
        var ready=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        LastError="";
        var child=new Process { StartInfo=psi,EnableRaisingEvents=true };
        child.OutputDataReceived+=(_,e)=>{
            if(e.Data?.StartsWith("DESKTOP_READY ")==true)ready.TrySetResult(e.Data[14..]);
        };
        child.ErrorDataReceived+=(_,e)=>{if(e.Data is not null)LastError=e.Data;};
        child.Exited+=(_,_)=>{
            ready.TrySetException(new InvalidOperationException("Background process exited. "+LastError));
            if(process==child)Exited?.Invoke();
        };
        try {
            child.Start();process=child;child.BeginOutputReadLine();child.BeginErrorReadLine();
            var payload=await ready.Task.WaitAsync(TimeSpan.FromSeconds(60));
            using var doc=JsonDocument.Parse(payload);
            var url=doc.RootElement.GetProperty("url").GetString()!;
            if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||uri.Host!="127.0.0.1"||uri.Scheme!="http")throw new InvalidOperationException("Invalid background endpoint.");
            Url=url;token=doc.RootElement.GetProperty("token").GetString();
        } catch { await Stop();throw; }
    }
    public async Task Post(string endpoint,object body)
    {
        if(Url is null)throw new InvalidOperationException("Background process is not connected.");
        using var request=new HttpRequestMessage(HttpMethod.Post,Url+endpoint);
        request.Headers.Add("X-Control-Token",token);request.Content=JsonContent.Create(body);
        using var response=await http.SendAsync(request);
        if(!response.IsSuccessStatusCode) {
            using var doc=JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            throw new InvalidOperationException(doc.RootElement.GetProperty("error").GetString());
        }
    }
    public async Task ReleaseFans() => await Post("/api/lease",new {active=false});
    public async Task VerifyHardwareAccess()
    {
        if(Url is null)throw new InvalidOperationException("Background process is not connected.");
        using var request=new HttpRequestMessage(HttpMethod.Get,Url+"/api/state");
        request.Headers.Add("X-Control-Token",token);
        using var response=await http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        using var document=JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        ValidateHardwareSnapshot(document.RootElement);
    }
    internal static void ValidateHardwareSnapshot(JsonElement state)
    {
        if(!state.TryGetProperty("stale",out var stale)||stale.ValueKind!=JsonValueKind.False||
            !state.TryGetProperty("error",out var error)||error.ValueKind!=JsonValueKind.Null||
            !state.TryGetProperty("snapshot",out var snapshot)||snapshot.ValueKind!=JsonValueKind.Object||
            !snapshot.TryGetProperty("driver",out var driver)||driver.ValueKind!=JsonValueKind.Object||
            !driver.TryGetProperty("administrator",out var administrator)||administrator.ValueKind!=JsonValueKind.True)
            throw new InvalidOperationException("The elevated hardware worker did not return a fresh administrator snapshot. Standard access will be restored; check Windows security policy and retry hardware access.");
        // Connection/elevation does not establish driver access or sensor compatibility.
        // The dashboard retains the worker's separate per-capability diagnostics.
    }
    public async Task RestoreFirmware() => await Post("/api/restore-fans",new {});
    public async Task Stop()
    {
        var child=process;
        if(child is null)return;
        process=null;
        if(!child.HasExited) {
            try { if(Url is not null)await Post("/api/shutdown",new {}); }
            catch { /* Pipe closure below still releases the independent native watchdog. */ }
            try { await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); }
            catch(TimeoutException) { child.Kill();await child.WaitForExitAsync(); }
        }
        child.Dispose();Url=null;token=null;
    }
    public async ValueTask DisposeAsync() { await Stop();http.Dispose(); }
}
