using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace EfbSetup;

// The full catalog retains discovered airports and user exclusions. Icaos is
// the enabled projection consumed by SimBrief; never remove unchecked rows.
public static class AirportInventoryStore {
    static readonly JsonSerializerOptions Json=new(){WriteIndented=true,PropertyNameCaseInsensitive=true};
    static bool IsCode(string? value)=>value!=null&&Regex.IsMatch(value,@"\A[A-Z][A-Z0-9]{3}\z");
    public static string DisplayCreator(AirportPackage[] packages)=>string.Join(" / ",packages.Select(p=>p.Creator?.Trim()??"").Where(c=>c.Length>0).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase));
    public static string DisplayName(string icao,AirportPackage[] packages) {
        var title=packages.Where(p=>!string.IsNullOrWhiteSpace(p.Title))
            .OrderByDescending(p=>p.Title.Contains(icao,StringComparison.OrdinalIgnoreCase))
            .ThenBy(p=>p.Title.Contains("compatibility",StringComparison.OrdinalIgnoreCase)).Select(p=>p.Title.Trim()).FirstOrDefault();
        if(title!=null) {
            var clean=Regex.Replace(title,@"^\s*"+Regex.Escape(icao)+@"(?:\s*[-:/–—]\s*|\s+)","",RegexOptions.IgnoreCase).Trim();
            return clean.Length>0?clean:title;
        }
        var id=packages.FirstOrDefault()?.Package??"";
        var at=id.IndexOf(icao,StringComparison.OrdinalIgnoreCase);
        var tail=at>=0?id[(at+icao.Length)..].Trim('-','_',' '):"";
        return tail.Length>0?System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(Regex.Replace(tail,"[-_]+"," ")):"Airport name unavailable";
    }
    public static AirportInventory Normalize(AirportInventory source) {
        if(source.Airports==null||source.Icaos==null||source.DisabledIcaos==null)throw new IOException(Ui.T("机场列表格式不正确，原文件未被覆盖。"));
        var disabled=new HashSet<string>(source.DisabledIcaos.Where(IsCode),StringComparer.Ordinal);
        foreach(var a in source.Airports)if(!a.Enabled)disabled.Add(a.Icao);
        var rows=source.Airports.Concat(source.Icaos.Where(IsCode).Except(source.Airports.Select(a=>a.Icao)).Select(c=>new InstalledAirport(c,[])))
            .Where(a=>IsCode(a.Icao)).GroupBy(a=>a.Icao,StringComparer.Ordinal).Select(g=>g.First()).OrderBy(a=>a.Icao,StringComparer.Ordinal)
            .Select(a=>a with {Name=string.IsNullOrWhiteSpace(a.Name)?DisplayName(a.Icao,a.Packages??[]):a.Name,Enabled=!disabled.Contains(a.Icao),Creator=string.IsNullOrWhiteSpace(a.Creator)?DisplayCreator(a.Packages??[]):a.Creator.Trim()}).ToArray();
        return new AirportInventory{ScannedAtUtc=source.ScannedAtUtc,Airports=rows,Icaos=rows.Where(a=>a.Enabled).Select(a=>a.Icao).ToArray(),
            DisabledIcaos=disabled.Where(IsCode).Order(StringComparer.Ordinal).ToArray(),UnresolvedPackages=source.UnresolvedPackages??[],Warnings=source.Warnings??[],AvailabilityVerified=source.AvailabilityVerified};
    }
    public static AirportInventory Load(string file) {
        if(!File.Exists(file))return new();
        try{return Normalize(JsonSerializer.Deserialize<AirportInventory>(File.ReadAllText(file),Json)??throw new JsonException());}
        catch(Exception e) when(e is JsonException or NotSupportedException){throw new IOException(Ui.T("无法读取已安装机场列表；原文件已保留，请检查：")+file,e);}
    }
    public static AirportInventory Merge(AirportInventory scanned,AirportInventory previous) {
        var disabled=Normalize(previous).DisabledIcaos;scanned.DisabledIcaos=disabled;
        return Normalize(scanned);
    }
    public static AirportInventory Select(AirportInventory inventory,string icao,bool enabled) {
        inventory=Normalize(inventory);
        if(!inventory.Airports.Any(a=>a.Icao==icao))throw new IOException(Ui.T("机场已不在当前列表中，请刷新后重试。"));
        var excluded=new HashSet<string>(inventory.DisabledIcaos,StringComparer.Ordinal);
        if(enabled)excluded.Remove(icao);else excluded.Add(icao);
        inventory.DisabledIcaos=excluded.ToArray();
        inventory.Airports=inventory.Airports.Select(a=>a.Icao==icao?a with {Enabled=enabled}:a).ToArray();
        return Normalize(inventory);
    }
    public static string Serialize(AirportInventory inventory)=>JsonSerializer.Serialize(Normalize(inventory),Json);
    public static void Save(string localFile,string? package,AirportInventory inventory) {
        var text=Serialize(inventory);var writes=new List<(string File,string Text)>();
        if(package!=null) {
            Paths.NoLink(package);
            if(!File.Exists(Path.Combine(package,"manifest.json")))throw new IOException(Ui.T("找不到已安装的 EFB，请先安装 / 更新后再修改机场列表。"));
            var target=Paths.Child(package,Installer.AirportsRelative);
            // Update just this layout entry, without enumerating the package or
            // reading/writing any aircraft/scenery assets on each checkbox click.
            var layoutFile=Paths.Child(package,"layout.json");Paths.NoLink(layoutFile);
            var layout=JsonNode.Parse(File.ReadAllText(layoutFile))??throw new IOException(Ui.T("EFB layout.json 无法读取。"));
            if(layout["content"] is not JsonArray entries)throw new IOException(Ui.T("EFB layout.json 缺少 content 列表。"));
            var entry=entries.OfType<JsonObject>().FirstOrDefault(e=>string.Equals((string?)e["path"],Installer.AirportsRelative,StringComparison.OrdinalIgnoreCase));
            if(entry==null){entry=new JsonObject{{"path",Installer.AirportsRelative}};entries.Add(entry);}
            entry["size"]=Encoding.UTF8.GetByteCount(text);entry["date"]=DateTime.UtcNow.ToFileTimeUtc();
            writes.Add((target,text));writes.Add((layoutFile,layout.ToJsonString(Json)));
        }
        writes.Add((localFile,text));
        var pending=new List<(string Temp,string File)>();
        try {
            // Prepare every replacement first; an invalid/unwritable path must
            // not truncate an existing inventory. No backup folders are created.
            foreach(var item in writes) {
                Paths.NoLink(item.File);
                if(File.Exists(item.File)&&File.ReadAllText(item.File)==item.Text)continue;
                Directory.CreateDirectory(Path.GetDirectoryName(item.File)!);
                var temp=item.File+"."+Guid.NewGuid().ToString("N")+".tmp";
                pending.Add((temp,item.File));File.WriteAllText(temp,item.Text,new UTF8Encoding(false));
            }
            foreach(var item in pending)File.Move(item.Temp,item.File,true);
        } finally {foreach(var item in pending)if(File.Exists(item.Temp))File.Delete(item.Temp);}
    }
}
