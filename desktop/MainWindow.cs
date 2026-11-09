using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ThinkPad.Desktop;

internal sealed partial class MainWindow : Form
{
    private readonly WebView2 web=new() {Dock=DockStyle.Fill,DefaultBackgroundColor=Color.FromArgb(246,246,243)};
    private readonly Label status=new() {Text="Starting ThinkPad Control…",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Segoe UI",13)};
    private readonly NotifyIcon tray;
    private readonly BackendHost backend;
    private readonly bool demo;
    private readonly RegisteredWaitHandle activation;
    private readonly ToolStripMenuItem elevate;
    private readonly ToolStripMenuItem hardwareAccess;
    private bool hardwareEnabled;
    private readonly bool smokeMode;
    private readonly bool visualMode;
    private readonly bool intelDemo;
    private readonly System.Windows.Forms.Timer? smokeTimer;
    private readonly Stopwatch smokeElapsed=Stopwatch.StartNew();
    private bool smokeFinished;
    private bool smokeHostShown;
    private string smokeStage="constructed";
    private bool quitting,busy,webReady;
    private bool manualLeaseEnabled=true,leaseTickBusy;
    private readonly System.Windows.Forms.Timer fanLeaseTimer=new() {Interval=2000};
    private readonly SemaphoreSlim fanLeaseGate=new(1,1);
    private Process? elevatedWorker;
    private readonly string root=AppContext.BaseDirectory;
    private readonly string dataDirectory;
    private readonly string[] args;
    private bool useTpfc = File.Exists(Path.Combine(AppContext.BaseDirectory,"engine","TPFanControl.exe"));
    public MainWindow(string[] args,EventWaitHandle activate)
    {
        var mode=StartupMode.Parse(args);
        if(!mode.Allowed)throw new InvalidOperationException("Unattended checks require an explicit demo profile.");
        this.args=args;intelDemo=mode.Intel;demo=mode.Demo;smokeMode=mode.Unattended;visualMode=mode.Visual;
        dataDirectory=Environment.GetEnvironmentVariable("THINKPAD_DESKTOP_DATA")??(smokeMode?Path.Combine(Path.GetTempPath(),"ThinkPadControlSmoke-"+Guid.NewGuid().ToString("N")):Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ThinkPadControl"));
        Directory.CreateDirectory(dataDirectory);
        backend=new(root,dataDirectory);
        Text="ThinkPad Control"+(demo?" — Demo":"");Size=new Size(1320,960);MinimumSize=new Size(840,640);StartPosition=FormStartPosition.CenterScreen;
        Icon=System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!)??SystemIcons.Application;
        Controls.Add(web);Controls.Add(status);
        var menuBar=new MenuStrip();
        var appMenu=new ToolStripMenuItem("App");
        var settingsMenu=new ToolStripMenuItem("Settings",null,(_,_)=>{if(webReady)web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#setup-dialog').showModal()");}) {ShortcutKeys=Keys.Control|Keys.Oemcomma};
        appMenu.DropDownItems.Add(settingsMenu);appMenu.DropDownItems.Add("Exit",null,async(_,_)=>await Quit());
        var hardwareMenu=new ToolStripMenuItem("Hardware");
        hardwareAccess=new ToolStripMenuItem("Enable hardware access (UAC)…",null,async(_,_)=>await EnableHardware()){Enabled=!demo};
        hardwareMenu.DropDownItems.Add(hardwareAccess);
        hardwareMenu.DropDownItems.Add("Return fans to firmware",null,async(_,_)=>await TrayRestore());
        menuBar.Items.Add(appMenu);menuBar.Items.Add(hardwareMenu);Controls.Add(menuBar);menuBar.BringToFront();MainMenuStrip=menuBar;
        var menu=new ContextMenuStrip();
        menu.Items.Add("Open ThinkPad Control",null,(_,_)=>ShowWindow());
        elevate=new ToolStripMenuItem("Enable hardware access (UAC)…",null,async(_,_)=>await EnableHardware()) {Enabled=!demo};menu.Items.Add(elevate);
        menu.Items.Add("Return fans to firmware",null,async(_,_)=>await TrayRestore());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit",null,async(_,_)=>await Quit());
        tray=new NotifyIcon {Icon=Icon,Text=Text,ContextMenuStrip=menu,Visible=!smokeMode};tray.DoubleClick+=(_,_)=>ShowWindow();
        activation=ThreadPool.RegisterWaitForSingleObject(activate,(_,_)=>{if(!IsDisposed)BeginInvoke(ShowWindow);},null,Timeout.Infinite,false);
        Shown+=async(_,_)=>await Initialize();
        FormClosing+=(_,e)=>{if(!quitting){e.Cancel=true;manualLeaseEnabled=false;Hide();_ = ReleaseOnHide();}};
        Resize+=(_,_)=>{if(WindowState==FormWindowState.Minimized)Hide();};
        VisibleChanged+=(_,_)=>{if(Visible&&!quitting)manualLeaseEnabled=true;};
        // Native timer keeps manual cooling alive even when WebView timers are throttled.
        fanLeaseTimer.Tick+=async(_,_)=>{
            if(leaseTickBusy||quitting||busy||!manualLeaseEnabled||backend.Url is null)return;
            leaseTickBusy=true;
            await fanLeaseGate.WaitAsync();
            try{if(!quitting&&manualLeaseEnabled)await backend.RenewFanLease(()=>manualLeaseEnabled&&!quitting);}
            catch{/* The worker watchdog restores firmware on lost or stale telemetry. */}
            finally{fanLeaseGate.Release();leaseTickBusy=false;}
        };
        fanLeaseTimer.Start();
        backend.Exited+=()=>{if(!quitting&&!IsDisposed)BeginInvoke(()=>ShowFailure("The background process stopped. Use Restart to reconnect."));};
        if(smokeMode) {
            // WebView2 needs a visible native host to finish controller initialization.
            // Keep that host out of the taskbar and non-activating for unattended tests.
            ShowInTaskbar=false;
            SmokeTrace("constructed");
            smokeTimer=new System.Windows.Forms.Timer {Interval=250};
            smokeTimer.Tick+=async(_,_)=>{
                if(quitting||smokeFinished)return;
                if(smokeElapsed.Elapsed>TimeSpan.FromSeconds(40)){await FinishSmoke(false,"Timed out at "+smokeStage);return;}
                if(!smokeHostShown) {
                    smokeHostShown=true;
                    // SW_HIDE from a launcher can leave managed Visible true while
                    // the native host is hidden. Force one real visibility transition.
                    Hide();Show();SmokeTrace("host-shown");
                }
            };
            smokeTimer.Start();
        }
    }
    protected override bool ShowWithoutActivation=>smokeMode||base.ShowWithoutActivation;
    private void SmokeTrace(string stage)
    {
        if(!smokeMode)return;smokeStage=stage;
        File.AppendAllText(Path.Combine(dataDirectory,"desktop-smoke-trace.jsonl"),JsonSerializer.Serialize(new{at=DateTimeOffset.UtcNow,stage})+Environment.NewLine);
    }
    private async Task FinishSmoke(bool passed,string? error=null,JsonElement? checks=null,JsonElement? views=null)
    {
        if(smokeFinished)return;smokeFinished=true;
        File.WriteAllText(Path.Combine(dataDirectory,"desktop-smoke.json"),JsonSerializer.Serialize(new{schemaVersion=2,profile=intelDemo?"intel":"ryzen",checkKind=visualMode?"visual":"lifecycle",passed,stage=smokeStage,error,checks,views,screenshots=visualCaptures}));
        Environment.ExitCode=passed?0:1;
        await Quit();
    }
    private void ShowWindow() { manualLeaseEnabled=true;Show();WindowState=FormWindowState.Normal;Activate(); }
    private async Task ReleaseOnHide() {
        await fanLeaseGate.WaitAsync();
        try{await backend.ReleaseFans();}catch{}finally{fanLeaseGate.Release();}
    }
    private void ShowFailure(string message)
    {
        status.Text=message;status.Visible=true;status.BringToFront();
        var retry=new Button {Text="Restart",AutoSize=true,Anchor=AnchorStyles.None,Location=new Point(Width/2-40,Height/2+45)};
        retry.Click+=async(_,_)=>{Controls.Remove(retry);retry.Dispose();await Initialize();};Controls.Add(retry);retry.BringToFront();
    }
    private async Task Initialize()
    {
        if(busy)return;busy=true;
        try {
            if(!webReady) {
                SmokeTrace("environment-start");
                var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(dataDirectory,"WebView2"));
                SmokeTrace("controller-start");
                await web.EnsureCoreWebView2Async(environment);
                SmokeTrace("controller-ready");
                web.CoreWebView2.Settings.AreDevToolsEnabled=false;
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
                web.CoreWebView2.Settings.IsStatusBarEnabled=false;
                web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled=false;
                web.CoreWebView2.NewWindowRequested+=(_,e)=>e.Handled=true;
                web.CoreWebView2.DownloadStarting+=(_,e)=>e.Cancel=true;
                web.CoreWebView2.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
                web.CoreWebView2.NavigationStarting+=(_,e)=>{if(!Allowed(e.Uri))e.Cancel=true;};
                web.CoreWebView2.WebMessageReceived+=OnMessage;
                SmokeTrace("document-script-start");
                await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("window.thinkpadDesktop = true;");
                SmokeTrace("document-script-ready");
                web.CoreWebView2.ProcessFailed+=(_,_)=>ShowFailure("The desktop renderer stopped. Use Restart to reconnect.");
                webReady=true;
            }
            SmokeTrace("backend-start");
            await backend.Start(demo,null,useTpfc,intelDemo);hardwareEnabled=false;web.CoreWebView2.Navigate(backend.Url!);status.Visible=false;
            if(!smokeMode)await ConnectAtStartup();
            SmokeTrace("navigating");
            if(smokeMode) {
                busy=false;UpdateHardwareState();
                while(!quitting) {
                    var result=await web.CoreWebView2.ExecuteScriptAsync("(()=>{const labels=[...document.querySelectorAll('#navigation .nav-button>span')],sidebar=document.querySelector('.sidebar');return {title:document.title,desktop:window.thinkpadDesktop===true,metrics:document.querySelectorAll('.metric').length,hardwareDisabled:document.querySelector('#enable-hardware')?.disabled===true,setupDisabled:document.querySelector('#install-hardware')?.disabled===true,viewportWidth:innerWidth,navigationReadable:innerWidth<=640||labels.length>=6&&labels.every(label=>getComputedStyle(label).display!=='none'&&label.getBoundingClientRect().right<=sidebar.getBoundingClientRect().right)&&getComputedStyle(document.querySelector('.sidebar-bottom')).display!=='none'};})()");
                    using var report=JsonDocument.Parse(result);
                    var checks=report.RootElement;
                    if(checks.TryGetProperty("metrics",out var metrics)&&metrics.GetInt32()>=4&&checks.GetProperty("desktop").GetBoolean()&&checks.GetProperty("hardwareDisabled").GetBoolean()&&checks.GetProperty("setupDisabled").GetBoolean()) {
                        if(!checks.GetProperty("navigationReadable").GetBoolean()){await FinishSmoke(false,"Navigation labels are hidden or clipped at this desktop width.",checks.Clone());break;}
                        if(visualMode) {
                            await CaptureDemoVisuals();
                            SmokeTrace("demo-visuals-captured");await FinishSmoke(true,checks:checks.Clone());
                        } else if(intelDemo) {
                            var rawViews=await web.CoreWebView2.ExecuteScriptAsync("(()=>{document.querySelector('#navigation button[data-view=cpu]').click();const cpuPage=document.querySelector('#page-title')?.textContent==='CPU & power',ryzenPanelAbsent=!document.querySelector('[data-tuning-vendor=amd-ryzen]'),intelTuningShown=!!document.querySelector('[data-tuning-vendor=intel]'),mixedClassesShown=document.body.innerText.includes('Processor classes currently have different limits');document.querySelector('#navigation button[data-view=gpu]').click();return {cpuPage,ryzenPanelAbsent,intelTuningShown,mixedClassesShown,intelGpuShown:document.body.innerText.includes('Intel Graphics')};})()");
                            using var viewDocument=JsonDocument.Parse(rawViews);
                            var views=viewDocument.RootElement;
                            var passed=new[]{"cpuPage","ryzenPanelAbsent","intelTuningShown","mixedClassesShown","intelGpuShown"}.All(key=>views.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.True);
                            SmokeTrace("intel-views-rendered");await FinishSmoke(passed,passed?null:"Intel demo views did not match expected capabilities.",checks.Clone(),views.Clone());
                        } else {
                            // Demo provider only: exercise real native lifecycle beyond the lease timeout.
                            await backend.Post("/api/commands",new {type="fan",id="demo-cooling",mode="manual",level=4});
                            WindowState=FormWindowState.Minimized;
                            await Task.Delay(11000);
                            if(await backend.FirstFanMode()!="manual")throw new InvalidOperationException("Minimizing lost the simulated manual fan lease.");
                            Close();await ReleaseOnHide();await Task.Delay(3500);
                            if(await backend.FirstFanMode()!="auto")throw new InvalidOperationException("Closing did not release simulated manual fan control.");
                            // Windows can restore the hidden form without calling our tray handler.
                            Show();WindowState=FormWindowState.Normal;
                            await backend.Post("/api/commands",new {type="fan",id="demo-cooling",mode="manual",level=4});
                            WindowState=FormWindowState.Minimized;await Task.Delay(11000);
                            if(await backend.FirstFanMode()!="manual")throw new InvalidOperationException("Restoring the closed window did not resume manual fan renewal.");
                            SmokeTrace("minimize-kept-manual-close-released-reopen-renewed");await FinishSmoke(true,checks:checks.Clone());
                        }
                        break;
                    }
                    await Task.Delay(200);
                }
            }
        } catch(WebView2RuntimeNotFoundException) {
            if(smokeMode)await FinishSmoke(false,"Microsoft WebView2 Runtime is unavailable.");
            else ShowFailure("Microsoft Edge WebView2 Runtime is required. Install it from Microsoft, then restart the app. The installer can open the official download page.");
        } catch(Exception e) {if(smokeMode)await FinishSmoke(false,e.Message);else ShowFailure(e.Message);}
        finally {busy=false;if(!IsDisposed)UpdateHardwareState();}
    }
    private bool Allowed(string address) => backend.Url is not null&&Uri.TryCreate(address,UriKind.Absolute,out var uri)&&uri.GetLeftPart(UriPartial.Authority)==backend.Url;
    private async void OnMessage(object? sender,CoreWebView2WebMessageReceivedEventArgs e)
    {
        if(!Allowed(e.Source))return;
        try {
            using var message=JsonDocument.Parse(e.WebMessageAsJson);
            if(message.RootElement.GetProperty("type").GetString() is "enable-hardware")await EnableHardware();
            else if(message.RootElement.GetProperty("type").GetString() is "setup-hardware")await SetupHardware();
            else if(message.RootElement.GetProperty("type").GetString() is "exit")await Quit();
            else if(message.RootElement.GetProperty("type").GetString() is "save-settings") {
                useTpfc=message.RootElement.GetProperty("useTpfc").GetBoolean();
                File.WriteAllText(Path.Combine(dataDirectory,"desktop-settings.json"),JsonSerializer.Serialize(new{useTpfc}));
                await Initialize();
            }
            else if(message.RootElement.GetProperty("type").GetString() is "get-settings")
                web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="settings",useTpfc,hardwareEnabled,busy}));
        } catch(Exception error){MessageBox.Show(this,error.Message,"ThinkPad Control",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
    }
    private async Task EnableHardware()
    {
        // Also used to reconnect, for a new tuning baseline after a power-source change.
        if(demo||busy)return;
        busy=true;UpdateHardwareState();
        var switchedBackend=false;
        try {
            if(WorkerTask.Read(root) is {} task) {
                status.Text="Connecting to the hardware worker…";status.Visible=true;status.BringToFront();
                switchedBackend=true;
                await StartThroughTask(task);
                hardwareEnabled=true;
                web.CoreWebView2.Navigate(backend.Url!);status.Visible=false;
                return;
            }
            // Ask for elevation before disturbing the current connection. A canceled UAC leaves it running.
            var pipe="ThinkPadControl-"+Guid.NewGuid().ToString("N");
            var psi=new ProcessStartInfo(Path.Combine(root,"bridge","ThinkPad.Bridge.exe")) {UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden};
            psi.ArgumentList.Add("--pipe");psi.ArgumentList.Add(pipe);
            psi.ArgumentList.Add("--owner");psi.ArgumentList.Add(WindowsIdentity.GetCurrent().User!.Value);
            if(useTpfc)psi.ArgumentList.Add("--tpfc");
            var worker=Process.Start(psi)??throw new InvalidOperationException("Hardware worker did not start.");
            elevatedWorker?.Dispose();elevatedWorker=worker;
            worker.Exited+=(_,_)=>{
                if(!quitting&&!IsDisposed)BeginInvoke(()=>{
                    if(elevatedWorker==worker) {hardwareEnabled=false;UpdateHardwareState();}
                });
            };
            worker.EnableRaisingEvents=true;
            status.Text="Connecting to the hardware worker…";status.Visible=true;status.BringToFront();
            switchedBackend=true;
            await backend.Start(false,pipe,useTpfc);
            await backend.VerifyHardwareAccess();
            hardwareEnabled=true;
            web.CoreWebView2.Navigate(backend.Url!);status.Visible=false;
        } catch(System.ComponentModel.Win32Exception e) when(e.NativeErrorCode==1223) { /* Existing connection remains active. */ }
        catch(Exception e) {
            hardwareEnabled=false;
            if(switchedBackend) {
                try {
                    await backend.Start(false,null,useTpfc);
                    web.CoreWebView2.Navigate(backend.Url!);status.Visible=false;
                    MessageBox.Show(this,e.Message+"\n\nThe dashboard has reconnected with standard access.","Hardware connection",MessageBoxButtons.OK,MessageBoxIcon.Warning);
                } catch(Exception recovery) {ShowFailure(e.Message+"\nStandard access recovery failed: "+recovery.Message);}
            } else MessageBox.Show(this,e.Message,"Hardware connection",MessageBoxButtons.OK,MessageBoxIcon.Warning);
        }
        finally {busy=false;UpdateHardwareState();}
    }
    // Disconnects first: the worker keeps one fixed pipe, and only exits once its client has gone.
    private async Task StartThroughTask(WorkerTask task)
    {
        await backend.Stop();
        await WorkerTask.WaitForExit();
        await task.Run();
        await backend.Start(false,task.Pipe,useTpfc);
        await backend.VerifyHardwareAccess();
    }
    // Hardware access is a core feature, so the app connects by itself when setup has provided the task.
    private async Task ConnectAtStartup()
    {
        if(demo||WorkerTask.Read(root) is not {} task)return;
        try {
            await StartThroughTask(task);
            hardwareEnabled=true;
            web.CoreWebView2.Navigate(backend.Url!);
        } catch(Exception e) {
            hardwareEnabled=false;
            try {
                await backend.Start(false,null,useTpfc);web.CoreWebView2.Navigate(backend.Url!);
                MessageBox.Show(this,"Hardware access couldn't connect automatically, so readings and controls are limited.\n\n"+e.Message+"\n\nUse Setup > Repair hardware support to fix this.","Hardware connection",MessageBoxButtons.OK,MessageBoxIcon.Warning);
            } catch(Exception recovery) {ShowFailure(e.Message+"\nStandard access recovery failed: "+recovery.Message);}
        }
    }
    private void UpdateHardwareState()
    {
        var automatic=WorkerTask.Read(root) is not null;
        var text=hardwareEnabled?(automatic?"Reconnect hardware access":"Reconnect hardware access (UAC)…"):(automatic?"Connect hardware access":"Enable hardware access (UAC)…");
        elevate.Text=hardwareAccess.Text=text;
        elevate.Enabled=hardwareAccess.Enabled=!demo&&!busy;
        if(webReady&&!quitting)web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="hardware-state",hardwareEnabled,busy}));
    }
    private async Task SetupHardware()
    {
        if(demo||busy)return;
        var installedRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ThinkPad Control");
        if(!string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)),installedRoot,StringComparison.OrdinalIgnoreCase)) {
            MessageBox.Show(this,"Install ThinkPad Control with its setup executable first. Fan support runs as a Windows service and requires the protected Program Files installation.","Fan support setup",MessageBoxButtons.OK,MessageBoxIcon.Information);
            return;
        }
        busy=true;UpdateHardwareState();
        try {
            await backend.RestoreFirmware();
            var started=DateTime.UtcNow;
            var psi=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","powershell.exe")) {UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden};
            foreach(var argument in new[]{"-NoProfile","-NonInteractive","-ExecutionPolicy","RemoteSigned","-File",Path.Combine(root,"scripts","hardware-support.ps1"),"-Action","Install"})psi.ArgumentList.Add(argument);
            using var setup=Process.Start(psi)??throw new InvalidOperationException("Hardware setup did not start.");
            await setup.WaitForExitAsync();
            if(setup.ExitCode!=0) {
                var log=Path.Combine(root,"hardware-setup-error.txt");
                var detail=File.Exists(log)&&File.GetLastWriteTimeUtc(log)>=started?File.ReadAllText(log):"Hardware setup failed. Check Windows security policy, driver installation and pending restarts.";
                throw new InvalidOperationException(detail.Length>4000?detail[..4000]:detail);
            }
            useTpfc=true;hardwareEnabled=false;
            File.WriteAllText(Path.Combine(dataDirectory,"desktop-settings.json"),JsonSerializer.Serialize(new{useTpfc}));
            await backend.Start(false,null,useTpfc);web.CoreWebView2.Navigate(backend.Url!);
            await ConnectAtStartup();
            MessageBox.Show(this,"Hardware support is repaired. Firmware controls cooling until you apply a manual level or a fan curve.","Hardware support",MessageBoxButtons.OK,MessageBoxIcon.Information);
        } catch(System.ComponentModel.Win32Exception e) when(e.NativeErrorCode==1223) { }
        catch(Exception e) {if(backend.Url is null)ShowFailure(e.Message);else MessageBox.Show(this,e.Message,"Fan support setup",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
        finally {busy=false;UpdateHardwareState();}
    }
    private async Task TrayRestore()
    {
        try{await backend.RestoreFirmware();tray.ShowBalloonTip(3000,"ThinkPad Control","Firmware control requested and checked.",ToolTipIcon.Info);}
        catch(Exception e){MessageBox.Show(e.Message,"Fan restoration",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
    }
    private async Task Quit()
    {
        if(quitting)return;quitting=true;tray.Visible=false;
        manualLeaseEnabled=false;fanLeaseTimer.Dispose();
        await ReleaseOnHide();
        smokeTimer?.Dispose();
        try{await backend.DisposeAsync();}catch{}
        // The pipe worker restores owned fans on EOF. Never force-kill a hardware watchdog.
        if(elevatedWorker is not null){try{await elevatedWorker.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12));}catch{}elevatedWorker.Dispose();}
        activation.Unregister(null);tray.Dispose();web.Dispose();Close();
    }
}
