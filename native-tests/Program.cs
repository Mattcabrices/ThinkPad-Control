using System.IO.MemoryMappedFiles;

// No real driver or real TPFanCtrl2 mapping: all protocol tests use an isolated in-memory engine.
var name=@"Local\ThinkPadControl_Test_"+Guid.NewGuid();
using var map=MemoryMappedFile.CreateNew(name,TpfcAdapter.LayoutSize);
using var view=map.CreateViewAccessor();
var now=TimeSpan.Zero;
view.Write(12,1);view.Write(20,128);view.Write(40,55);view.Write(24,184);view.Write(28,11); // 3000 RPM
view.Write(32,255);view.Write(36,255); // invalid tachometer sentinel
using var adapter=new TpfcAdapter(name,()=>now);
var checks=0;
void Check(bool value,string message) { if(!value) throw new Exception(message); checks++; }
foreach(var flag in new[]{"--smoke-test","--visual-test"}) {
    Check(!ThinkPad.Desktop.StartupMode.Parse([flag]).Allowed,"Unattended checks cannot start a live window or worker.");
    foreach(var profile in new[]{"--demo","--demo-intel"}) {
        var mode=ThinkPad.Desktop.StartupMode.Parse([profile,flag]);
        Check(mode.Allowed&&mode.Unattended&&mode.Demo&&mode.Intel==(profile=="--demo-intel")&&mode.Visual==(flag=="--visual-test"),"Test modes require an explicit, correctly selected simulation.");
    }
}
Check(ThinkPad.Desktop.StartupMode.Parse([]) is {Allowed:true,Demo:false,Unattended:false},"Normal startup remains live and does not capture screenshots.");
Check(ThinkPad.Desktop.StartupMode.Parse(["--demo"]) is {Allowed:true,Demo:true,Unattended:false,Visual:false},"Interactive demos do not capture automatically.");
void Reject(Action action,string message) { try { action(); } catch(InvalidOperationException) { checks++;return; } throw new Exception(message); }
void Publish(int mode,int raw) { view.Write(8,view.ReadInt32(4));view.Write(12,mode);view.Write(20,raw);view.Write(0,view.ReadInt32(0)+1); }

// Isolated installer recovery transaction; never opens the real service manager.
var oldRecovery=new EngineServiceRecovery.Policy(0,"","",[]);
var desiredRecovery=EngineServiceRecovery.Desired;
Check(desiredRecovery.Actions.SequenceEqual(new EngineServiceRecovery.RecoveryAction[]{new(1,5000),new(1,15000),new(0,0)})&&desiredRecovery.Command==""&&desiredRecovery.RebootMessage=="","Recovery is bounded to two restarts, then NONE; never run or reboot.");
var recoveryState=oldRecovery;var recoveryWrites=0;var recoveryReads=0;
Reject(()=>EngineServiceRecovery.Apply(()=>throw new InvalidOperationException("untrusted"),()=>{recoveryReads++;return recoveryState;},p=>recoveryWrites++),"Untrusted service must refuse.");
Check(recoveryReads==0&&recoveryWrites==0,"Trust refusal precedes all configuration access.");
Reject(()=>EngineServiceRecovery.Apply(()=>{},()=>throw new InvalidOperationException("read denied"),p=>recoveryWrites++),"Initial read failure must refuse.");
Check(recoveryWrites==0,"Failed initial read must not write.");
EngineServiceRecovery.Apply(()=>{},()=>recoveryState,p=>{recoveryWrites++;recoveryState=p;});
Check(EngineServiceRecovery.Same(recoveryState,desiredRecovery)&&recoveryWrites==1,"Successful configuration is read back.");
EngineServiceRecovery.Apply(()=>{},()=>recoveryState,p=>recoveryWrites++);
Check(recoveryWrites==1,"Already configured recovery is idempotent.");
recoveryState=oldRecovery;recoveryWrites=0;
try {EngineServiceRecovery.Apply(()=>{},()=>recoveryState,p=>recoveryWrites++);throw new Exception("Ignored write must fail");}
catch(InvalidOperationException e){Check(e.Message.Contains("restored and verified")&&recoveryWrites==2,"Ignored write fails with verified restoration.");}
recoveryState=oldRecovery;recoveryWrites=0;
try {EngineServiceRecovery.Apply(()=>{},()=>recoveryState,p=>{recoveryState=p;if(++recoveryWrites==1)throw new InvalidOperationException("partial failure");});throw new Exception("Partial write must fail");}
catch(InvalidOperationException e){Check(e.Message.Contains("restored and verified")&&EngineServiceRecovery.Same(recoveryState,oldRecovery),"Partial write rolls back and verifies original configuration.");}
recoveryState=oldRecovery;recoveryWrites=0;recoveryReads=0;
try {EngineServiceRecovery.Apply(()=>{},()=>{if(++recoveryReads==2)throw new InvalidOperationException("verification denied");return recoveryState;},p=>{if(++recoveryWrites==1)recoveryState=p;});throw new Exception("Ignored rollback must fail");}
catch(InvalidOperationException e){Check(e.Message.Contains("rollback is unverified"),"Failed rollback must never report success.");}
recoveryState=oldRecovery;recoveryWrites=0;var trustChecks=0;
try {EngineServiceRecovery.Apply(()=>{if(++trustChecks>=3)throw new InvalidOperationException("ownership lost");},()=>recoveryState,p=>{recoveryWrites++;recoveryState=p;});throw new Exception("Lost ownership must fail");}
catch(InvalidOperationException e){Check(e.Message.Contains("rollback is unverified")&&recoveryWrites==1,"Lost trust prevents further writes, including rollback.");}

var intelLimitBits=120UL|(1UL<<15)|(1UL<<16)|(0x6EUL<<17)|(280UL<<32)|(1UL<<47)|(0x2AUL<<49)|(1UL<<63);
var intelLimits=IntelPowerLimits.Decode(3UL|(10UL<<16),intelLimitBits);
Check(intelLimits.Available&&intelLimits.ReadOnly&&intelLimits.Locked==true,"Locked Intel limits remain visible and read-only.");
Check(intelLimits.Pl1!.Watts==15&&intelLimits.Pl2!.Watts==35,"Intel PL1 and PL2 units/bit fields decode independently.");
Check(intelLimits.Pl1.Enabled&&intelLimits.Pl1.Clamp&&intelLimits.Pl2.Enabled&&!intelLimits.Pl2.Clamp,"Enable and clamp bits must not be shifted onto each other.");
Check(intelLimits.Pl1.WindowSeconds==28&&intelLimits.Pl2.WindowSeconds==1.25,"Fractional/exponential RAPL windows decode correctly.");
var disabledLimits=IntelPowerLimits.Decode(3UL,1UL<<63);
Check(disabledLimits.Available&&!disabledLimits.Pl1!.Enabled&&disabledLimits.Pl1.Watts is null,"Disabled zero limits stay null, never a zero-watt active cap.");
Check(!IntelPowerLimits.Decode(ulong.MaxValue,intelLimitBits).Available&&!IntelPowerLimits.Decode(0,0).Available,"Invalid register data is unavailable.");
Check(!IntelPowerLimits.Decode(0,1UL<<15).Available,"Enabled zero-watt limit is invalid.");
Check(!IntelPowerLimits.Decode(0,32767UL|(1UL<<15)).Available,"Implausible laptop power limits are unavailable.");
// Read-only OEM ranges are distinct from SMU targets and app write ceilings.
var fwBurst=new FirmwarePowerRow(0x0103FF00,7,65,1,15,120);
var fwReport=FirmwarePowerRanges.Decode([fwBurst,new(0x01010000,1,30,1,5,45),new(0x0105FF00,1,45,1,10,80)]);
Check(fwReport.Available&&fwReport.ReadOnly&&fwReport.Limits.Length==3,"Reported firmware ranges are read-only metadata, including values above app ceilings.");
Check(fwReport.Limits.Any(v=>v.Field=="cpuBurstWatts"&&v.MaximumWatts==120&&v.ProfileId==255&&v.Profile=="Custom"),"Burst maxima retain their explicit firmware profile.");
Check(fwReport.Limits.Any(v=>v.Field=="apuSustainedWatts")&&!fwReport.Limits.Any(v=>v.Field=="cpuSustainedWatts"),"APU and CPU sustained limits must not be conflated with each other or an SMU STAPM field.");
Check(!FirmwarePowerRanges.Decode([]).Available,"Empty firmware tables remain Not reported.");
foreach(var invalid in new[]{fwBurst with{Capability=0},fwBurst with{Capability=9},fwBurst with{MaxValue=0},fwBurst with{MaxValue=uint.MaxValue},fwBurst with{MinValue=130},fwBurst with{DefaultValue=140},fwBurst with{Step=0},fwBurst with{Id=0x0203FF00},fwBurst with{Id=0x0103FF01},fwBurst with{Id=0x0104FF00}})
    Check(!FirmwarePowerRanges.Decode([invalid]).Available,"Unsupported, cross-load, non-power or malformed metadata must never become a wattage maximum.");
Check(!FirmwarePowerRanges.Decode([fwBurst,fwBurst with{MaxValue=125}]).Available,"Conflicting duplicate capability IDs must not select the highest maximum.");
Check(!FirmwarePowerRanges.Decode(Enumerable.Repeat(fwBurst,257)).Available,"Oversized capability tables refuse.");
Check(!FirmwarePowerRanges.Fresh(fwReport,60000).Available&&FirmwarePowerRanges.Fresh(fwReport,60000).Limits.Length==0,"Expired OEM ranges are cleared, not displayed as current firmware data.");
Check(FirmwarePowerRanges.Fresh(fwReport,59999).Available,"Fresh metadata remains available before the exact expiry boundary.");
var intelReads=new List<uint>();
var readLimits=IntelPowerLimits.Read(new("GenuineIntel",6,0xBA,true),register=>{intelReads.Add(register);return register==0x606?3UL|(10UL<<16):intelLimitBits;});
Check(readLimits.Available&&readLimits.ReadAt is not null&&intelReads.SequenceEqual(new uint[]{0x606,0x610}),"Discovery performs only fixed, read-only register requests.");
Check(!IntelPowerLimits.Read(new("GenuineIntel",6,0xFF,false),_=>throw new Exception("Must not read unknown model")).Available,"Unknown Intel model must refuse before reading.");
Check(!IntelPowerLimits.Read(new("AuthenticAMD",0x19,0xBA,false),_=>throw new Exception("Must not read AMD")).Available,"AMD cannot use Intel registers.");
Check(!IntelPowerLimits.Read(new("GenuineIntel",6,0xBA,true),_=>throw new UnauthorizedAccessException("denied")).Available,"Access denial remains unavailable, not invented data.");

Check(!adapter.Read().Fresh,"Do not trust an unchanged mapping at attach.");
Reject(()=>adapter.Send("manual",4),"Stale engine must refuse manual mode.");
Publish(1,128);
Check(adapter.Read().Fresh,"Engine publish must establish freshness.");
Check(adapter.Read().Rpm==3000,"RPM bytes must combine as little-endian tachometer.");
Check(adapter.Read().SecondaryRpm is null,"Invalid tachometer must be unavailable, never fabricated as zero.");
Reject(()=>adapter.Send("manual",0),"Fan-off level must be rejected.");
Reject(()=>adapter.Send("manual",65),"Unbounded fan level must be rejected.");
adapter.Send("manual",4);
Check(view.ReadInt32(88)==3&&view.ReadInt32(92)==-1,"Manual command must use reviewed offsets and disable smart selector.");
Check(view.ReadByte(96)==(byte)'4'&&view.ReadByte(97)==0,"Manual level must be null-terminated ASCII.");
Check(view.ReadInt32(4)==1&&adapter.OwnsManual,"Command sequence increments and lease ownership is established.");
Reject(()=>adapter.Send("manual",5),"Do not overwrite a pending external engine command.");
Publish(3,4);
Check(adapter.Read().RawLevel==4,"Read-back must preserve actual EC level.");
Check(System.Text.Json.JsonSerializer.SerializeToElement(adapter.FanSnapshot()).GetProperty("manualOwned").GetBoolean(),"Fan read-back exposes manual ownership separately from the reported mode.");
adapter.Renew(false);
Check(view.ReadInt32(88)==1,"Browser disconnect requests BIOS mode.");
Check(adapter.OwnsManual,"Keep restoration ownership until firmware ack and read-back.");
Publish(1,128);adapter.Watchdog();Check(!adapter.OwnsManual,"Release ownership after verified BIOS restoration.");
Check(!System.Text.Json.JsonSerializer.SerializeToElement(adapter.FanSnapshot()).GetProperty("manualOwned").GetBoolean(),"Firmware acknowledgement clears published manual ownership.");
view.Write(40,91);Publish(1,128);
Reject(()=>adapter.Send("manual",3),"Unsafe EC temperature must refuse manual mode.");
view.Write(40,55);Publish(1,128);adapter.Send("manual",3);Publish(3,3);
now=now.Add(TimeSpan.FromSeconds(11));Publish(3,3);adapter.Watchdog();
Check(view.ReadInt32(88)==1,"Lease expiration must request firmware mode independently of UI.");
Publish(1,128);adapter.Watchdog();
adapter.Send("manual",3);Publish(3,3);view.Write(40,86);Publish(3,3);adapter.Watchdog();
Check(view.ReadInt32(88)==1,"Thermal watchdog must request firmware mode.");
Publish(1,128);adapter.Watchdog();now=now.Add(TimeSpan.FromSeconds(13));
Check(!adapter.Read().Fresh,"Stopped engine becomes stale.");
Check(!TpfcAdapter.ThermalSafe(adapter.Read()),"Stale EC temperatures are unsafe.");
// Model an engine that still publishes telemetry but loses a command acknowledgement.
view.Write(40,55);Publish(1,128);adapter.Send("manual",4);
var lostManual=view.ReadInt32(4);
now=now.Add(TimeSpan.FromSeconds(11));view.Write(0,view.ReadInt32(0)+1);adapter.Watchdog();
Check(view.ReadInt32(88)==1&&view.ReadInt32(4)!=lostManual,"Expired pending manual command must be superseded by BIOS even without acknowledgement.");
var firstRestore=view.ReadInt32(4);
adapter.Renew(true);adapter.Watchdog();
Check(view.ReadInt32(4)==firstRestore,"Repeated UI polls must not flood pending BIOS requests.");
now=now.Add(TimeSpan.FromSeconds(6));view.Write(0,view.ReadInt32(0)+1);adapter.Watchdog();
Check(view.ReadInt32(4)!=firstRestore&&view.ReadInt32(88)==1,"Lost BIOS acknowledgement must be retried at a bounded cadence despite renewed UI lease.");
// Upstream acknowledges the mode command before SetFan writes the EC register.
Publish(1,4);adapter.Watchdog();
Check(adapter.OwnsManual,"Mode acknowledgement alone must not prove physical firmware restoration.");
Reject(()=>adapter.Send("manual",3),"Do not re-enter manual mode while physical restoration is unverified.");
Publish(1,128);adapter.Watchdog();
Check(!adapter.OwnsManual,"Only BIOS acknowledgement plus EC firmware bit completes restoration.");
adapter.Send("manual",4);view.Write(40,86);view.Write(0,view.ReadInt32(0)+1);adapter.Watchdog();
Check(view.ReadInt32(88)==1,"Thermal trip must supersede unacknowledged manual command immediately.");
Publish(1,128);adapter.Watchdog();view.Write(40,55);Publish(1,128);
view.Write(4,int.MaxValue);view.Write(8,int.MaxValue);adapter.Send("manual",2);
Check(view.ReadInt32(4)==int.MinValue,"Engine command sequence rollover must remain valid.");
Publish(3,2);adapter.Renew(false);Publish(1,128);adapter.Watchdog();
adapter.Send("manual",2);Publish(3,2);now=now.Add(TimeSpan.FromSeconds(10));Publish(3,2);adapter.Watchdog();
Check(view.ReadInt32(88)==1,"Elapsed-time lease must expire at the exact ten-second boundary.");
Publish(1,128);adapter.Watchdog();Check(!adapter.OwnsManual,"Elapsed-time recovery still requires firmware read-back.");
string FanMode()=>System.Text.Json.JsonSerializer.SerializeToElement(adapter.FanSnapshot()).GetProperty("mode").GetString()!;
Publish(2,128);Check(FanMode()=="auto","Smart fallback with firmware register must appear as firmware automatic.");
Publish(1,128);adapter.Send("manual",TpfcAdapter.FullSpeedLevel);Check(view.ReadByte(96)==(byte)'6'&&view.ReadByte(97)==(byte)'4'&&view.ReadByte(98)==0,"Full speed is sent as the engine's level 64.");
Publish(3,7);Check(FanMode()=="manual","The engine's level 7 stage on the way to full speed is manual.");adapter.Watchdog();
Publish(3,TpfcAdapter.FullSpeedLevel);adapter.Watchdog();Check(FanMode()=="manual"&&adapter.OwnsManual,"Full speed reads back as manual and stays under the lease.");
Reject(()=>adapter.Send("manual",8),"Levels between 7 and full speed are refused.");Reject(()=>adapter.Send("manual",128),"Firmware is never requested as a manual level.");
adapter.Send("auto",null);Publish(1,128);adapter.Watchdog();Check(!adapter.OwnsManual,"Full speed returns to firmware like any other level.");
adapter.SetManualTemperatureLimit(90);view.Write(40,86);Publish(1,128);
adapter.Send("manual",TpfcAdapter.FullSpeedLevel);Publish(3,64);adapter.Watchdog();
Check(adapter.OwnsManual&&view.ReadInt32(88)==3,"A configured 90 C limit permits Max above the former fixed 85 C cutoff.");
Reject(()=>adapter.SetManualTemperatureLimit(95),"Changing a cutoff during manual ownership must refuse.");
view.Write(40,90);Publish(3,64);adapter.Watchdog();Check(view.ReadInt32(88)==3&&adapter.OwnsManual,"Max cooling must stay active at the exact manual cutoff.");
view.Write(40,100);Publish(3,64);adapter.Renew(true);adapter.Watchdog();
Check(view.ReadInt32(88)==3&&adapter.OwnsManual,"Fresh, leased Max cooling must not decrease fan speed above the cutoff.");
adapter.Send("auto",null);Publish(1,128);adapter.Watchdog();
Publish(1,128);adapter.Watchdog();adapter.SetManualTemperatureLimit(86);
Reject(()=>adapter.Send("manual",7),"The selected cutoff also refuses new manual requests at its exact boundary.");
adapter.Send("manual",64);Publish(3,7);adapter.Watchdog();
Check(view.ReadInt32(88)==3&&adapter.OwnsManual,"A hot Max request must survive the engine's level-7 spin-up stage.");
Publish(3,64);adapter.Watchdog();now=now.Add(TimeSpan.FromSeconds(10));Publish(3,64);adapter.Watchdog();
Check(view.ReadInt32(88)==1,"Max cooling still releases at the exact lease timeout, even above the thermal cutoff.");
Publish(1,128);adapter.Watchdog();
adapter.SetManualTemperatureLimit(90);view.Write(40,100);Publish(1,128);adapter.Send("manual",64);Publish(3,64);adapter.Watchdog();
now=now.Add(TimeSpan.FromSeconds(13));adapter.Renew(true);adapter.Watchdog();
Check(view.ReadInt32(88)==1,"Raising a cutoff never bypasses stale-telemetry restoration even with a live UI lease.");
Publish(1,128);adapter.Watchdog();view.Write(40,0);Publish(1,128);
Reject(()=>adapter.Send("manual",64),"A custom cutoff cannot grant Max without a real temperature reading.");
view.Write(40,100);Publish(1,128);adapter.Send("manual",64);Publish(3,64);
view.Write(40,0);Publish(3,64);adapter.Renew(true);adapter.Watchdog();
Check(view.ReadInt32(88)==1,"Max cooling releases when real temperatures disappear, even with a renewed lease.");
Publish(1,128);adapter.Watchdog();
view.Write(40,55);Publish(1,128);adapter.SetManualTemperatureLimit(85);
Reject(()=>adapter.SetManualTemperatureLimit(111),"Implausible manual fan cutoffs refuse.");
const string manualIni="Active=2\r\nManModeExit=78\r\nLevel=0 1 0 0\r\nLevel=86 64 0 0\r\nSensorOffset11=30 -128 127\r\n";
var manualConfigured=FanCurveConfig.RewriteManualLimit(manualIni,90,false);
Check(FanCurveConfig.ManualLimit(manualConfigured)==(90,false)&&manualConfigured.Contains("SensorOffset11=30 -128 127")&&manualConfigured.Contains("Level=86 64 0 0"),"A manual cutoff updates only the explicit policy, preserving curves and offsets.");
Check(FanCurveConfig.RewriteManualLimit(manualConfigured,90,false)==manualConfigured,"Applying the same policy is idempotent.");
Check(FanCurveConfig.ManualLimit(FanCurveConfig.RewriteManualLimit(manualConfigured,86,true))==(86,true),"Automatic selection is persisted separately from its resolved engine value.");
Reject(()=>FanCurveConfig.RewriteManualLimit(manualIni,59,false),"Native cutoff bounds cannot be bypassed.");
Reject(()=>FanCurveConfig.RewriteManualLimit(manualIni+"ManModeExit=90\r\n",90,false),"Duplicate policy rows refuse rather than choosing one.");
Reject(()=>FanCurveConfig.ManualLimit(manualIni+"// ThinkPadControlManualLimitAutomatic=anything\r\n"),"Malformed automatic metadata refuses.");
Publish(2,4);Check(FanMode()=="curve","An engine curve level must be labeled as a curve, never firmware automatic.");
const int FullSpeedLevelForTest=TpfcAdapter.FullSpeedLevel;
const string curveIni="// Level=60 0 0 0\r\nActive=1\r\nStayOnTop=1\r\nLevel=0 128 0 0\r\nLevel2=0 128 0 0\r\n";
Publish(2,FullSpeedLevelForTest);Check(FanMode()=="curve","Maximum fan speed reached through a curve is still the curve.");
int[][] curveRows=[[50,0],[55,1],[61,2],[66,3],[71,4],[76,5],[81,6],[85,7],[86,64]];
var curvedIni=FanCurveConfig.Rewrite(curveIni,curveRows);var parsedCurve=FanCurveConfig.Parse(curvedIni)!;
Check(parsedCurve.Active==2&&parsedCurve.Rows.Length==9&&parsedCurve.Rows[8][1]==64&&curvedIni.Contains("Level2=0 128 0 0\r\n")&&curvedIni.Contains("// Level=60 0 0 0\r\n"),"A curve changes only the mode and Level lines.");
var firmwareIni=FanCurveConfig.Rewrite(curvedIni,null);Check(firmwareIni==curveIni,"Returning to firmware restores the installed default exactly.");
var maskedIni=FanCurveConfig.Rewrite(curveIni,curveRows,[[10,30]]);var parsedMasks=FanCurveConfig.Parse(maskedIni)!;
Check(maskedIni.Contains("SensorOffset11=30 -128 127\r\n")&&parsedMasks.Masks.Length==1&&parsedMasks.Masks[0][0]==10&&parsedMasks.Masks[0][1]==30&&!maskedIni.Contains("//SensorOffset"),"A flat slot adjustment uses the engine's one-based name and a range that avoids a second subtraction.");
Check(FanCurveConfig.Parse(FanCurveConfig.Rewrite(maskedIni,curveRows))!.Masks.Length==0,"Applying without an adjustment removes the earlier one.");
var dormantIni=FanCurveConfig.Rewrite(maskedIni,null);var dormantCurve=FanCurveConfig.Parse(dormantIni)!;
Check(dormantCurve.Active==1&&dormantCurve.Masks.Length==0&&dormantCurve.DormantMasks.Length==1&&dormantCurve.DormantMasks[0].SequenceEqual(new[]{10,30})&&!dormantIni.Contains("SensorOffset11="),"Firmware has raw readings and retains the prior offset only as an inert comment.");
Check(FanCurveConfig.Rewrite(dormantIni,null)==dormantIni,"Repeated firmware selection preserves dormant offsets.");
var restoredOffsets=FanCurveConfig.Parse(FanCurveConfig.Rewrite(dormantIni,curveRows,dormantCurve.DormantMasks))!;
Check(restoredOffsets.Masks[0].SequenceEqual(new[]{10,30})&&restoredOffsets.DormantMasks.Length==0,"Explicit curve restore reinstates offsets and clears dormant metadata.");
Check(FanCurveConfig.Rewrite(curveIni+"// ThinkPadControlDormantAdjustment999999999999999999999=30\r\n",null)==curveIni,"Malformed dormant metadata cannot block firmware cooling.");
Reject(()=>FanCurveConfig.Rewrite(curveIni,curveRows,[[0,30]]),"The reference CPU slot is never adjusted.");
Reject(()=>FanCurveConfig.Rewrite(curveIni,curveRows,[[10,71]]),"An adjustment can't exceed the permitted amount.");
Reject(()=>FanCurveConfig.Rewrite(curveIni,curveRows,[[10,30],[10,20]]),"A slot can't be adjusted twice.");
Reject(()=>FanCurveConfig.Validate([[50,1],[50,7],[90,64]]),"Curve temperatures must rise.");
Reject(()=>FanCurveConfig.Validate([[50,1],[60,7]]),"A curve must end at maximum fan speed.");
Reject(()=>FanCurveConfig.Validate([[50,1],[60,4],[90,64]]),"A curve must reach level 7 before maximum fan speed.");
Reject(()=>FanCurveConfig.Validate([[50,1],[60,7],[70,128]]),"Firmware is not a curve row.");Reject(()=>FanCurveConfig.Validate([[50,1],[60,7],[70,65]]),"Unreviewed fan values are refused.");
Reject(()=>FanCurveConfig.Rewrite("Level=0 128 0 0\r\n",curveRows),"An unexpected configuration layout is refused.");
Check(CpuPStateDecoder.DecodeIntelThermalTarget((5UL<<24)|(100UL<<16))==95&&CpuPStateDecoder.DecodeIntelThermalTarget(0) is null,"Intel thermal target decodes TjMax minus its offset, and refuses invalid values.");
Publish(1,255);Check(FanMode()=="unknown","Invalid EC sentinel must not be interpreted as a BIOS acknowledgement.");
Publish(3,65);Check(FanMode()=="unknown","Unbounded external manual mode is not a validated discrete level.");
Publish(1,128);adapter.Send("manual",2);Publish(3,2);adapter.Renew(false);Publish(1,255);adapter.Watchdog();
Check(adapter.OwnsManual,"Invalid EC sentinel cannot complete pending firmware restoration.");
Publish(1,128);adapter.Watchdog();Check(!adapter.OwnsManual,"A subsequent valid firmware register completes restoration.");
adapter.Send("auto",null);Check(adapter.Status.Contains("waiting"),"A repeated firmware request is still reported as pending.");
Publish(1,128);adapter.Watchdog();Check(adapter.Status.Contains("verified")&&!adapter.OwnsManual,"A repeated firmware request must not leave a stale waiting status.");
adapter.Send("manual",4);Publish(3,4);adapter.Watchdog();Check(adapter.Status.Contains("Manual fan level verified")&&adapter.OwnsManual,"An acknowledged manual level must clear its waiting status and keep ownership.");
adapter.Send("auto",null);Publish(1,128);adapter.Watchdog();Check(!adapter.OwnsManual,"Restoration still completes after a verified manual level.");
var fixedSlots=new int[12];fixedSlots[9]=1;fixedSlots[1]=128;
Check(!TpfcAdapter.ThermalSafe(new TpfcAdapter.State(1,0,0,1,128,0,null,fixedSlots,true)),"A slot fixed at 1 must not count as a valid temperature.");
fixedSlots[0]=50;Check(TpfcAdapter.ThermalSafe(new TpfcAdapter.State(1,0,0,1,128,0,null,fixedSlots,true)),"A real reading beside fixed slots stays valid.");
Check(ThermalReadings.IsGpuCoreSensor("GPU Core")&&!ThermalReadings.IsGpuCoreSensor("GPU VR SoC")&&!ThermalReadings.IsGpuCoreSensor("GPU VR Core")&&!ThermalReadings.IsGpuCoreSensor("GPU Hot Spot"),"Only a core sensor counts as the GPU temperature.");
now=now.Add(TimeSpan.FromSeconds(13));
var staleFan=System.Text.Json.JsonSerializer.SerializeToElement(adapter.FanSnapshot());
Check(staleFan.GetProperty("mode").GetString()=="unknown","Stale firmware mode must not be displayed as current automatic control.");
Check(staleFan.GetProperty("rpm").ValueKind==System.Text.Json.JsonValueKind.Null&&staleFan.GetProperty("level").ValueKind==System.Text.Json.JsonValueKind.Null,"Stale tachometer and fan level must both be unavailable.");
Publish(1,128);
view.Write(32,184);view.Write(36,11);Publish(1,128);
var primaryOnly=System.Text.Json.JsonSerializer.SerializeToElement(adapter.FanSnapshot());
Check(primaryOnly.GetProperty("rpm").GetInt32()==3000&&primaryOnly.GetProperty("secondaryRpm").ValueKind==System.Text.Json.JsonValueKind.Null,"Mirrored primary RPM in SingleFan mode must not fabricate a second physical fan.");
Check(TpfcEngineTrust.ImageMatches("\"C:\\Program Files\\ThinkPad Control\\engine\\TPFanControl.exe\" -s",@"C:\Program Files\ThinkPad Control\engine\TPFanControl.exe"),"Owned quoted service image must match.");
Check(!TpfcEngineTrust.ImageMatches("\"C:\\Program Files\\TPFanCtrl2\\TPFanControl.exe\" -s",@"C:\Program Files\ThinkPad Control\engine\TPFanControl.exe"),"External service is not the bundled engine.");
Check(!TpfcEngineTrust.ImageMatches("C:\\Program Files\\ThinkPad Control\\engine\\TPFanControl.exe -s extra",@"C:\Program Files\ThinkPad Control\engine\TPFanControl.exe"),"Ambiguous or extra service arguments are refused.");
Check(TpfcEngineTrust.ReviewedEngineSha256 == (args.Length == 1 ? args[0] : "8930720F8BBD1E4CC72670D24237C50F3FFB7E51E87B4DBFEF9A85FFE88ACCC3"),"Engine trust hash must match this release build.");
// Only an isolated test pipe: no worker, hardware library, driver or global EC map.
var testOwner=System.Security.Principal.WindowsIdentity.GetCurrent().User!;
var testSecurity=new System.IO.Pipes.PipeSecurity();testSecurity.SetAccessRuleProtection(true,false);testSecurity.SetOwner(testOwner);
testSecurity.AddAccessRule(new System.IO.Pipes.PipeAccessRule(testOwner,System.IO.Pipes.PipeAccessRights.FullControl,System.Security.AccessControl.AccessControlType.Allow));
var testPipeName="ThinkPadControl_LabelTest_"+Guid.NewGuid().ToString("N");
using(var testPipe=System.IO.Pipes.NamedPipeServerStreamAcl.Create(testPipeName,System.IO.Pipes.PipeDirection.InOut,1,System.IO.Pipes.PipeTransmissionMode.Byte,System.IO.Pipes.PipeOptions.Asynchronous,1024,1024,testSecurity,additionalAccessRights:System.IO.Pipes.PipeAccessRights.TakeOwnership)) {
    MandatoryPipeLabel.Apply(testPipe.SafePipeHandle);
    Check(MandatoryPipeLabel.Read(testPipe.SafePipeHandle).Contains("(ML;;NW;;;ME)"),"The isolated pipe must retain a medium no-write-up label without requesting audit privilege.");
    var connected=testPipe.WaitForConnectionAsync();
    using var testClient=new System.IO.Pipes.NamedPipeClientStream(".",testPipeName,System.IO.Pipes.PipeDirection.InOut);
    testClient.Connect(3000);connected.GetAwaiter().GetResult();
    Check(testPipe.IsConnected,"The same user's standard-token client can connect to its labeled pipe.");
}
void ValidateConnection(string payload) {
    using var document=System.Text.Json.JsonDocument.Parse(payload);
    ThinkPad.Desktop.BackendHost.ValidateHardwareSnapshot(document.RootElement);
}
Reject(()=>ValidateConnection("{}"),"Missing readiness evidence must not report connected hardware.");
Reject(()=>ValidateConnection("""{"stale":false,"error":null,"snapshot":{"driver":null}}"""),"A degraded API without a worker must fail the elevation handshake.");
Reject(()=>ValidateConnection("""{"stale":false,"error":null,"snapshot":{"driver":{"administrator":false}}}"""),"A standard worker must not satisfy elevated readiness.");
Reject(()=>ValidateConnection("""{"stale":true,"error":null,"snapshot":{"driver":{"administrator":true}}}"""),"A stale elevated snapshot must not satisfy readiness.");
Reject(()=>ValidateConnection("""{"stale":false,"error":"Worker disconnected","snapshot":{"driver":{"administrator":true}}}"""),"A failed refresh must not reuse old elevated evidence.");
ValidateConnection("""{"stale":false,"error":null,"snapshot":{"driver":{"administrator":true,"deviceAccessible":false},"fans":[],"sensors":[]}}""");
Check(true,"Confirmed worker elevation is independent from driver/sensor availability.");
Check(Math.Abs(ThermalReadings.AcpiCelsius(3402)!.Value-67.05f)<0.001,"ACPI tenths Kelvin must convert correctly.");
Check(ThermalReadings.AcpiCelsius(0) is null && ThermalReadings.AcpiCelsius(uint.MaxValue) is null,"Firmware sentinels must remain unavailable.");
var pmBytes=new byte[0x948];BitConverter.GetBytes(61.25f).CopyTo(pmBytes,0x640);
var pmTable=new long[pmBytes.Length/8];Buffer.BlockCopy(pmBytes,0,pmTable,0,pmBytes.Length);
Check(ThermalReadings.ApuGfx(13,0x400005,pmTable)==61.25f,"Cezanne GFX uses offset 0x640 independently of CPU temperature.");
Check(ThermalReadings.ApuGfx(13,0x400099,pmTable) is null && ThermalReadings.ApuGfx(10,0x400005,pmTable) is null && ThermalReadings.ApuGfx(13,0x400005,[]) is null,"Unknown SMU versions, codenames and truncated tables must be refused.");
BitConverter.GetBytes(float.NaN).CopyTo(pmBytes,0x640);Buffer.BlockCopy(pmBytes,0,pmTable,0,pmBytes.Length);
Check(ThermalReadings.ApuGfx(13,0x400005,pmTable) is null,"Invalid SMU floats must remain unavailable.");
Check(ThermalReadings.InheritsApuReading(@"PCI\VEN_1002&DEV_1638&SUBSYS_509517AA",1) && !ThermalReadings.InheritsApuReading(@"PCI\VEN_1002&DEV_16380&SUBSYS_1",1) && !ThermalReadings.InheritsApuReading(@"PCI\VEN_10DE&DEV_1638&SUBSYS_1",1) && !ThermalReadings.InheritsApuReading(@"PCI\VEN_1002&DEV_1638&SUBSYS_1",2),"APU readings must not be assigned to other vendors, malformed IDs or an ambiguous second AMD GPU.");
// Isolated SMU command policy tests: fake transport, never touches hardware.
var limits=new RyzenLimits(15,25,20,95);var tuningWrites=0;
void SetLimit(string key,float value){tuningWrites++;limits=key switch{"sustainedWatts"=>limits with{SustainedWatts=value},"fastWatts"=>limits with{FastWatts=value},"slowWatts"=>limits with{SlowWatts=value},_=>limits with{TemperatureLimit=value}};}
var tuning=new RyzenController(()=>limits,SetLimit);tuning.Observe();
tuning.Apply("sustainedWatts",12,false);Check(limits.SustainedWatts==12&&tuning.Baseline!.SustainedWatts==15,"SMU writes must verify and retain the connection baseline.");
tuning.Apply("temperatureLimit",80,false);tuning.Apply("temperatureLimit",null,true);Check(limits.TemperatureLimit==95,"Restoring a valid baseline can exceed the UI custom ceiling without pretending to restore factory defaults.");
foreach(var invalid in new[]{float.NaN,float.PositiveInfinity,0,26,12.34f}) {try{tuning.Apply("sustainedWatts",invalid,false);throw new Exception("Unsafe tuning accepted.");}catch(ArgumentException){checks++;}}
var writeCount=tuningWrites;try{tuning.Apply("rawRegister",1,false);throw new Exception("Unknown tuning accepted.");}catch(ArgumentException){Check(tuningWrites==writeCount,"Unknown fields must not issue firmware writes.");}
limits=limits with{SustainedWatts=18};tuning.Observe();Check(tuning.Status.Contains("Firmware changed"),"Firmware override must be reported without automatic reapplication.");
var rejects=new RyzenController(()=>limits,(_,_)=>{});rejects.Observe();Reject(()=>rejects.Apply("fastWatts",30,false),"Acknowledged-but-ignored SMU writes must fail read-back and verify rollback.");
Check(rejects.Unavailable.ContainsKey("fastWatts"),"Unverified settings must become read-only until reconnect, independently of other controls.");
var broken=new RyzenController(()=>limits,(_,_)=>throw new IOException("simulated write failure"));broken.Observe();Reject(()=>broken.Apply("slowWatts",18,false),"Failed recovery must not claim success.");Check(broken.Status.Contains("UNVERIFIED"),"A failed rollback must remain explicit.");
RyzenLimits flakyLimits=new(28,28,24,86);var failNextRead=false;
var flaky=new RyzenController(()=>{if(failNextRead){failNextRead=false;throw new IOException("simulated table read failure");}return flakyLimits;},(_,value)=>{flakyLimits=flakyLimits with{SlowWatts=value};failNextRead=true;});flaky.Observe();
Check(flaky.Apply("slowWatts",23,false).Contains("verified")&&flaky.Unavailable.IsEmpty&&flakyLimits.SlowWatts==23,"A failed table read after a write must be retried, not treated as a rejected write.");
RyzenLimits coupledLimits=new(28,28,24,86);
var coupled=new RyzenController(()=>coupledLimits,(key,value)=>{if(key=="fastWatts")coupledLimits=coupledLimits with{FastWatts=value,SustainedWatts=MathF.Min(value,coupledLimits.SustainedWatts)};});coupled.Observe();
Check(coupled.Apply("fastWatts",27,false).Contains("Firmware also changed: sustainedWatts = 27."),"A limit that moves with the written one must be reported.");
Check(coupled.Apply("fastWatts",null,true).Contains("Still different from the connection baseline: sustainedWatts = 27."),"A restore must say when another limit has not returned yet.");
coupledLimits=coupledLimits with{SustainedWatts=28};Check(!coupled.Apply("fastWatts",null,true).Contains("sustainedWatts"),"Nothing is added once every limit is back.");
foreach(var fixture in new[]{(6L,0x1E0004u,0x3B10564u,0x1Bu,0x58),(2L,0x1E0005u,0x3B10564u,0x1Bu,0x58),(1L,0x370005u,0x3B10564u,0x15u,0x40),(22L,0x370004u,0x3B10564u,0x15u,0x40),(13L,0x400005u,0x3B10564u,0x15u,0x40),(10L,0x450005u,0x3B10578u,0x15u,0x40),(23L,0x4C0007u,0x3B10578u,0x15u,0x40),(30L,0x4C0009u,0x3B10578u,0x15u,0x40),(31L,0x5D0008u,0x3B10978u,0x15u,0x40),(32L,0x64020Cu,0x3B10978u,0x15u,0x58),(33L,0x650005u,0x3B10978u,0x15u,0x40)}) {
    var profile=RyzenProfile.Resolve(fixture.Item1,fixture.Item2);
    Check(profile.Response==fixture.Item3 && profile.Command("fastWatts")==fixture.Item4 && profile.ThermalOffset==fixture.Item5,"Family routing, message IDs and thermal offsets must match the reviewed protocol.");
    var bytes=new byte[((profile.ReadBytes+7)/8)*8];BitConverter.GetBytes(15f).CopyTo(bytes,0);BitConverter.GetBytes(25f).CopyTo(bytes,8);BitConverter.GetBytes(18f).CopyTo(bytes,16);BitConverter.GetBytes(86f).CopyTo(bytes,profile.ThermalOffset);
    var data=new long[bytes.Length/8];Buffer.BlockCopy(bytes,0,data,0,bytes.Length);Check(profile.Decode(data)==new RyzenLimits(15,25,18,86),"Each family must decode its own verified header without consuming unrelated physical memory.");
}
Reject(()=>RyzenProfile.Resolve(13,0x450005),"A Cezanne CPU must never use a Rembrandt table.");
Reject(()=>RyzenProfile.Resolve(3,0x400005),"Desktop models must never inherit mobile mailbox commands.");
Reject(()=>RyzenProfile.Resolve(23,0x4C0003),"Unreviewed thermal layouts must remain unavailable.");
Reject(()=>RyzenProfile.Resolve(10,0x450006),"Unknown firmware tables must require review.");
const ulong pstateEnabled=1UL<<63;
Check(CpuPStateDecoder.AmdMhz(0x19,pstateEnabled|(10UL<<8)|115)==2300,"Family 19h P-state: 200 x FID / DID.");
Check(CpuPStateDecoder.AmdMhz(0x17,pstateEnabled|(8UL<<8)|144)==3600,"Family 17h uses the same layout.");
Check(CpuPStateDecoder.AmdMhz(0x19,(10UL<<8)|115) is null,"A disabled P-state must not be listed.");
Check(CpuPStateDecoder.AmdMhz(0x19,pstateEnabled|115) is null,"A zero divisor must be refused, not divided.");
Check(CpuPStateDecoder.AmdMhz(0x1A,pstateEnabled|1000)==5000,"Family 1Ah P-state: 5 MHz x 12-bit FID.");
Check(CpuPStateDecoder.AmdMhz(0x1A,pstateEnabled|0xF) is null,"Family 1Ah FID at or below 0xF is invalid.");
Check(CpuPStateDecoder.AmdMhz(0x15,pstateEnabled|(10UL<<8)|115) is null,"An unreviewed AMD family must not inherit a layout.");
Check(CpuPStateDecoder.AmdMhz(0x19,pstateEnabled|(1UL<<8)|255) is null,"An out-of-range frequency must be refused.");
Check(CpuPStateDecoder.DecodeAmd(0x19,[pstateEnabled|(10UL<<8)|115,0,pstateEnabled|(10UL<<8)|70]).Select(s=>s.Label+s.Mhz).SequenceEqual(["P02300","P21400"]),"P-state labels must keep their hardware index.");
Check(CpuPStateDecoder.DecodeIntel((8UL<<40)|(26UL<<8)).Select(s=>s.Mhz).SequenceEqual([2600,800]),"Intel PLATFORM_INFO base and minimum ratios.");
Check(CpuPStateDecoder.DecodeIntel(26UL<<8).Count==0,"A missing Intel minimum ratio must give no states.");
Check(CpuPStateDecoder.DecodeIntel((30UL<<40)|(26UL<<8)).Count==0,"An Intel minimum above base must be refused.");
var westmere=new CpuIdentity("GenuineIntel",6,0x25,false);
var oldReference=CpuPStateDecoder.IntelReferenceMhz(westmere);
Check(oldReference==400d/3d,"Westmere ThinkPads use the nominal 133 1/3 MHz ratio reference.");
Check(CpuPStateDecoder.DecodeIntel((12UL<<40)|(20UL<<8),oldReference!.Value).Select(s=>s.Mhz).SequenceEqual([2667,1600]),"Legacy Intel ratios must not be decoded as 2000/1200 MHz.");
Check(CpuPStateDecoder.DecodeIntelTurbo(22,2667,false,oldReference.Value).SequenceEqual([2933]),"Legacy turbo must use the same reference as its base frequency.");
foreach(var model in new[]{0x2A,0x3A,0x45,0x4E,0x8E,0x7E,0x8C,0x9A,0xBA,0xAA,0xBD,0xC5})
    Check(CpuPStateDecoder.IntelReferenceMhz(new("GenuineIntel",6,model,false))==100,"Reviewed Sandy Bridge through Core Ultra client reference.");
foreach(var cpu in new[]{new CpuIdentity("GenuineIntel",6,0x17,false),new("GenuineIntel",6,0x1C,false),new("GenuineIntel",6,0xFF,true),new("GenuineIntel",0xF,0x2A,false),new("AuthenticAMD",6,0x2A,false)})
    Check(CpuPStateDecoder.IntelReferenceMhz(cpu) is null,"Unreviewed Intel reference layouts and other vendors must not inherit 100 MHz.");
Check(CpuPStateDecoder.DecodeIntel((8UL<<40)|(26UL<<8),166).Count==0&&CpuPStateDecoder.DecodeIntelTurbo(44,2600,false,double.NaN).Count==0,"Decoder must refuse unreviewed or nonfinite ratio references.");
int Reg(string text)=>BitConverter.ToInt32(System.Text.Encoding.ASCII.GetBytes(text));
var cezanneCpu=CpuPStateDecoder.Identify(Reg("Auth"),Reg("cAMD"),Reg("enti"),0x00A50F00,0);
Check(cezanneCpu==new CpuIdentity("AuthenticAMD",0x19,0x50,false),"CPUID must decode AMD vendor, extended family and model.");
var raptorCpu=CpuPStateDecoder.Identify(Reg("Genu"),Reg("ntel"),Reg("ineI"),0x000B06A2,1<<15);
Check(raptorCpu==new CpuIdentity("GenuineIntel",6,0xBA,true),"CPUID must decode Intel vendor, model and hybrid flag.");
Check(!CpuPStateDecoder.Identify(Reg("Auth"),Reg("cAMD"),Reg("enti"),0x00A50F00,1<<15).Hybrid,"The Intel hybrid bit must not be applied to AMD.");
var gfxOffsets=new (long Code,uint Table,int Bytes,int Offset)[]{(1,0x370000,0x794,0x5AC),(22,0x370003,0x8AC,0x5AC),(1,0x370005,0x8C8,0x5C8),(13,0x400001,0x910,0x604),(13,0x400002,0x928,0x61C),(13,0x400003,0x94C,0x63C),(13,0x400004,0x944,0x640),(31,0x5D000B,0xD54,0x4C8),(32,0x64020C,0xE50,0x550)};
foreach(var g in gfxOffsets){Check(RyzenProfile.GfxMapping(g.Code,g.Table)==(g.Bytes,g.Offset),$"Reviewed GFX mapping 0x{g.Table:X}.");var gfxBytes=new byte[(g.Bytes+7)/8*8];BitConverter.GetBytes(55.5f).CopyTo(gfxBytes,g.Offset);var gfxTable=new long[gfxBytes.Length/8];Buffer.BlockCopy(gfxBytes,0,gfxTable,0,gfxBytes.Length);Check(ThermalReadings.ApuGfx(g.Code,g.Table,gfxTable)==55.5f,$"GFX temperature must read from table 0x{g.Table:X} at its own offset.");}
foreach(var (code,table) in new (long,uint)[]{(10,0x450005),(23,0x4C0009),(33,0x650005),(2,0x1E0005),(13,0x370005),(31,0x400005)})Check(RyzenProfile.GfxMapping(code,table) is null,"A family without a reviewed offset, or a table from another family, must stay unavailable.");
Check(RyzenProfile.Resolve(10,0x450005).SustainedFallback==(0x3B10A20u,0x3B10A80u,0x3B10A88u,0x31u)&&RyzenProfile.Resolve(31,0x5D0008).SustainedFallback is not null,"Reviewed STAPM fallback for the common family group.");
Check(RyzenProfile.Resolve(2,0x1E0005).SustainedFallback is null,"The older Raven group has no reviewed STAPM fallback.");
RyzenLimits highPower=new(45,65,54,100);var workstation=new RyzenController(()=>highPower,(key,value)=>{highPower=key switch{"fastWatts"=>highPower with{FastWatts=value},_=>highPower};});
Check(workstation.Range("fastWatts").Max==40,"Before a baseline exists, the conservative ceiling applies.");workstation.Observe();
Check(workstation.Range("fastWatts")==(5,65)&&workstation.Range("sustainedWatts").Max==45&&workstation.Range("temperatureLimit").Max==100,"A machine may use its own higher firmware limits.");
workstation.Apply("fastWatts",60,false);Check(highPower.FastWatts==60,"A higher-power machine can use its own range.");
try{workstation.Apply("fastWatts",66,false);throw new Exception("Nothing above the value firmware reported may be requested.");}catch(ArgumentException){checks++;}
var lowPower=new RyzenController(()=>limits,(_,_)=>{});lowPower.Observe();Check(lowPower.Range("fastWatts").Max==40,"A lower-power machine keeps the conservative ceiling.");
Check(CpuPStateDecoder.DecodeCppc(0xB7_64_29_11UL)==new CppcCapabilities(0xB7,0x64,0x29,0x11),"CPPC bytes run lowest, lowest nonlinear, nominal, highest.");
Check(CpuPStateDecoder.DecodeCppc(0) is null&&CpuPStateDecoder.DecodeCppc(0x50_64_29_11UL) is null&&CpuPStateDecoder.DecodeCppc(0xB7_64_70_11UL) is null,"Empty or out-of-order CPPC values must be refused.");
Check(CpuPStateDecoder.DecodeIntelTurbo(0x20_20_22_24_26_28UL,2600,false).SequenceEqual([4000,3800,3600,3400,3200,3200]),"Intel turbo bytes are by active core count, ending at the first empty byte.");
Check(CpuPStateDecoder.DecodeIntelTurbo(0x20_20_22_24_26_28UL,2600,true).SequenceEqual([4000]),"Intel hybrid trusts only the top ratio.");
Check(CpuPStateDecoder.DecodeIntelTurbo(0x28_20UL,2600,false).Count==0&&CpuPStateDecoder.DecodeIntelTurbo(0x10UL,2600,false).Count==0&&CpuPStateDecoder.DecodeIntelTurbo(0xFFUL,2600,false).Count==0,"A rising, below-base or impossible turbo table must be refused.");
foreach(var scenario in new[]{"restored","ignored","changed-plan","unreadable","success"}) {
    var originalScheme="3ee21118-1234-4321-9876-0a1b2c3d4e5f";
    var activeScheme=originalScheme;var acMode=2;var dcMode=4;var failed=false;var activations=0;
    string PolicyRunner(string[] arguments) {
        if(arguments[0]=="/getactivescheme") {
            if(failed&&scenario=="unreadable")throw new InvalidOperationException("Policy read unavailable");
            return activeScheme;
        }
        if(arguments[0]=="/qh")return $"0x{acMode:X8}\n0x{dcMode:X8}";
        if(arguments[0]=="/setacvalueindex") {if(!(failed&&scenario=="ignored"))acMode=int.Parse(arguments[4]);return "";}
        if(arguments[0]=="/setdcvalueindex"){dcMode=int.Parse(arguments[4]);return "";}
        if(arguments[0]=="/setactive") {
            activations++;
            if(!failed&&scenario!="success") {failed=true;if(scenario=="changed-plan")activeScheme="11111111-1234-4321-9876-0a1b2c3d4e5f";throw new InvalidOperationException("Activation failure after write");}
            activeScheme=arguments[1];return "";
        }
        throw new InvalidOperationException("Unexpected policy operation");
    }
    string? failure=null;string? response=null;
    try{response=PowerPolicy.ApplyWithRunner("ac",true,PolicyRunner);}catch(InvalidOperationException e){failure=e.Message;}
    if(scenario=="success")Check(response?.Contains("verified")==true&&acMode==1&&dcMode==4,"Native successful boost read-back must leave the battery index alone.");
    else if(scenario=="restored")Check(failure?.Contains("restored and verified")==true&&acMode==2&&dcMode==4,"Native recovery must read back the original boost index.");
    else {
        Check(failure?.Contains("Rollback incomplete or unverified")==true&&!failure.Contains("restored and verified"),"Native ignored/changed-plan/unreadable recovery must not claim restoration.");
        if(scenario=="changed-plan")Check(activeScheme!=originalScheme&&activations==1,"Native recovery must not reactivate an old plan after detecting a change.");
    }
}
{
    var acMode=2;var dcMode=4;var failed=false;
    string PartialWriteRunner(string[] arguments) {
        if(arguments[0]=="/getactivescheme")return "3ee21118-1234-4321-9876-0a1b2c3d4e5f";
        if(arguments[0]=="/qh")return $"0x{acMode:X8}\n0x{dcMode:X8}";
        if(arguments[0]=="/setacvalueindex")acMode=int.Parse(arguments[4]);
        if(arguments[0]=="/setdcvalueindex") {dcMode=int.Parse(arguments[4]);if(!failed){failed=true;throw new InvalidOperationException("Child failed after writing DC");}}
        return "";
    }
    string? failure=null;try{PowerPolicy.ApplyWithRunner("all",true,PartialWriteRunner);}catch(InvalidOperationException e){failure=e.Message;}
    Check(failure?.Contains("restored and verified")==true&&acMode==2&&dcMode==4,"A process error after a physical write must restore and verify both attempted sources.");
    var ran=false;try{PowerPolicy.ApplyWithRunner("ac;invalid",true,_=>{ran=true;return "";});}catch(ArgumentException){}
    Check(!ran,"Invalid native policy sources must be refused before querying or executing a policy command.");
}
foreach(var scenario in new[]{"success","restored","ignored","unreadable","partial","unsupported"}) {
    var gpuEnabled=false;var queries=0;var writes=0;var scoped=true;
    string GpuRunner(string[] arguments) {
        scoped&=arguments[0]=="-i"&&arguments[1]=="GPU-a123";
        if(arguments[2]=="--query-gpu=auto_boost.default") {
            queries++;
            if(scenario=="unsupported")return "[N/A]";
            if((scenario=="unreadable"&&queries>1)||((scenario is "restored" or "ignored")&&queries==2))throw new InvalidOperationException("Driver query failed");
            return gpuEnabled?"Enabled":"Disabled";
        }
        writes++;
        if(!(scenario=="ignored"&&writes>1))gpuEnabled=arguments[2].EndsWith("=1");
        if(scenario=="partial"&&writes==1)throw new InvalidOperationException("Driver failed after writing");
        return "";
    }
    string? failure=null;string? response=null;
    try{response=PowerPolicy.ApplyGpuWithRunner("GPU-a123",true,GpuRunner);}catch(InvalidOperationException e){failure=e.Message;}
    Check(scoped,"GPU query/write/restoration must stay scoped to the requested UUID.");
    if(scenario=="success")Check(response?.Contains("verified")==true&&gpuEnabled&&writes==1,"Native GPU success must verify the exact default policy.");
    else if(scenario=="unsupported")Check(failure?.Contains("not supported")==true&&writes==0,"Unknown native GPU default must refuse before writes.");
    else if(scenario is "restored" or "partial")Check(failure?.Contains("Original GPU default restored and verified")==true&&!gpuEnabled&&writes==2,"Native GPU failures after writes must restore and verify the original default.");
    else Check(failure?.Contains("Rollback incomplete or unverified")==true&&!failure.Contains("restored and verified")&&writes==2,"Ignored or unreadable native GPU restoration must remain unverified.");
}
{
    var ran=false;try{PowerPolicy.ApplyGpuWithRunner("-i;invalid",true,_=>{ran=true;return "";});}catch(ArgumentException){}
    Check(!ran,"Invalid GPU identifiers must refuse before any driver operation.");
}
{
    var closes=0;var queries=0;
    using var failed=new SensorSession<object,int>(()=>throw new Exception("open failed"),()=>closes++,()=>{queries++;return [];},_=>[],_=>{},_=>[],_=>"device");
    Check(!failed.Initialized&&!failed.Refresh().Complete&&failed.Refresh().Sensors.Count==0&&queries==0&&closes==1,"Failed initialization must close resources and never expose readings.");
}
{
    var cpu=new FakeSensorDevice("cpu",42);var gpu=new FakeSensorDevice("gpu",55);var closes=0;
    using var session=new SensorSession<FakeSensorDevice,int>(()=>{},()=>closes++,()=>[cpu,gpu],d=>d.Children,d=>{d.Updates++;if(d.Fail)throw new Exception("failed");},d=>d.Values,d=>d.Name);
    Check(session.Refresh().Complete&&session.Current.Sensors.SequenceEqual(new[]{42,55}),"Healthy devices must return fresh readings.");
    gpu.Fail=true;cpu.Values=[43];
    Check(!session.Refresh().Complete&&session.Current.Sensors.SequenceEqual(new[]{43}),"A failed GPU must disappear without retaining its last value or hiding healthy CPU data.");
    gpu.Fail=false;gpu.Values=[56];
    Check(session.Refresh().Complete&&session.Current.Sensors.SequenceEqual(new[]{43,56}),"A recovered provider must return current readings.");
    var child=new FakeSensorDevice("child",99);gpu.Children.Add(child);gpu.Fail=true;session.Refresh();
    Check(child.Updates==0&&!session.Current.Devices.Contains(child),"A failed parent must exclude its descendants.");
    gpu.Fail=false;child.Children.Add(gpu);
    Check(!session.Refresh().Complete&&session.Current.Devices.Count==3,"Cyclic device trees must terminate and mark the cycle incomplete.");
    session.Dispose();session.Dispose();
    Check(!session.Refresh().Complete&&session.Current.Sensors.Count==0&&closes==1,"Disposed sessions must expose no stale readings and close once.");
}
{
    IEnumerable<int> BrokenSensors(){yield return 90;throw new Exception("partial enumeration");}
    using var partial=new SensorSession<object,int>(()=>{},()=>{},()=>[new object()],_=>[],_=>{},_=>BrokenSensors(),_=>"partial");
    Check(!partial.Refresh().Complete&&partial.Current.Sensors.Count==0,"Partial sensor enumeration must not leak incomplete device values.");
    var healthy=new object();
    IEnumerable<object> BrokenRoots(){yield return healthy;throw new Exception("roots failed");}
    using var roots=new SensorSession<object,int>(()=>{},()=>{},BrokenRoots,_=>[],_=>{},_=>[42],_=>"healthy");
    Check(!roots.Refresh().Complete&&roots.Current.Sensors.SequenceEqual(new[]{42}),"Root enumeration failure must preserve only fresh successfully enumerated devices.");
}
{
    Check(SensorReadings.Normalize(float.NaN)==null&&SensorReadings.Normalize(float.PositiveInfinity)==null,"Non-finite telemetry must be unavailable.");
    Check(SensorReadings.Normalize(0)==0&&SensorReadings.Normalize(0,positive:true)==null,"Real zero RPM/load must survive while positive-only metrics reject zero.");
    Check(SensorReadings.Clock(0,"Core #1 (Effective)")==0&&SensorReadings.Clock(0,"Core #1")==null&&SensorReadings.Clock(float.NaN,"Cores (Average Effective)")==null,"Idle effective clocks may be zero; raw zero and nonfinite clock readings remain unavailable.");
    Check(SensorReadings.Normalize(-1,temperature:true)==null,"Invalid temperatures must remain unavailable.");
    var bytes=System.Text.Encoding.ASCII.GetBytes("AMD Ryzen 5 PRO 5650U".PadRight(48,'\0'));
    var words=Enumerable.Range(0,12).Select(i=>BitConverter.ToInt32(bytes,i*4)).ToArray();
    Check(CpuPStateDecoder.DecodeBrand(words)=="AMD Ryzen 5 PRO 5650U"&&CpuPStateDecoder.DecodeBrand(new int[12])==null&&CpuPStateDecoder.DecodeBrand([1])==null,"CPUID brand decoding must trim padding and refuse malformed/blank data.");
}
{
    var sensorGate=new object();using var held=new ManualResetEventSlim();using var release=new ManualResetEventSlim();
    var holder=Task.Run(()=>{lock(sensorGate){held.Set();release.Wait();}});
    var primary=0;var dependent=0;
    try{
        Check(held.Wait(TimeSpan.FromSeconds(5)),"Sensor-lock fixture must acquire its lock.");
        var tick=Task.Run(()=>IndependentWatchdog.Tick(sensorGate,()=>Interlocked.Increment(ref primary),()=>Interlocked.Increment(ref dependent)));
        Check(tick.Wait(TimeSpan.FromSeconds(5))&&primary==1&&dependent==0,"Primary fan lease must run without waiting behind a blocked sensor provider.");
    }finally{release.Set();holder.Wait();}
    IndependentWatchdog.Tick(sensorGate,()=>primary++,()=>dependent++);
    Check(primary==2&&dependent==1,"Sensor-dependent controls must still run when the sensor gate is free.");
}
Check(PrivatePipe.IsBundledRuntime(@"C:\Program Files\ThinkPad Control\runtime\node.exe",@"C:\Program Files\ThinkPad Control\bridge\")&&PrivatePipe.IsBundledRuntime(@"c:\program files\thinkpad control\RUNTIME\NODE.EXE",@"C:\Program Files\ThinkPad Control\bridge"),"The bundled runtime may connect to its worker.");
Check(!PrivatePipe.IsBundledRuntime(@"C:\Program Files\nodejs\node.exe",@"C:\Program Files\ThinkPad Control\bridge\")&&!PrivatePipe.IsBundledRuntime(@"C:\Users\me\runtime\node.exe",@"C:\Program Files\ThinkPad Control\bridge\")&&!PrivatePipe.IsBundledRuntime(null,@"C:\Program Files\ThinkPad Control\bridge\")&&!PrivatePipe.IsBundledRuntime("",@"C:\Program Files\ThinkPad Control\bridge\"),"Any other program is refused.");
const string taskJson="{\"taskName\":\"ThinkPad Control Hardware Worker\",\"pipe\":\"ThinkPadControl-0123456789abcdef0123456789abcdef\",\"owner\":\"S-1-5-21-1\"}";
Check(WorkerTask.Parse(taskJson,"S-1-5-21-1")?.Pipe=="ThinkPadControl-0123456789abcdef0123456789abcdef","A valid worker task for this account is accepted.");
Check(WorkerTask.Parse(taskJson,"S-1-5-21-2") is null,"Another Windows account falls back instead of using this task.");
Check(WorkerTask.Parse(taskJson.Replace("ThinkPad Control Hardware Worker","Other Task"),"S-1-5-21-1") is null&&WorkerTask.Parse(taskJson.Replace("ThinkPadControl-0123","evil-0123"),"S-1-5-21-1") is null&&WorkerTask.Parse("{}","S-1-5-21-1") is null&&WorkerTask.Parse("not json","S-1-5-21-1") is null,"Unexpected task details are refused.");
Console.WriteLine($"PASS: {checks} native fan protocol/desktop readiness assertions. No hardware writes.");

sealed class FakeSensorDevice(string name,int value)
{
    public string Name=name;
    public int[] Values=[value];
    public List<FakeSensorDevice> Children=[];
    public bool Fail;
    public int Updates;
}






