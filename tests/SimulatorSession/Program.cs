void Check(bool ok,string message){if(!ok)throw new Exception(message);}
foreach(var auto in new[]{false,true}) {
 var s=new SimulatorSession(auto);
 Check(!s.ShouldStop(TimeSpan.Zero,false),"Must allow startup");
 Check(!s.ShouldStop(TimeSpan.FromSeconds(20),true),"Observe simulator");
 Check(!s.ShouldStop(TimeSpan.FromHours(2),true),"Menu/reload/EFB disconnected while process alive");
 Check(!s.ShouldStop(TimeSpan.FromSeconds(7202),false),"Grace starts");
 Check(!s.ShouldStop(TimeSpan.FromSeconds(7206),true),"Brief absence recovers");
 Check(!s.ShouldStop(TimeSpan.FromSeconds(7210),false),"Fresh grace");
 Check(!s.ShouldStop(TimeSpan.FromSeconds(7214),null),"Probe failure is not exit");
 Check(!s.ShouldStop(TimeSpan.FromSeconds(7220),false),"Grace after unknown");
 Check(!s.ShouldStop(TimeSpan.FromSeconds(7225),false),"Wait six seconds");
 Check(s.ShouldStop(TimeSpan.FromSeconds(7226),false),"Stop after confirmed exit in every launch mode");
}
Check(!new SimulatorSession(false).ShouldStop(TimeSpan.FromDays(1),false),"Manual startup waits for a simulator session");
Check(new SimulatorSession(true).ShouldStop(TimeSpan.FromMinutes(15),false),"Autostart orphan timeout");
Check(!new SimulatorSession(true).ShouldStop(TimeSpan.FromMinutes(14),false),"Autostart grace");
Console.WriteLine("Simulator lifecycle: manual/autostart, waiting, menu/reload, transient absence, failed probes and confirmed exit passed.");
