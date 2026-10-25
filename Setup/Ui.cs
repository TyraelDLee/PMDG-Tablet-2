using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace EfbSetup;

public static class Ui {
    public sealed record Translation(string Zh,string En);
    public sealed record Preference(string Language);
    static readonly Translation[] strings=ReadStrings();
    static readonly Dictionary<string,Translation> lookup=MakeLookup();
    static readonly (Translation Text,string Source,Regex Pattern)[] formats=MakeFormats();
    static readonly (Translation Text,string Source)[] prefixes=strings.SelectMany(t=>new[]{(t,t.Zh),(t,t.En)}).OrderByDescending(t=>t.Item2.Length).ToArray();
    static string system=CultureInfo.CurrentUICulture.Name;
    public static string Mode {get;private set;}="auto";
    public static string Language {get;private set;}=Resolve("auto",system);
    public static string Resolve(string mode,string culture)=>mode=="zh"||mode!="en"&&culture.StartsWith("zh",StringComparison.OrdinalIgnoreCase)?"zh":"en";
    static string ValidMode(string? mode)=>mode is "en" or "zh"?mode:"auto";
    static string FilePath(string root)=>Path.Combine(root,"setup-language.json");
    public static void Initialize(string root,string? systemLanguage=null) {
        system=systemLanguage??CultureInfo.CurrentUICulture.Name;var mode="auto";
        try {var file=FilePath(root);if(File.Exists(file)&&new FileInfo(file).Length<=4096)mode=ValidMode(JsonSerializer.Deserialize<Preference>(File.ReadAllText(file))?.Language);}catch(Exception e) when(e is IOException or UnauthorizedAccessException or JsonException){}
        Set(mode);
    }
    public static void Set(string mode,string? saveRoot=null) {
        mode=ValidMode(mode);
        if(saveRoot!=null) {
            var file=FilePath(saveRoot);Paths.NoLink(saveRoot);Paths.NoLink(file);Directory.CreateDirectory(saveRoot);
            var temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
            try {File.WriteAllText(temp,JsonSerializer.Serialize(new Preference(mode)),new UTF8Encoding(false));File.Move(temp,file,true);}
            finally{if(File.Exists(temp))File.Delete(temp);}
        }
        Mode=mode;Language=Resolve(mode,system);
    }
    public static string T(string key)=>lookup.TryGetValue(key,out var value)?Language=="zh"?value.Zh:value.En:key;
    public static string F(string key,params object[] args)=>string.Format(CultureInfo.GetCultureInfo(Language),T(key),args);
    public static string Render(string text) {
        if(lookup.ContainsKey(text))return T(text);
        if(text.Contains('\n'))return string.Join("\n",text.Split('\n').Select(line=>Render(line.TrimEnd('\r')))).Replace("\n",Environment.NewLine);
        foreach(var item in formats) {
            var match=item.Pattern.Match(text);if(!match.Success)continue;
            var args=Enumerable.Range(0,match.Groups.Count-1).Select(i=>(object)Render(match.Groups["a"+i].Value)).ToArray();
            return string.Format(CultureInfo.GetCultureInfo(Language),Language=="zh"?item.Text.Zh:item.Text.En,args);
        }
        // Known message prefixes can be followed by a path or an exception.
        // Never apply broad replacements to file paths or input field values.
        foreach(var item in prefixes) {var prefix=item.Source;
            if(prefix.Length<3||prefix.Contains('{')||!text.StartsWith(prefix,StringComparison.Ordinal)||text.Length==prefix.Length)continue;
            return T(item.Text.Zh)+Render(text[prefix.Length..]);
        }
        return text;
    }
    public static void Apply(Control root) {
        if(root is not TextBoxBase && root is not ComboBox && root is not UpDownBase)root.Text=Render(root.Text);
        if(root is Button button){
            button.TextAlign=ContentAlignment.MiddleCenter;button.UseCompatibleTextRendering=true;
            // Compensate for Segoe UI's optical baseline in the native button.
            button.Padding=Language=="en"?new Padding(0,0,0,2):Padding.Empty;
        }
        if(root is DataGridView)return;
        foreach(Control child in root.Controls)Apply(child);
    }
    static Translation[] ReadStrings() {
        var assembly=Assembly.GetExecutingAssembly();var name=assembly.GetManifestResourceNames().Single(n=>n.EndsWith(".Strings.json",StringComparison.Ordinal));
        using var stream=assembly.GetManifestResourceStream(name)!;return JsonSerializer.Deserialize<Translation[]>(stream)!;
    }
    static Dictionary<string,Translation> MakeLookup() {
        var result=new Dictionary<string,Translation>(StringComparer.Ordinal);
        foreach(var t in strings){result[t.Zh]=t;result[t.En]=t;}return result;
    }
    static (Translation,string,Regex)[] MakeFormats() {
        var result=new List<(Translation,string,Regex)>();
        foreach(var t in strings.Where(t=>t.Zh.Contains("{0}")))foreach(var source in new[]{t.Zh,t.En}) {
            var pattern=Regex.Escape(source);foreach(Match m in Regex.Matches(source,@"\{(\d+)\}"))pattern=pattern.Replace(Regex.Escape(m.Value),"(?<a"+m.Groups[1].Value+">.*?)");
            result.Add((t,source,new Regex("\\A"+pattern+"\\z",RegexOptions.CultureInvariant)));
        }
        return result.ToArray();
    }
    internal static IEnumerable<Translation> Catalog=>strings;
}
