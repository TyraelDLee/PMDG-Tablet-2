using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Xml.Linq;

namespace EfbSetup;
internal static class SelfTest {
    static void Check(bool value,string reason){if(!value)throw new Exception(reason);}
    static void Put(string file,string text){Directory.CreateDirectory(Path.GetDirectoryName(file)!);File.WriteAllText(file,text);}
    static int FreePort(){var l=new TcpListener(IPAddress.Loopback,0);l.Start();var port=((IPEndPoint)l.LocalEndpoint).Port;l.Stop();return port;}
    static void CheckImports(string package,bool lan) {
        var entries=Directory.GetFiles(package,"PMDGTablet*.html",SearchOption.AllDirectories);
        Check(entries.Length>0,"Tablet pages exist");
        foreach(var file in entries) {
            var text=File.ReadAllText(file);
            var config="/lan-bridge/lan-bridge-config.js";var host="/lan-bridge/lan-bridge-host.js";
            Check(text.Split(config).Length-1==(lan?1:0),"Config import count: "+file);
            Check(text.Split(host).Length-1==(lan?1:0),"Host import count: "+file);
            if(lan)Check(text.IndexOf(config,StringComparison.Ordinal)<text.IndexOf(host,StringComparison.Ordinal),"Config must load before host: "+file);
        }
    }
    public static int Run(string output) {
        output=Paths.Full(output);Directory.CreateDirectory(output);
        var root=Path.Combine(output,"gui-test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        var checks=new List<string>();var log=new List<string>();
        try {
            var local=Path.Combine(root,"本地资料");var roaming=Path.Combine(root,"用户资料");
            var cfgRoot=Path.Combine(local,"Packages","Microsoft.Limitless_8wekyb3d8bbwe","LocalCache");
            Check(Paths.Detect(local,roaming).Locations.Count==0,"Empty discovery");
            var packages=Path.Combine(root,"游戏目录");var community=Path.Combine(packages,"Community");Directory.CreateDirectory(community);
            Put(Path.Combine(cfgRoot,"UserCfg.opt"),$"InstalledPackagesPath \"{packages}\"");
            var locations=Paths.Detect(local,roaming).Locations;
            Check(locations.Count==1&&locations[0].Community==community,"Single path must not truncate");
            Directory.CreateDirectory(Path.Combine(packages,"Community2024"));
            Put(Path.Combine(roaming,"Microsoft Flight Simulator 2024","UserCfg.opt"),$"InstalledPackagesPath \"{packages}\"");
            Check(Paths.Detect(local,roaming).Locations.Count==4,"Both versions/folders found");
            checks.Add("自动检测：零个、单个、多个路径，Steam / Store，Community2024，中文路径");
            var bundle=Path.Combine(root,"Bundle");var source=Path.Combine(bundle,"package","pmdg-tablet-v2");
            var htmlRelative="html_ui/Pages/VCockpit/Instruments/PMDGTablet/pmdg-777-300ER/PMDGTabletCA.html";
            Put(Path.Combine(source,"manifest.json"),"{}");
            var import="<script type=\"text/html\" import-script=\"/Pages/VCockpit/Instruments/PMDGTablet/lan-bridge/lan-bridge-host.js\"></script>\n";
            Put(Path.Combine(source,htmlRelative),import+"<div>EFB</div>");
            Put(Path.Combine(source,Installer.HostRelative,"lan-bridge-host.js"),"// fixture");
            Put(Path.Combine(source,Installer.HostRelative,"lan-bridge-config.js"),"// disabled");
            Put(Path.Combine(source,"html_ui","app.js"),"// existing GSX, BATC and landing analysis fixture");
            var app=Path.Combine(root,"UserApp");var target=Path.Combine(community,"pmdg-tablet-v2");
            // A file here makes any attempt to create/use backups fail immediately.
            Put(Path.Combine(app,"backups"),"Do not touch legacy backup storage");
            Put(Path.Combine(community,"pmdg-aircraft-777","vendor.txt"),"Vendor package stays intact");
            Put(Path.Combine(target,"original.txt"),"original EFB");
            var engine=new Installer(bundle,app,false);var progress=new Log(log);
            engine.Install(new(community,"",false,StartNow:false),progress);
            Check(engine.State()?.WithLan==false,"EFB-only state");
            Check(!Directory.Exists(Path.Combine(target,Installer.HostRelative)),"EFB-only host removed");
            Check(!File.ReadAllText(Path.Combine(target,htmlRelative)).Contains("lan-bridge"),"EFB-only imports removed");
            Check(!File.Exists(Path.Combine(app,"EfbLanBridge.exe")),"EFB-only has no service");
            Check(!File.Exists(Path.Combine(app,"bridge.json")),"EFB-only has no new service config");
            checks.Add("仅 EFB：无需 UserCfg、无需 LAN 安装包，不安装服务或桥接脚本");
            // Regression: a reused EFB-only payload has scripts on disk but no imports.
            Put(Path.Combine(source,htmlRelative),"<div>EFB</div>");
            Put(Path.Combine(source,htmlRelative.Replace("CA.html","FO.html")),"<div>EFB FO</div>");
            Put(Path.Combine(bundle,"service","EfbLanBridge.exe"),"Never execute this test stub");
            Put(Path.Combine(bundle,"service","web","index.html"),"fixture");
            Put(Path.Combine(cfgRoot,"exe.xml"),"<SimBase.Document Type=\"Launch\" version=\"1,0\"><Launch.Addon><Name>Other Addon</Name><Path>C:\\Other.exe</Path></Launch.Addon></SimBase.Document>");
            var port=FreePort();var options=new InstallOptions(community,cfgRoot,true,port,true,false);
            engine.Install(options,progress);var key=engine.Config()!.PairingKey;
            Check(System.Text.RegularExpressions.Regex.IsMatch(key,@"\A[0-9]{4}\z"),"Four digit pairing code");
            var oldConfig=engine.Config()!;var originalHostKey=oldConfig.HostKey;oldConfig.PairingKey="legacy-long-pairing-code";
            File.WriteAllText(Path.Combine(app,"bridge.json"),JsonSerializer.Serialize(oldConfig));
            engine.Install(options,progress);key=engine.Config()!.PairingKey;
            Check(System.Text.RegularExpressions.Regex.IsMatch(key,@"\A[0-9]{4}\z")&&engine.Config()!.HostKey==originalHostKey,"Migrate PIN without changing host key");
            oldConfig=engine.Config()!;oldConfig.PairingKey="0042";File.WriteAllText(Path.Combine(app,"bridge.json"),JsonSerializer.Serialize(oldConfig));
            engine.Install(options,progress);key=engine.Config()!.PairingKey;Check(key=="0042","Keep leading zeros");
            checks.Add("4 位数字配对码、旧长码迁移、保留前导零和模拟器密钥");
            Check(engine.State()?.WithLan==true,"Upgrade state");
            CheckImports(target,true);
            checks.Add("缺少入口的 CA/FO 载荷安装 LAN 时补齐 config 和 host 导入，顺序正确");
            Check(File.ReadAllText(Path.Combine(target,Installer.HostRelative,"lan-bridge-config.js")).Contains(port.ToString()),"Configured port");
            var xml=XDocument.Load(Path.Combine(cfgRoot,"exe.xml"));Check(xml.Root!.Elements("Launch.Addon").Count()==2,"Preserve other addon");
            Put(Path.Combine(source,htmlRelative),import+import+"<div>EFB</div>");
            engine.Install(options,progress);CheckImports(target,true);
            Check(engine.Config()!.PairingKey==key,"Preserve pairing key");
            xml=XDocument.Load(Path.Combine(cfgRoot,"exe.xml"));Check(xml.Root!.Elements("Launch.Addon").Count()==2,"No duplicate autostart");
            checks.Add("EFB 升级到 LAN、重复安装、端口和配对码保留、自动启动项合并");
            var state=engine.State()!;
            File.WriteAllText(Path.Combine(app,"install-state.json"),JsonSerializer.Serialize(new{state.CommunityPath,state.SimConfigPath,OriginalBackup=Path.Combine(root,"missing-backup"),HadPackage=true,ShortcutPath=(string?)null}));
            engine.Install(options,progress);Check(engine.State()!.WithLan&&engine.Config()!.PairingKey==key,"Legacy upgrade");checks.Add("兼容旧安装记录，忽略已移除的备份字段并保留配对码");
            var listener=new TcpListener(IPAddress.Any,0);listener.Start();var occupied=((IPEndPoint)listener.LocalEndpoint).Port;
            try{var failed=false;try{engine.Install(options with{Port=occupied},progress);}catch(IOException){failed=true;}Check(failed,"Port conflict must fail");Check(engine.Config()!.Port==port,"Port conflict must not mutate configuration");}finally{listener.Stop();}
            checks.Add("端口占用时停止安装且保留原配置");
            Put(Path.Combine(target,"old-install-marker.txt"),"Do not restore");
            var broken=new Installer(bundle,app,false,checkpoint:_=>throw new IOException("Injected copy failure"));
            var failedInstall=false;try{broken.Install(options,progress);}catch(IOException e){failedInstall=e.Message.Contains("重新安装");}
            Check(failedInstall&&!File.Exists(Path.Combine(target,"old-install-marker.txt")),"No rollback; report incomplete install");
            Check(!Directory.EnumerateDirectories(Path.Combine(app,"staging")).Any(),"Temporary payload cleaned after failure");
            engine.Install(options,progress);checks.Add("安装失败明确提示重新安装，清理临时载荷，重试可完成");
            var newPort=FreePort();engine.ApplyPort(newPort);Check(engine.Config()!.Port==newPort,"Port applied");
            using(var layout=JsonDocument.Parse(File.ReadAllText(Path.Combine(target,"layout.json"))))foreach(var item in layout.RootElement.GetProperty("content").EnumerateArray())Check(new FileInfo(Path.Combine(target,item.GetProperty("path").GetString()!)).Length==item.GetProperty("size").GetInt64(),"Layout sizes");
            checks.Add("图形管理器修改端口，更新原生配置及 layout.json");
            engine.Install(options with{Lan=false},progress);
            CheckImports(target,false);
            Check(engine.State()?.WithLan==false&&!File.Exists(Path.Combine(app,"EfbLanBridge.exe")),"Downgrade service removed");
            xml=XDocument.Load(Path.Combine(cfgRoot,"exe.xml"));Check(xml.Root!.Elements("Launch.Addon").Single().Element("Name")!.Value=="Other Addon","Downgrade only removes owned entry");
            checks.Add("LAN 切回仅 EFB，移除服务和自己的启动项，保留其他软件");
            engine.Uninstall(progress);Check(!Directory.Exists(target),"Uninstall removes v2 without restoring an old package");Check(engine.State()==null,"Uninstall state removed");
            Check(File.ReadAllText(Path.Combine(app,"backups"))=="Do not touch legacy backup storage","No backup access in any operation");
            Check(File.ReadAllText(Path.Combine(community,"pmdg-aircraft-777","vendor.txt"))=="Vendor package stays intact","Vendor files untouched");
            checks.Add("安装、更新、改端口、失败和卸载均不访问 backups；卸载仅移除 v2，保留厂商软件包");
            File.WriteAllText(Path.Combine(output,"gui-tests.json"),JsonSerializer.Serialize(new{passed=true,checks,log,fixture=root},new JsonSerializerOptions{WriteIndented=true}));return 0;
        } catch(Exception e){File.WriteAllText(Path.Combine(output,"gui-tests.json"),JsonSerializer.Serialize(new{passed=false,error=e.ToString(),checks,log,fixture=root},new JsonSerializerOptions{WriteIndented=true}));return 1;}
    }
    public static int Package(string bundle,string output) {
        output=Paths.Full(output);Directory.CreateDirectory(output);var root=Path.Combine(output,"full-package-"+Guid.NewGuid().ToString("N"));
        var community=Path.Combine(root,"Community");var sim=Path.Combine(root,"Config");var app=Path.Combine(root,"Application");var menu=Path.Combine(root,"StartMenu");
        Directory.CreateDirectory(community);Put(Path.Combine(sim,"UserCfg.opt"),"fixture");
        var engine=new Installer(Paths.Full(bundle),app,true,Environment.ProcessPath,menuOverride:menu);var lines=new List<string>();
        try {
            var port=FreePort();Task.Run(()=>engine.Install(new(community,sim,true,port,true,true),new Log(lines))).GetAwaiter().GetResult();
            Check(engine.Running(),"Real service start");
            Put(Path.Combine(app,"web","navigraph-app.js"),"obsolete app");Put(Path.Combine(app,"web","navigraph-app.css"),"obsolete style");
            Put(Path.Combine(app,"navigraph.json"),"{\"ClientId\":\"preserve-local-config\"}");
            Task.Run(()=>engine.Install(new(community,sim,true,port,true,true),new Log(lines))).GetAwaiter().GetResult();
            Check(!File.Exists(Path.Combine(app,"web","navigraph-app.js"))&&!File.Exists(Path.Combine(app,"web","navigraph-app.css")),"Retired Navigraph app files removed during upgrade");
            Check(File.ReadAllText(Path.Combine(app,"navigraph.json")).Contains("preserve-local-config"),"Dormant local configuration preserved");
            var target=Path.Combine(community,"pmdg-tablet-v2");CheckImports(target,true);
            using(var http=new System.Net.Http.HttpClient{Timeout=TimeSpan.FromSeconds(5)})Check(http.GetStringAsync($"http://127.0.0.1:{port}/health").GetAwaiter().GetResult().Contains("EFB v2 LAN"),"Real service HTTP");
            Check(File.Exists(Path.Combine(menu,"EFB v2 安装与管理.lnk")),"GUI shortcut");Check(File.Exists(engine.State()!.ManagerPath!),"Installed manager");
            Task.Run(()=>engine.Install(new(community,sim,false,port,false,false),new Log(lines))).GetAwaiter().GetResult();
            Check(!engine.Running()&&!File.Exists(Path.Combine(app,"EfbLanBridge.exe")),"Real service stopped and removed");
            Check(!Directory.Exists(Path.Combine(target,Installer.HostRelative)),"Pure EFB package");CheckImports(target,false);
            Check(Directory.GetFiles(target,"PMDGTablet.js",SearchOption.AllDirectories).Length>0,"Native EFB retained");
            Task.Run(()=>engine.Uninstall(new Log(lines))).GetAwaiter().GetResult();Check(!Directory.Exists(target),"Fresh installation removed");
            Check(!Directory.Exists(Path.Combine(app,"backups")),"No backups with real payload");
            File.WriteAllText(Path.Combine(output,"gui-package-test.json"),JsonSerializer.Serialize(new{passed=true,checks=new[]{"完整发行载荷安装","所有 CA/FO 页面导入各一次且配置先加载，仅 EFB 模式全部移除","真实服务启动和 HTTP 检查","后台线程生成 GUI 和服务快捷方式","管理器复制到用户目录","LAN 切回仅 EFB并停止真实进程","卸载首次无原版时移除软件包"},fixture=root,lines},new JsonSerializerOptions{WriteIndented=true}));return 0;
        } catch(Exception e){File.WriteAllText(Path.Combine(output,"gui-package-test.json"),JsonSerializer.Serialize(new{passed=false,error=e.ToString(),fixture=root,lines},new JsonSerializerOptions{WriteIndented=true}));return 1;}
        finally{engine.Stop();}
    }
    sealed class Log(List<string> lines):IProgress<string>{public void Report(string value)=>lines.Add(value);}
}
