export function hardwareAccessState(mode, connection) {
  return {
    disabled:mode==='demo'||connection?.busy===true||connection?.hardwareEnabled===true,
    label:connection?.busy?'Working…':connection?.hardwareEnabled?'Hardware worker connected':'Enable hardware access'
  };
}
// Loaded by the native WebView host only. Native messages are source-checked by the host.
export function attachDesktop({el,button,state,onExit}) {
  if(window.thinkpadDesktop!==true||!window.chrome?.webview)return;
  const post=value=>window.chrome.webview.postMessage(value);
  const enable=button('Enable hardware access','button',()=>post({type:'enable-hardware'}));
  enable.id='enable-hardware';enable.disabled=state.mode==='demo';
  document.querySelector('.top-status').prepend(enable);
  const dialog=document.querySelector('#setup-dialog');
  const top=el('div','dialog-top');
  const close=button('×','icon-button',()=>dialog.close());close.setAttribute('aria-label','Close settings');
  top.append(el('span','eyebrow','DESKTOP SETTINGS'),close);
  const h=el('h2','','Settings');h.id='settings-heading';dialog.setAttribute('aria-labelledby','settings-heading');
  const description=el('p','','Hardware access connects automatically for the Windows account used during setup. To reconnect, use Hardware → Enable hardware access. Repair requires administrator approval.');
  const diagnosis=el('p');diagnosis.id='driver-status';
  const engine=el('p');engine.id='engine-status';
  const explanation=el('p','','The TPFanCtrl2 fan engine is bundled. Setup downloads and verifies the signed PawnIO driver if missing; that step needs internet access. An existing external fan service is left unchanged.');
  const lifecycle=el('p','','Minimizing keeps manual fan control active in the system tray. Closing the window returns manual control to firmware while the app stays in the tray. Saved fan curves keep running in either case. Choose Exit here or from the tray to stop the app.');
  const removal=el('p','','Uninstalling removes the hardware worker task and the fan engine service. The PawnIO driver stays, because other apps may share it, and so does your data folder.');
  const note=el('p','','Closing the window returns manual fans to firmware. CPU boost, speed limits and wattage settings are not reset on close; use their restore controls to undo changes.');
  const details=el('details','control-help');
  details.append(el('summary','','Cooling, exit and uninstall'),lifecycle,removal);
  const install=button('Repair hardware support','button',()=>post({type:'setup-hardware'}));
  install.id='install-hardware';install.disabled=state.mode==='demo';
  const exit=button('Exit ThinkPad Control','button',onExit);exit.id='stop-service';
  dialog.replaceChildren(top,h,description,diagnosis,engine,explanation,note,details,install,document.createTextNode(' '),exit);
  window.chrome.webview.addEventListener('message',event=>{
    const message=event.data;
    if(['settings','hardware-state'].includes(message?.type)) {
      state.desktopHardware={busy:message.busy===true,hardwareEnabled:message.hardwareEnabled===true};
      const control=hardwareAccessState(state.mode,state.desktopHardware);
      // Hardware access is automatic, so this only appears when it isn't connected and may need attention.
      enable.disabled=control.disabled;enable.textContent=control.label;enable.hidden=state.desktopHardware.hardwareEnabled||state.desktopHardware.busy;
      install.disabled=state.mode==='demo'||message.busy===true;
    }
  });
  post({type:'get-settings'});
  return {exit:()=>post({type:'exit'})};
}
