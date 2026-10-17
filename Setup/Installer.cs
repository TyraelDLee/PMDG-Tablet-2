using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace EfbSetup;

public record InstallationLocation(string Config, string Community);
public record Detection(List<InstallationLocation> Locations, List<string> Warnings);
public record InstallOptions(string Community, string SimConfig, bool Lan, int Port = 8385, bool AutoStart = true, bool StartNow = true, string? AirlabsApiKey = null);
public class AirlabsSettings { public string ApiKey {get;set;}=""; }
public class BridgeConfig {
    public int Port {get;set;}=8385;
    public string BindAddress {get;set;}="0.0.0.0";
    public string PackagePath {get;set;}="";
    public static string NewPairingCode()=>RandomNumberGenerator.GetInt32(10000).ToString("D4",System.Globalization.CultureInfo.InvariantCulture);
    public string PairingKey {get;set;}=NewPairingCode();
    public string HostKey {get;set;}=Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
    public int GsxPort {get;set;}=8744;
    public int BatcPort {get;set;}=41716;
}
public class InstallState {
    public string CommunityPath {get;set;}="";
    public string SimConfigPath {get;set;}="";
    public string? ShortcutPath {get;set;}
    // Old PowerShell installations did not write these fields and always included LAN.
    public bool WithLan {get;set;}=true;
    public bool AutoStart {get;set;}=true;
    public string[] ServiceFiles {get;set;}=[];
    public string? ManagerPath {get;set;}
}
public static class Paths {
    public static string DefaultRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EfbV2Bridge");
    public static string Full(string s) {
        s=Environment.ExpandEnvironmentVariables(s.Trim().Trim('"'));
        if(!Path.IsPathFullyQualified(s))throw new IOException("请输入完整的文件夹路径，例如 C:\\… 或 A:\\…");
        return Path.TrimEndingDirectorySeparator(Path.GetFullPath(s));
    }
    public static string Child(string root,string relative) {
        root=Full(root);var p=Path.GetFullPath(Path.Combine(root,relative));
        if(!p.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("路径超出目标文件夹："+p);
        return p;
    }
    public static void NoLink(string p) {
        if((File.Exists(p)||Directory.Exists(p)) && (File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new IOException("检测到链接或联接，请选择实际文件夹后重试："+p);
    }
    public static IEnumerable<string> Files(string root) {
        NoLink(root);
        foreach(var f in Directory.EnumerateFiles(root)){NoLink(f);yield return f;}
        foreach(var d in Directory.EnumerateDirectories(root)){NoLink(d);foreach(var f in Files(d))yield return f;}
    }
    public static void CopyTree(string source,string dest) {
        NoLink(source);NoLink(dest);Directory.CreateDirectory(dest);
        foreach(var f in Files(source)){var target=Child(dest,Path.GetRelativePath(source,f));CopyFile(f,target);}
    }
    // Copy content, not source EFS attributes. The destination uses its own policy.
    public static void CopyFile(string source,string target) {
        NoLink(source);NoLink(target);Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        using var input=File.OpenRead(source);using var output=new FileStream(target,FileMode.Create,FileAccess.Write,FileShare.None);input.CopyTo(output);
    }
    public static void DeleteTree(string path,string root) {
        path=Child(root,Path.GetRelativePath(root,path));
        if(Directory.Exists(path)){_ = Files(path).ToArray();Directory.Delete(path,true);}
    }
    public static Detection Detect(string? local=null,string? roaming=null) {
        local??=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        roaming??=Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var locations=new List<InstallationLocation>();var warnings=new List<string>();
        foreach(var config in new[]{Path.Combine(local,"Packages","Microsoft.Limitless_8wekyb3d8bbwe","LocalCache"),Path.Combine(roaming,"Microsoft Flight Simulator 2024")}) {
            try {
                var file=Path.Combine(config,"UserCfg.opt");
                if(!File.Exists(file))continue;
                var match=Regex.Match(File.ReadAllText(file),"^\\s*InstalledPackagesPath\\s+\"([^\"]+)\"",RegexOptions.Multiline|RegexOptions.IgnoreCase);
                var packages=match.Success?Full(match.Groups[1].Value):Path.Combine(config,"Packages");
                var found=false;
                foreach(var name in new[]{"Community2024","Community"}) {
                    var community=Path.Combine(packages,name);
                    if(Directory.Exists(community)){locations.Add(new(config,community));found=true;}
                }
                if(!found)locations.Add(new(config,""));
            } catch(Exception e){warnings.Add(config+"："+e.Message);}
        }
        return new(locations.OrderByDescending(x=>Directory.Exists(Path.Combine(x.Community,"pmdg-tablet-v2"))).ToList(),warnings);
    }
}

// Installation intentionally has no backup or rollback feature.
public sealed class InstallFiles {
    public void Write(string file,string contents){Prepare(file);File.WriteAllText(file,contents,new UTF8Encoding(false));}
    public void Copy(string source,string target)=>Paths.CopyFile(source,target);
    public void Remove(string file){Paths.NoLink(file);if(File.Exists(file))File.Delete(file);}
    public void Prepare(string file){Paths.NoLink(file);Directory.CreateDirectory(Path.GetDirectoryName(file)!);}
}

public sealed class Installer(string bundle,string root,bool shortcuts=true,string? manager=null,Action<string>? checkpoint=null,string? menuOverride=null) {
    public const string LaunchName="EFB v2 LAN Bridge";
    public const string HostRelative="html_ui/Pages/VCockpit/Instruments/PMDGTablet/lan-bridge";
    static readonly JsonSerializerOptions Json=new(){WriteIndented=true,PropertyNameCaseInsensitive=true};
    public string Root {get;}=Paths.Full(root);
    string StateFile=>Path.Combine(Root,"install-state.json");
    string ConfigFile=>Path.Combine(Root,"bridge.json");
    string AirlabsFile=>Path.Combine(Root,"airlabs.json");
    public AirlabsSettings Airlabs()=>File.Exists(AirlabsFile)?JsonSerializer.Deserialize<AirlabsSettings>(File.ReadAllText(AirlabsFile),Json)??new():new();
    public const string AirlabsRelative="html_ui/Pages/VCockpit/Instruments/PMDGTablet/shared/simbrief/airlabs-settings.json";
    public const string AirportsRelative="html_ui/Pages/VCockpit/Instruments/PMDGTablet/shared/simbrief/installed-airports.json";
    string Menu=>menuOverride??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"EFB v2 LAN");
    public InstallState? State()=>File.Exists(StateFile)?JsonSerializer.Deserialize<InstallState>(File.ReadAllText(StateFile),Json):null;
    public BridgeConfig? Config()=>File.Exists(ConfigFile)?JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(ConfigFile),Json):null;
    public static void RequireClosedSimulator(){if(Process.GetProcessesByName("FlightSimulator2024").Length>0)throw new IOException("请先退出 MSFS 2024，再安装、切换模式或卸载。");}
    static bool Same(string a,string b)=>string.Equals(Paths.Full(a),Paths.Full(b),StringComparison.OrdinalIgnoreCase);
    static bool Within(string a,string b)=>a.StartsWith(b+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||Same(a,b);
    void ValidateRoot(string community,string packageSource) {
        Paths.NoLink(Root);
        if(Within(Root,community)||Within(community,Root)||Within(Root,Paths.Full(bundle))||Within(packageSource,Root))throw new IOException("安装目录、Community 和解压目录不能互相包含。");
    }
    public bool Running() {
        foreach(var p in Process.GetProcessesByName("EfbLanBridge")){using(p){try{if(Same(p.MainModule!.FileName,Path.Combine(Root,"EfbLanBridge.exe")))return true;}catch{}}}return false;
    }
    public void Stop() {
        foreach(var p in Process.GetProcessesByName("EfbLanBridge")){using(p){try{if(!Same(p.MainModule!.FileName,Path.Combine(Root,"EfbLanBridge.exe")))continue;}catch{continue;}p.Kill();if(!p.WaitForExit(5000))throw new IOException("LAN 进程尚未退出，请稍后重试。");}}
    }
    public void Start() {
        if(State()?.WithLan!=true)throw new IOException("当前安装未启用 LAN 服务。");
        if(Running())return;
        var exe=Path.Combine(Root,"EfbLanBridge.exe");if(!File.Exists(exe))throw new FileNotFoundException("LAN 服务文件缺失，请重新安装。",exe);
        Process.Start(new ProcessStartInfo(exe){WorkingDirectory=Root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
        Thread.Sleep(900);
        if(!Running())throw new IOException("LAN 服务启动后退出，请查看 "+Path.Combine(Root,"logs","bridge.log"));
    }
    static void CheckPort(BridgeConfig cfg) {
        if(cfg.Port is <1024 or >65535)throw new IOException("端口必须介于 1024 和 65535 之间。");
        if(!IPAddress.TryParse(cfg.BindAddress,out var ip))throw new IOException("bridge.json 中 BindAddress 不是有效的 IP 地址。");
        var listener=new TcpListener(ip,cfg.Port);
        try{listener.Start();}catch(SocketException e){throw new IOException($"端口 {cfg.Port} 无法使用，可能已被其他软件占用。请选择其他端口。",e);}finally{listener.Stop();}
    }
    static XDocument LoadXml(string path) {
        var xml=File.Exists(path)?XDocument.Load(path,LoadOptions.PreserveWhitespace):new XDocument(new XDeclaration("1.0","utf-8",null),new XElement("SimBase.Document",new XAttribute("Type","Launch"),new XAttribute("version","1,0"),new XElement("Descr","Launch"),new XElement("Filename","exe.xml"),new XElement("Disabled","False"),new XElement("Launch.ManualLoad","False")));
        if(xml.Root?.Name!="SimBase.Document")throw new IOException("exe.xml 格式无法识别，未进行修改："+path);
        return xml;
    }
    void LaunchEntry(XDocument xml,bool enabled) {
        var entries=xml.Root!.Elements("Launch.Addon").Where(x=>(string?)x.Element("Name")==LaunchName).ToArray();
        foreach(var entry in entries){var path=(string?)entry.Element("Path");if(path!=null&&!Same(path,Path.Combine(Root,"EfbLanBridge.exe")))throw new IOException("同名自动启动项指向其他目录，请先卸载那个版本。");entry.Remove();}
        if(enabled)xml.Root.Add(new XElement("Launch.Addon",new XElement("Name",LaunchName),new XElement("Disabled","False"),new XElement("ManualLoad","False"),new XElement("Path",Path.Combine(Root,"EfbLanBridge.exe")),new XElement("CommandLine","--sim-start"),new XElement("NewConsole","False")));
    }
    public static void Layout(string package) {
        var content=Paths.Files(package).Where(f=>!Same(f,Path.Combine(package,"layout.json"))).OrderBy(f=>f).Select(f=>{var info=new FileInfo(f);return new{path=Path.GetRelativePath(package,f).Replace('\\','/'),size=info.Length,date=info.LastWriteTimeUtc.ToFileTimeUtc()};}).ToArray();
        File.WriteAllText(Path.Combine(package,"layout.json"),JsonSerializer.Serialize(new{content},Json),new UTF8Encoding(false));
    }
    static string HostConfig(BridgeConfig cfg)=>"window.EFB_LAN_CONFIG = "+JsonSerializer.Serialize(new{enabled=true,port=cfg.Port,hostKey=cfg.HostKey})+";";
    static void Mode(string stage,BridgeConfig? cfg) {
        var host=Paths.Child(stage,HostRelative);
        if(cfg!=null){if(!File.Exists(Path.Combine(host,"lan-bridge-host.js")))throw new IOException("安装包缺少 LAN 适配器，请重新解压完整安装包。");File.WriteAllText(Path.Combine(host,"lan-bridge-config.js"),HostConfig(cfg),new UTF8Encoding(false));}
        var entries=Paths.Files(stage).Where(f=>Regex.IsMatch(Path.GetFileName(f),"^PMDGTablet(CA|FO)\\.html$",RegexOptions.IgnoreCase)).ToArray();
        if(cfg!=null&&entries.Length==0)throw new IOException("安装包中未找到 PMDG 平板页面，无法启用 LAN。");
        foreach(var file in entries) {
            var text=File.ReadAllText(file);
            // Rebuild both imports for every mode, including upgrades from an EFB-only payload.
            text=Regex.Replace(text,@"<script\b[^>]*import-script\s*=\s*[""'][^""']*/lan-bridge/lan-bridge-(?:config|host)\.js[""'][^>]*>\s*</script>\r?\n?","",RegexOptions.IgnoreCase);
            if(cfg!=null)text="<script type=\"text/html\" import-script=\"/Pages/VCockpit/Instruments/PMDGTablet/lan-bridge/lan-bridge-config.js\"></script>\r\n"+
                "<script type=\"text/html\" import-script=\"/Pages/VCockpit/Instruments/PMDGTablet/lan-bridge/lan-bridge-host.js\"></script>\r\n"+text;
            File.WriteAllText(file,text,new UTF8Encoding(false));
        }
        if(cfg==null)Paths.DeleteTree(host,stage);
        Layout(stage);
    }
    string[] BundledServices()=>Directory.Exists(Path.Combine(bundle,"service"))?Paths.Files(Path.Combine(bundle,"service")).Select(f=>Path.GetRelativePath(Path.Combine(bundle,"service"),f)).Where(f=>!f.EndsWith(".log",StringComparison.OrdinalIgnoreCase)).ToArray():[];
    static void Link(string file,string target,string args,InstallFiles tx) {
        tx.Prepare(file);var type=Type.GetTypeFromProgID("WScript.Shell")??throw new IOException("Windows 快捷方式组件不可用。");
        dynamic shell=Activator.CreateInstance(type)!;dynamic link=shell.CreateShortcut(file);
        try{link.TargetPath=target;link.Arguments=args;link.WorkingDirectory=Path.GetDirectoryName(target);link.Save();}
        finally{System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);}
    }
    void Shortcuts(InstallState state,InstallFiles tx) {
        if(!shortcuts)return;
        var menu=Menu;
        foreach(var name in new[]{"Start bridge","Status","Stop","Configure","Uninstall","EFB v2 安装与管理"})tx.Remove(Path.Combine(menu,name+".lnk"));
        if(manager!=null) {
            var hash=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(manager)))[..12];
            var target=Paths.Child(Root,"manager/"+hash+"/EfbV2Setup.exe");
            if(!Same(manager,target)&&(!File.Exists(target)||!File.ReadAllBytes(manager).SequenceEqual(File.ReadAllBytes(target))))tx.Copy(manager,target);
            state.ManagerPath=target;
            Link(Path.Combine(menu,"EFB v2 安装与管理.lnk"),target,"--manage",tx);
            if(state.WithLan)Link(Path.Combine(menu,"Start bridge.lnk"),Path.Combine(Root,"EfbLanBridge.exe"),"",tx);
            state.ShortcutPath=menu;
        }
    }
    public string Install(InstallOptions options,IProgress<string> log) {
        RequireClosedSimulator();var community=Paths.Full(options.Community);
        if(!Directory.Exists(community))throw new DirectoryNotFoundException("Community 文件夹不存在："+community);
        var source=Paths.Full(Path.Combine(bundle,"package","pmdg-tablet-v2"));
        if(!File.Exists(Path.Combine(source,"manifest.json"))||!Directory.Exists(Path.Combine(source,"html_ui")))throw new IOException("安装包不完整。请解压整个 ZIP，并从解压目录运行 EfbV2Setup.exe。");
        ValidateRoot(community,source);
        var target=Paths.Child(community,"pmdg-tablet-v2");Paths.NoLink(target);
        var prior=State();var cfg=Config();var airlabs=Airlabs();
        if(options.AirlabsApiKey!=null)airlabs.ApiKey=options.AirlabsApiKey.Trim();
        if(airlabs.ApiKey.Length>256||airlabs.ApiKey.Any(char.IsWhiteSpace))throw new IOException("AirLabs API key 格式不正确，请检查是否包含空格。");
        if(prior!=null&&!Same(prior.CommunityPath,community))throw new IOException("已安装到其他 Community 文件夹。请先卸载原位置，或选择原来的文件夹。");
        if(cfg!=null&&!Same(cfg.PackagePath,target))throw new IOException("已有 LAN 配置指向其他 EFB，请先处理原安装。");
        var sim=string.IsNullOrWhiteSpace(options.SimConfig)?prior?.SimConfigPath??"":Paths.Full(options.SimConfig);
        if(prior!=null&&!string.IsNullOrWhiteSpace(prior.SimConfigPath)&&!string.IsNullOrWhiteSpace(sim)&&!Same(prior.SimConfigPath,sim))throw new IOException("MSFS 配置目录与原安装不同，请先卸载原安装。");
        if(options.Lan&&options.AutoStart&&(string.IsNullOrEmpty(sim)||!File.Exists(Path.Combine(sim,"UserCfg.opt"))))throw new IOException("自动启动需要 MSFS 2024 配置目录（内含 UserCfg.opt）。请选择该目录，或取消自动启动。");
        var xmlPath=string.IsNullOrEmpty(sim)?null:Path.Combine(sim,"exe.xml");
        XDocument? xml=null;
        if(xmlPath!=null&&((options.Lan&&options.AutoStart)||prior?.WithLan==true)) {xml=LoadXml(xmlPath);LaunchEntry(xml,options.Lan&&options.AutoStart);}
        var services=BundledServices();
        if(options.Lan&&!File.Exists(Path.Combine(bundle,"service","EfbLanBridge.exe")))throw new IOException("安装包缺少 LAN 服务。请重新解压完整 ZIP。");
        cfg??=new BridgeConfig();cfg.Port=options.Port;cfg.PackagePath=target;
        if(options.Lan&&!Regex.IsMatch(cfg.PairingKey??"",@"\A[0-9]{4}\z"))cfg.PairingKey=BridgeConfig.NewPairingCode();
        var wasRunning=Running();Stop();
        string? stage=null;bool replaced=false;var tx=new InstallFiles();
        try {
            if(options.Lan)CheckPort(cfg);
            // Stage only the new payload; never copy the existing installation.
            stage=Paths.Child(Root,"staging/"+Guid.NewGuid().ToString("N"));
            log.Report("准备安装文件…");Paths.CopyTree(source,stage);
            var airlabsTarget=Paths.Child(stage,AirlabsRelative);Directory.CreateDirectory(Path.GetDirectoryName(airlabsTarget)!);File.WriteAllText(airlabsTarget,JsonSerializer.Serialize(airlabs,Json),new UTF8Encoding(false));
            log.Report("扫描本地机场包元数据（不验证模拟器启用状态）…");
            var airports=AirportScanner.Scan(community,sim);var airportJson=JsonSerializer.Serialize(airports,Json);
            var airportsTarget=Paths.Child(stage,AirportsRelative);Directory.CreateDirectory(Path.GetDirectoryName(airportsTarget)!);File.WriteAllText(airportsTarget,airportJson,new UTF8Encoding(false));
            log.Report($"已记录 {airports.Icaos.Length} 个机场代码；{airports.UnresolvedPackages.Length} 个机场包暂未识别代码。流式缓存及名称推断不能确认当前启用状态。");
            foreach(var warning in airports.Warnings)log.Report("机场扫描提示："+warning);
            Mode(stage,options.Lan?cfg:null);
            log.Report("安装 EFB v2…");replaced=true;Paths.DeleteTree(target,community);Paths.CopyTree(stage,target);
            checkpoint?.Invoke("package-replaced");
            if(options.Lan) {
                log.Report("安装 LAN 服务及配置…");
                foreach(var rel in services)tx.Copy(Paths.Child(Path.Combine(bundle,"service"),rel),Paths.Child(Root,rel));
                foreach(var rel in new[]{"web/navigraph-app.js","web/navigraph-app.css"})tx.Remove(Paths.Child(Root,rel));
                tx.Write(ConfigFile,JsonSerializer.Serialize(cfg,Json));
            } else if(prior?.WithLan==true) {
                log.Report("停用并移除原 LAN 服务…");
                foreach(var rel in prior.ServiceFiles.Length>0?prior.ServiceFiles:services)tx.Remove(Paths.Child(Root,rel));
            }
            // Remove obsolete script entry points so they cannot operate on an EFB-only install.
            foreach(var name in new[]{"Common.ps1","Configure.ps1","Stop.ps1","Status.ps1","Uninstall.ps1"})tx.Remove(Path.Combine(Root,name));
            if(xml!=null){log.Report(options.Lan&&options.AutoStart?"注册模拟器自动启动…":"移除本工具的自动启动项…");tx.Write(xmlPath!,xml.Declaration+Environment.NewLine+xml.ToString(SaveOptions.DisableFormatting));}
            var state=new InstallState{CommunityPath=community,SimConfigPath=sim,WithLan=options.Lan,AutoStart=options.Lan&&options.AutoStart,ServiceFiles=options.Lan?services:[],ManagerPath=prior?.ManagerPath};
            Shortcuts(state,tx);tx.Write(StateFile,JsonSerializer.Serialize(state,Json));tx.Write(AirlabsFile,JsonSerializer.Serialize(airlabs,Json));
            tx.Write(Path.Combine(Root,"installed-airports.json"),airportJson);
        } catch(Exception error) {
            if(!replaced&&wasRunning){try{Start();}catch(Exception restart){log.Report("原 LAN 服务未能重新启动："+restart.Message);}}
            throw new IOException("安装未完成。"+(replaced?"文件可能已部分更新，请排除原因后重新安装。":"")+"原因："+error.Message,error);
        } finally {
            if(stage!=null){try{Paths.DeleteTree(stage,Root);}catch(Exception cleanup){log.Report("临时安装文件未能清理："+cleanup.Message);}}
        }
        if(options.Lan&&options.StartNow){try{Start();}catch(Exception e){log.Report("文件安装成功，但服务未启动："+e.Message);}}
        return options.Lan?"EFB + LAN 安装完成。"+Environment.NewLine+ConnectionDetails():"EFB v2 安装完成。未启用 LAN 服务，也未注册自动启动。";
    }
    public string ConnectionDetails(){var c=Config();if(c==null)return "";var ips=System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces().Where(n=>n.OperationalStatus==System.Net.NetworkInformation.OperationalStatus.Up).SelectMany(n=>n.GetIPProperties().UnicastAddresses).Where(a=>a.Address.AddressFamily==AddressFamily.InterNetwork&&!IPAddress.IsLoopback(a.Address)).Select(a=>a.Address.ToString()).Distinct();return string.Join(Environment.NewLine,ips.Select(ip=>$"http://{ip}:{c.Port}/"))+Environment.NewLine+$"本机：http://127.0.0.1:{c.Port}/"+Environment.NewLine+"配对码："+c.PairingKey;}
    public void ApplyPort(int port) {
        RequireClosedSimulator();var state=State()??throw new IOException("尚未安装。");if(!state.WithLan)throw new IOException("当前为仅 EFB 模式。");
        var cfg=Config()??throw new IOException("LAN 配置缺失。");var wasRunning=Running();Stop();
        var tx=new InstallFiles();
        try{cfg.Port=port;CheckPort(cfg);}catch{if(wasRunning)Start();throw;}
        tx.Write(ConfigFile,JsonSerializer.Serialize(cfg,Json));tx.Write(Paths.Child(cfg.PackagePath,HostRelative+"/lan-bridge-config.js"),HostConfig(cfg));Layout(cfg.PackagePath);if(wasRunning)Start();
    }
    public void Uninstall(IProgress<string> log) {
        RequireClosedSimulator();var state=State()??throw new IOException("尚未找到安装记录。");
        var target=Paths.Child(state.CommunityPath,"pmdg-tablet-v2");
        Paths.NoLink(target);var tx=new InstallFiles();Stop();
            log.Report("移除 EFB v2 和 LAN 服务…");
            if(!string.IsNullOrWhiteSpace(state.SimConfigPath)) {var file=Path.Combine(state.SimConfigPath,"exe.xml");if(File.Exists(file)){var xml=LoadXml(file);LaunchEntry(xml,false);tx.Write(file,xml.Declaration+Environment.NewLine+xml.ToString(SaveOptions.DisableFormatting));}}
            Paths.DeleteTree(target,state.CommunityPath);
            foreach(var rel in state.ServiceFiles.Length>0?state.ServiceFiles:BundledServices())tx.Remove(Paths.Child(Root,rel));
            if(shortcuts) {
                var menu=Menu;
                foreach(var name in new[]{"Start bridge","Status","Stop","Configure","Uninstall","EFB v2 安装与管理"})tx.Remove(Path.Combine(menu,name+".lnk"));
            }
            tx.Remove(StateFile);log.Report("卸载完成。配置和安装器保留在："+Root);
    }
}
