using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace ThinkPad.Desktop;

internal sealed partial class MainWindow
{
    private sealed record VisualCapture(string file,string view,string window,int viewportWidth,int viewportHeight,int scrollWidth,int clientWidth);
    private readonly List<VisualCapture> visualCaptures=[];

    private async Task CaptureDemoVisuals()
    {
        if(!demo||!smokeMode||!visualMode)throw new InvalidOperationException("Visual capture is restricted to unattended demos.");
        var output=Path.Combine(dataDirectory,"screenshots");Directory.CreateDirectory(output);
        WindowState=FormWindowState.Normal;Show();
        foreach(var layout in new[]{(Name:"wide",Width:1320,Height:960),(Name:"compact",Width:840,Height:640)}) {
            Size=new Size(layout.Width,layout.Height);
            foreach(var view in new[]{"overview","cpu","gpu","fan","sensors","activity","advanced"}) {
                // Fixed navigation/disclosure selectors only; never invoke control commands.
                await web.CoreWebView2.ExecuteScriptAsync($"document.querySelector('#navigation button[data-view={view}]').click();document.querySelector('main').scrollTop=0;");
                await CaptureDemoPage(output,layout.Name,view,false);
                if(view is "cpu" or "fan") {
                    await web.CoreWebView2.ExecuteScriptAsync(view=="cpu"
                        ? "(()=>{const panel=document.querySelector('details.advanced-panel');if(panel){panel.open=true;panel.scrollIntoView({block:'start'});}})()"
                        : "document.querySelector('.profile-top')?.closest('section')?.scrollIntoView({block:'start'});");
                    await CaptureDemoPage(output,layout.Name,view,true);
                }
            }
            await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#setup-dialog').showModal();");
            await CaptureDemoPage(output,layout.Name,"settings",false);
            await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#setup-dialog').close();");
        }
    }

    private async Task CaptureDemoPage(string output,string layout,string view,bool detail)
    {
        SmokeTrace("visual-"+layout+"-"+view+(detail?"-detail":""));
        await Task.Delay(250);
        if(MainMenuStrip is {Visible:true} menu&&web.Top<menu.Bottom)
            throw new InvalidOperationException($"Native menu overlaps the web viewport: menu bottom {menu.Bottom}, viewport top {web.Top} ({layout}/{view}).");
        var raw=await web.CoreWebView2.ExecuteScriptAsync("(()=>{const root=document.documentElement,content=document.querySelector('#content'),edge=content.getBoundingClientRect().right;return {simulated:document.querySelector('#mode-badge')?.textContent==='SIMULATED DEMO',viewportWidth:innerWidth,viewportHeight:innerHeight,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth,contentWidth:content.clientWidth,contentScroll:content.scrollWidth,overflowing:[...content.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>edge+1).slice(0,12).map(n=>({tag:n.tagName,cls:n.className?.baseVal??n.className,text:n.textContent.slice(0,80)}))};})()");
        using var document=JsonDocument.Parse(raw);var reading=document.RootElement;
        if(!reading.GetProperty("simulated").GetBoolean())throw new InvalidOperationException("Screenshot target is not a simulated demo.");
        if(view=="settings") {
            var modal=await web.CoreWebView2.ExecuteScriptAsync("(()=>{const d=document.querySelector('#setup-dialog'),r=d.getBoundingClientRect();return d.open&&d.contains(document.activeElement)&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth;})()");
            if(modal!="true")throw new InvalidOperationException("Settings must be modal, focused and contained within the demo viewport.");
        }
        var file=layout+"-"+view+(detail?"-detail":"")+".png";
        using(var stream=new FileStream(Path.Combine(output,file),FileMode.CreateNew,FileAccess.Write,FileShare.None))
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);
        File.WriteAllText(Path.Combine(output,file+".json"),raw);
        if(reading.GetProperty("scrollWidth").GetInt32()>reading.GetProperty("clientWidth").GetInt32()||reading.GetProperty("contentScroll").GetInt32()>reading.GetProperty("contentWidth").GetInt32())
            throw new InvalidOperationException($"Horizontal overflow on {layout}/{view}; inspect its capture and layout JSON.");
        visualCaptures.Add(new(file,view,layout,reading.GetProperty("viewportWidth").GetInt32(),reading.GetProperty("viewportHeight").GetInt32(),reading.GetProperty("scrollWidth").GetInt32(),reading.GetProperty("clientWidth").GetInt32()));
    }
}
