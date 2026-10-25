using System.Text.Json;
using System.Text.Json.Nodes;

namespace EfbSetup;
internal static class AirportInventorySelfTest {
    static void Check(bool value,string reason){if(!value)throw new Exception(reason);}
    public static void Run(string root) {
        var folder=Path.Combine(root,"AirportSelection");Directory.CreateDirectory(folder);
        var local=Path.Combine(folder,"installed-airports.json");var package=Path.Combine(folder,"Package");Directory.CreateDirectory(package);
        File.WriteAllText(Path.Combine(package,"manifest.json"),"{}");
        File.WriteAllText(Path.Combine(package,"unchanged.txt"),"Do not touch unrelated files.");
        var untouched=File.GetLastWriteTimeUtc(Path.Combine(package,"unchanged.txt"));
        var layoutFile=Path.Combine(package,"layout.json");File.WriteAllText(layoutFile,"{\"content\":[{\"path\":\"unchanged.txt\",\"size\":28,\"date\":123}],\"extra\":\"preserve\"}");
        var source=new AirportInventory{Airports=[new("EDDF",[new("asobo-airport-eddf-frankfurt","Official2020","Package name (inferred)","EDDF - Frankfurt Airport")]),new("VHHH",[new("maker-airport-vhhh-hong-kong","Community","Package name (inferred)","VHHH Hong Kong International Airport")])]};
        var enabled=AirportInventoryStore.Normalize(source);
        Check(enabled.Airports.All(a=>a.Enabled)&&enabled.Icaos.SequenceEqual(new[]{"EDDF","VHHH"}),"Existing airports default to enabled");
        Check(enabled.Airports[0].Name=="Frankfurt Airport"&&enabled.Airports[1].Name=="Hong Kong International Airport","Manifest titles provide airport names");
        var old=JsonSerializer.Deserialize<AirportInventory>("{\"SchemaVersion\":1,\"Icaos\":[\"VHHH\"],\"Airports\":[{\"Icao\":\"VHHH\",\"Packages\":[{\"Package\":\"maker-airport-vhhh-hong-kong\",\"Source\":\"Community\",\"Evidence\":\"inferred\"}]}]}")!;
        old=AirportInventoryStore.Normalize(old);Check(old.Icaos.SequenceEqual(new[]{"VHHH"})&&old.Airports[0].Enabled&&old.Airports[0].Name=="Hong Kong","Schema 1 migration and fallback package name");
        Check(old.Airports[0].Creator==""&&old.Airports[0].Packages[0].Creator=="","Legacy lists without creator fields stay readable with blank developers");
        var changed=AirportInventoryStore.Select(enabled,"EDDF",false);AirportInventoryStore.Save(local,package,changed);
        var native=Paths.Child(package,Installer.AirportsRelative);var roundtrip=AirportInventoryStore.Load(local);
        Check(roundtrip.Icaos.SequenceEqual(new[]{"VHHH"})&&roundtrip.Airports.Length==2&&!roundtrip.Airports[0].Enabled,"Deselect removes only enabled projection, retains row");
        Check(File.ReadAllText(local)==File.ReadAllText(native),"Native and local inventory identical after click");
        using(var layout=JsonDocument.Parse(File.ReadAllText(layoutFile))) {
            Check(layout.RootElement.GetProperty("extra").GetString()=="preserve","Preserve layout extension fields");
            var content=layout.RootElement.GetProperty("content").EnumerateArray().ToArray();Check(content.Length==2&&content[0].GetProperty("date").GetInt32()==123,"Only inventory layout entry updated");
            Check(content[1].GetProperty("size").GetInt64()==new FileInfo(native).Length,"Native inventory layout UTF-8 size correct");
        }
        Check(File.GetLastWriteTimeUtc(Path.Combine(package,"unchanged.txt"))==untouched,"Checkbox leaves other package files untouched");
        var without=new AirportInventory{Airports=[new("VHHH",[]),new("YMML",[],"Melbourne Airport")]};
        var absent=AirportInventoryStore.Merge(without,roundtrip);Check(absent.DisabledIcaos.Contains("EDDF")&&absent.Icaos.Contains("YMML"),"Refresh retains missing-airport exclusion; new airport defaults enabled");
        var returned=AirportInventoryStore.Merge(source,absent);Check(!returned.Icaos.Contains("EDDF"),"Returning airport stays unchecked");
        changed=AirportInventoryStore.Select(returned,"VHHH",false);AirportInventoryStore.Save(local,package,changed);
        Check(AirportInventoryStore.Load(local).Icaos.Length==0&&AirportInventoryStore.Load(local).Airports.Length==2,"All unchecked allowed");
        changed=AirportInventoryStore.Select(changed,"EDDF",true);Check(changed.Icaos.SequenceEqual(new[]{"EDDF"}),"Re-enable airport removes persisted exclusion");
        File.WriteAllText(local,"not JSON");var rejected=false;try{AirportInventoryStore.Load(local);}catch(IOException){rejected=true;}
        Check(rejected&&File.ReadAllText(local)=="not JSON","Corrupt local state is reported, not replaced by defaults");
        AirportInventoryStore.Save(local,package,changed);
        var before=File.ReadAllText(local);File.WriteAllText(layoutFile,"{}");rejected=false;
        try{AirportInventoryStore.Save(local,package,AirportInventoryStore.Select(changed,"EDDF",false));}catch(IOException){rejected=true;}
        Check(rejected&&File.ReadAllText(local)==before&&File.ReadAllText(native)==before,"Invalid layout rejected before writing either list");
        Check(!Directory.GetFiles(folder,"*.tmp",SearchOption.AllDirectories).Any(),"No temporary replacements left behind");
        using var view=new AirportListView();using var form=new Form{ShowInTaskbar=false,Opacity=0};form.Controls.Add(view);form.Show();Application.DoEvents();
        view.ShowInventory(enabled);var saves=0;string? selected=null;var value=true;
        view.SelectionChanged+=(code,state)=>{saves++;selected=code;value=state;if(code=="VHHH")throw new IOException("Test save failure");};
        var errors=0;view.SelectionFailed+=_=>errors++;
        Check(saves==0,"Loading rows does not write files");
        view.Grid.Rows[0].Cells[0].Value=false;Check(saves==1&&selected=="EDDF"&&!value,"Checkbox commits immediately without extra Save");
        view.Grid.Rows[1].Cells[0].Value=false;Check(errors==1&&view.Grid.Rows[1].Cells[0].Value is true,"Failed save restores checkbox and surfaces error once");
        view.ShowInventory(changed);Check(saves==2,"Reloading after scan does not emit selection changes");
        var refreshes=0;view.RefreshRequested+=(_,_)=>refreshes++;view.RefreshButton.PerformClick();Check(refreshes==1,"Refresh button is wired");
        Startup(root);
        Creators(root);
    }
    static void Creators(string root){
        var folder=Path.Combine(root,"AirportCreators");var community=Path.Combine(folder,"Community");Directory.CreateDirectory(community);
        void Package(string icao,string id,params (string Key,object? Value)[] fields){
            var metadata=new Dictionary<string,object?>{{"content_type","SCENERY"},{"title",icao+" Airport"}};
            foreach(var field in fields)metadata[field.Key]=field.Value;
            var path=Path.Combine(community,id);Directory.CreateDirectory(path);File.WriteAllText(Path.Combine(path,"manifest.json"),JsonSerializer.Serialize(metadata));
        }
        Package("VHHH","maker-airport-vhhh-main",("manufacturer"," Alpha Studio "),("creator","Wrong Creator"));
        Package("VHHH","other-airport-vhhh-extra",("manufacturer","alpha studio"));
        Package("VHHH","other-airport-vhhh-second",("creator","Other Studio"));
        Package("YMML","maker-airport-ymml",("creator"," Beta Works "));
        Package("YBBN","maker-airport-ybbn",("manufacturer",""),("creator","Gamma Scenery"));
        Package("EGLL","maker-airport-egll",("manufacturer"," \t "),("creator","Delta Team"));
        Package("EDDF","maker-airport-eddf");
        Package("EHAM","maker-airport-eham",("manufacturer",null),("creator","   "));
        Package("RJTT","maker-airport-rjtt",("manufacturer",42),("creator","Type Fallback"));
        Package("WSSS","fix-airport-wsss",("creator","Patch Team"),("package_order_hint","CUSTOM_AIRPORT_PATCH"));
        var inventory=AirportScanner.Scan(community,"");
        string Developer(string code)=>inventory.Airports.Single(a=>a.Icao==code).Creator;
        Check(inventory.Airports.Single(a=>a.Icao=="VHHH").Packages.Single(p=>p.Package=="maker-airport-vhhh-main").Creator=="Alpha Studio","Manufacturer wins over creator and trims whitespace");
        Check(Developer("VHHH")=="Alpha Studio / Other Studio","Duplicate airport packages show distinct developers without duplicate casing");
        Check(Developer("YMML")=="Beta Works"&&Developer("YBBN")=="Gamma Scenery"&&Developer("EGLL")=="Delta Team","Missing, empty and whitespace manufacturer fall back to creator");
        Check(Developer("EDDF")==""&&Developer("EHAM")=="","Missing metadata leaves the developer blank");
        Check(Developer("RJTT")=="Type Fallback"&&!inventory.Icaos.Contains("WSSS"),"Invalid manufacturer type falls back; airport patch remains excluded");
        var saved=AirportInventoryStore.Select(inventory,"VHHH",false);var file=Path.Combine(folder,"installed-airports.json");
        AirportInventoryStore.Save(file,null,saved);saved=AirportInventoryStore.Load(file);
        Check(saved.Airports.Single(a=>a.Icao=="VHHH").Creator==Developer("VHHH")&&!saved.Icaos.Contains("VHHH"),"Developer and unchecked state survive local persistence");
        Package("YMML","maker-airport-ymml",("manufacturer","New Studio"),("creator","Old Company"));
        var refreshed=AirportInventoryStore.Merge(AirportScanner.Scan(community,""),saved);
        Check(refreshed.Airports.Single(a=>a.Icao=="YMML").Creator=="New Studio"&&!refreshed.Icaos.Contains("VHHH"),"Refresh updates creator metadata without changing user selection");
        using var view=new AirportListView();using var form=new Form{ShowInTaskbar=false,Opacity=0};form.Controls.Add(view);form.Show();Application.DoEvents();view.ShowInventory(inventory);
        Check(view.Grid.Columns.Count==4&&view.Grid.Rows.Cast<DataGridViewRow>().Single(r=>r.Cells[1].Value is "EDDF").Cells[3].Value is "","Developer column renders blank rather than a placeholder");
        view.Grid.Sort(view.Grid.Columns["Creator"]!,System.ComponentModel.ListSortDirection.Ascending);
        string? changed=null;view.SelectionChanged+=(code,_)=>changed=code;
        view.Grid.Rows.Cast<DataGridViewRow>().Single(r=>r.Cells[1].Value is "VHHH").Cells[0].Value=false;
        Check(changed=="VHHH","Sorting developers keeps checkbox changes associated with the correct ICAO");
    }
    static void Startup(string root) {
        var folder=Path.Combine(root,"AirportStartup");var community=Path.Combine(folder,"Packages","Community");
        var first=Path.Combine(community,"maker-airport-eddf-frankfurt");Directory.CreateDirectory(first);
        File.WriteAllText(Path.Combine(first,"manifest.json"),"{\"content_type\":\"SCENERY\",\"title\":\"EDDF Frankfurt Airport\"}");
        var app=Path.Combine(folder,"Application");var engine=new Installer(Path.Combine(folder,"Bundle"),app,false);
        Check(!engine.HasLocalAirports,"First launch has no local airport list");
        var loaded=engine.LoadOrScanAirports(community,"");
        Check(engine.HasLocalAirports&&loaded.Icaos.SequenceEqual(new[]{"EDDF"}),"First launch scans and saves automatically without installation or LAN");
        engine.SetAirportEnabled("EDDF",false);
        var file=Path.Combine(app,"installed-airports.json");var before=File.ReadAllText(file);var savedAt=File.GetLastWriteTimeUtc(file);
        var second=Path.Combine(community,"maker-airport-vhhh-hongkong");Directory.CreateDirectory(second);
        File.WriteAllText(Path.Combine(second,"manifest.json"),"{\"content_type\":\"SCENERY\",\"title\":\"VHHH Hong Kong Airport\"}");
        loaded=engine.LoadOrScanAirports(community,"");
        Check(loaded.Airports.Length==1&&!loaded.Airports[0].Enabled,"Existing list loads unchecked state without rescanning new scenery");
        Check(File.ReadAllText(file)==before&&File.GetLastWriteTimeUtc(file)==savedAt,"Startup reading existing list has no writes");
        Check(engine.LoadOrScanAirports("not a valid Community path","").Icaos.Length==0,"Existing list does not depend on scanner/path availability");
        loaded=engine.RefreshAirports(community,"");
        Check(loaded.Airports.Length==2&&!loaded.Airports.Single(a=>a.Icao=="EDDF").Enabled&&loaded.Icaos.SequenceEqual(new[]{"VHHH"}),"Manual refresh discovers new airport and preserves startup selections");
        File.WriteAllText(file,"invalid JSON");var rejected=false;
        try{engine.LoadOrScanAirports(community,"");}catch(IOException){rejected=true;}
        Check(rejected&&File.ReadAllText(file)=="invalid JSON","Corrupt existing startup list must not trigger a replacement scan");
    }
}
