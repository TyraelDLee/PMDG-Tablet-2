using System.Text.Json;
using System.Text.RegularExpressions;

namespace EfbSetup;

public sealed record AirportPackage(string Package, string Source, string Evidence);
public sealed record InstalledAirport(string Icao, AirportPackage[] Packages);
public sealed record UnresolvedAirportPackage(string Package, string Source, string Title);
public sealed class AirportInventory {
    public int SchemaVersion {get;set;}=1;
    public DateTimeOffset? ScannedAtUtc {get;set;}
    public string[] Icaos {get;set;}=[];
    public InstalledAirport[] Airports {get;set;}=[];
    public UnresolvedAirportPackage[] UnresolvedPackages {get;set;}=[];
    public string[] Warnings {get;set;}=[];
    // Files on disk, including streamed caches, do not establish enabled state.
    public bool AvailabilityVerified {get;set;}=false;
}

// Read package metadata only. Do not crawl assets, decode BGL/fsarchives, or
// request facilities from the running simulator. Linked Community packages are
// supported without recursively following links or traversing their contents.
public static class AirportScanner {
    static readonly Regex Code=new(@"\A[A-Z][A-Z0-9]{3}\z",RegexOptions.CultureInvariant);
    static readonly HashSet<string> Words=new(StringComparer.OrdinalIgnoreCase) {
        "BASE","CITY","DATA","EAST","FREE","GATE","INTL","LAND","MAIN","MESH","NORTH","PACK","TEST","WEST","YORK","ZONE"
    };
    static bool IsCode(string code)=>Code.IsMatch(code)&&!Words.Contains(code);
    static string Text(JsonElement element,string name)=>element.TryGetProperty(name,out var v)&&v.ValueKind==JsonValueKind.String?v.GetString()??"":"";
    static JsonDocument? Read(string file,long maxBytes,List<string> warnings,string label) {
        try {
            if(!File.Exists(file))return null;
            if(new FileInfo(file).Length>maxBytes){warnings.Add(label+": metadata exceeds scan size limit");return null;}
            return JsonDocument.Parse(File.ReadAllText(file));
        } catch(Exception e) when(e is IOException or UnauthorizedAccessException or JsonException) {warnings.Add(label+": cannot read metadata");return null;}
    }
    public static AirportInventory Scan(string community,string simConfig) {
        community=Paths.Full(community);var warnings=new List<string>();
        var locations=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase){{community,"Community"}};
        var packages=Directory.GetParent(community)?.FullName;
        if(!string.IsNullOrWhiteSpace(simConfig)) {
            try {
                var file=Path.Combine(simConfig,"UserCfg.opt");
                if(File.Exists(file)) {
                    var match=Regex.Match(File.ReadAllText(file),"^\\s*InstalledPackagesPath\\s+\"([^\"]+)\"",RegexOptions.Multiline|RegexOptions.IgnoreCase);
                    if(match.Success)packages=Paths.Full(match.Groups[1].Value);
                }
            } catch(Exception e) when(e is IOException or UnauthorizedAccessException) {warnings.Add("UserCfg: cannot determine package root; using Community parent");}
        }
        if(packages!=null)foreach(var name in new[]{"Community","Community2024","Official2020","Official2024","StreamedPackages"}) {
            var path=Path.Combine(packages,name);if(Directory.Exists(path))locations.TryAdd(path,name);
        }
        var found=new Dictionary<string,List<AirportPackage>>(StringComparer.Ordinal);
        var unresolved=new List<UnresolvedAirportPackage>();var visited=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        IEnumerable<string> Children(string folder) {
            try{return Directory.GetDirectories(folder);}catch(Exception e) when(e is IOException or UnauthorizedAccessException){warnings.Add(Path.GetFileName(folder)+": cannot enumerate packages");return [];}
        }
        void Package(string path,string source) {
            if(!visited.Add(Path.GetFullPath(path)))return;
            var id=Path.GetFileName(path);
            if(id.Equals("pmdg-tablet-v2",StringComparison.OrdinalIgnoreCase))return;
            var metadata=File.Exists(Path.Combine(path,"manifest.json"))?path:Path.Combine(path,"content");
            using var manifest=Read(Path.Combine(metadata,"manifest.json"),2*1024*1024,warnings,id);
            var m=manifest?.RootElement;
            var title=m is {ValueKind:JsonValueKind.Object}?Text(m.Value,"title"):"";
            var type=m is {ValueKind:JsonValueKind.Object}?Text(m.Value,"content_type"):"";
            var hint=m is {ValueKind:JsonValueKind.Object}?Text(m.Value,"package_order_hint"):"";
            if(type.Length>0&&!type.Equals("SCENERY",StringComparison.OrdinalIgnoreCase))return;
            var airport=hint.Equals("CUSTOM_AIRPORT",StringComparison.OrdinalIgnoreCase)||Regex.IsMatch(id,@"(?:^|[-_ ])airport(?:[-_ ]|$)",RegexOptions.IgnoreCase)||title.Contains("airport",StringComparison.OrdinalIgnoreCase);
            if(!airport)return;
            var codes=new Dictionary<string,string>(StringComparer.Ordinal);
            void Add(string code,string evidence){code=code.ToUpperInvariant();if(IsCode(code))codes.TryAdd(code,evidence);}
            using var layout=Read(Path.Combine(metadata,"layout.json"),16*1024*1024,warnings,id);
            if(layout?.RootElement.ValueKind==JsonValueKind.Object&&layout.RootElement.TryGetProperty("content",out var content)&&content.ValueKind==JsonValueKind.Array) {
                foreach(var entry in content.EnumerateArray()) {
                    if(entry.ValueKind!=JsonValueKind.Object)continue;
                    var rel=Text(entry,"path").Replace('\\','/');
                    var services=Regex.Match(rel,@"^AirportServices/([A-Z][A-Z0-9]{3})/",RegexOptions.IgnoreCase);
                    // Only use service directories from a package independently
                    // identified as an airport; global service packs cover many.
                    if(airport&&services.Success)Add(services.Groups[1].Value,"AirportServices metadata");
                }
            }
            if(airport) {
                var named=Regex.Match(id,@"(?:^|[-_ ])airport[-_ ]+([a-z][a-z0-9]{3})(?:[-_ ]|$)",RegexOptions.IgnoreCase);
                if(named.Success)Add(named.Groups[1].Value,"Package name (inferred)");
                var leading=Regex.Match(title,@"^\s*([A-Z][A-Z0-9]{3})(?=$|[\s,:/\-])");
                // Marketing titles can begin with unrelated uppercase words
                // (e.g. BATC compatibility); prefer structured/name evidence.
                if(codes.Count==0&&leading.Success)Add(leading.Groups[1].Value,"Title (inferred)");
                // Common creator-icao-place convention, e.g. auscene-yaye-… .
                if(codes.Count==0) {
                    var unprefixed=Regex.Replace(id,@"^fs(?:20|24)-","",RegexOptions.IgnoreCase);
                    var conventional=Regex.Match(unprefixed,@"^[^-_ ]+[-_ ]+([a-z][a-z0-9]{3})(?:[-_ ]|$)",RegexOptions.IgnoreCase);
                    if(conventional.Success)Add(conventional.Groups[1].Value,"Package name (inferred)");
                }
                if(codes.Count==0)unresolved.Add(new(id,source,title));
            }
            foreach(var code in codes) {
                if(!found.TryGetValue(code.Key,out var list))found[code.Key]=list=[];
                list.Add(new(id,source,code.Value));
            }
        }
        foreach(var location in locations)foreach(var path in Children(location.Key)) {
            // Exactly one distribution-container level; never recurse into
            // package trees or chains of linked directories.
            var name=Path.GetFileName(path);
            if(location.Value.StartsWith("Official",StringComparison.OrdinalIgnoreCase)&&(name.Equals("OneStore",StringComparison.OrdinalIgnoreCase)||name.Equals("Steam",StringComparison.OrdinalIgnoreCase))) {
                foreach(var child in Children(path))Package(child,location.Value);
            } else Package(path,location.Value);
        }
        var airports=found.OrderBy(x=>x.Key,StringComparer.Ordinal).Select(x=>new InstalledAirport(x.Key,x.Value.ToArray())).ToArray();
        return new AirportInventory {ScannedAtUtc=DateTimeOffset.UtcNow,Icaos=airports.Select(x=>x.Icao).ToArray(),Airports=airports,UnresolvedPackages=unresolved.ToArray(),Warnings=warnings.ToArray()};
    }
}
