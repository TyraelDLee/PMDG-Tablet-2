using System.Text.Json;
using System.Text.RegularExpressions;

namespace EfbSetup;
internal static class LanguageSelfTest {
    static void Check(bool value,string reason){if(!value)throw new Exception(reason);}
    static IEnumerable<Control> Descendants(Control parent){foreach(Control child in parent.Controls){yield return child;foreach(var nested in Descendants(child))yield return nested;}}
    public static void Run(string root) {
        foreach(var locale in new[]{"en-US","de-DE","fr-FR","ja-JP",""})Check(Ui.Resolve("auto",locale)=="en","Non-Chinese system falls back to English");
        foreach(var locale in new[]{"zh-CN","zh-TW","ZH-HK"})Check(Ui.Resolve("auto",locale)=="zh","Chinese display languages use Chinese");
        Check(Ui.Resolve("en","zh-CN")=="en"&&Ui.Resolve("zh","en-US")=="zh","Explicit language overrides the system");
        var folder=Path.Combine(root,"Language");Directory.CreateDirectory(folder);
        Ui.Initialize(folder,"en-US");Check(Ui.Mode=="auto"&&Ui.Language=="en"&&!File.Exists(Path.Combine(folder,"setup-language.json")),"First launch follows system without writing preferences");
        File.WriteAllText(Path.Combine(folder,"bridge.json"),"preserve bridge settings");
        Ui.Set("zh",folder);Ui.Initialize(folder,"en-US");Check(Ui.Language=="zh"&&Ui.Mode=="zh","Manual selection persists across restarts");
        Ui.Set("auto",folder);Ui.Initialize(folder,"zh-CN");Check(Ui.Language=="zh"&&Ui.Mode=="auto","System option restores automatic choice");
        File.WriteAllText(Path.Combine(folder,"setup-language.json"),"invalid JSON");Ui.Initialize(folder,"en-US");
        Check(Ui.Language=="en"&&File.ReadAllText(Path.Combine(folder,"setup-language.json"))=="invalid JSON","Invalid preference falls back without overwriting it");
        Check(File.ReadAllText(Path.Combine(folder,"bridge.json"))=="preserve bridge settings","Language preferences do not change bridge configuration");
        foreach(var t in Ui.Catalog){
            Check(!string.IsNullOrWhiteSpace(t.En)&&!Regex.IsMatch(t.En,@"[\u4e00-\u9fff]"),"English resources contain no untranslated Chinese: "+t.Zh);
            Check(Regex.Matches(t.Zh,@"\{\d+\}").Select(m=>m.Value).Order().SequenceEqual(Regex.Matches(t.En,@"\{\d+\}").Select(m=>m.Value).Order()),"Message placeholders match");
            Ui.Set("en");Check(Ui.T(t.Zh)==t.En,"English lookup");Ui.Set("zh");Check(Ui.T(t.En)==t.Zh,"Chinese lookup");
        }
        Ui.Set("en");var count=Ui.F("已选 {0} / {1} 个机场",3,8);Check(count=="3 of 8 airports selected","English dynamic count");
        Ui.Set("zh");Check(Ui.Render(count)=="已选 3 / 8 个机场","Existing formatted messages can switch languages");
        Ui.Set("en");Check(Ui.Render("本机：http://127.0.0.1:8385/")=="This PC: http://127.0.0.1:8385/","Connection URLs stay intact");
        Check(Ui.Render("机场选择未保存：A:\\Games\\Community")=="Airport selection was not saved: A:\\Games\\Community","Error path stays intact");
        using var form=new SetupForm(preview:true){ShowInTaskbar=false,Opacity=0};form.Show();Application.DoEvents();form.PreviewAirportTab();Application.DoEvents();
        var controls=Descendants(form).ToArray();
        var community=(ComboBox)controls.Single(c=>c.Name=="community");var sim=(TextBox)controls.Single(c=>c.Name=="simConfig");
        var key=(TextBox)controls.Single(c=>c.Name=="airlabsKey");var port=(NumericUpDown)controls.Single(c=>c.Name=="port");
        var language=(ComboBox)controls.Single(c=>c.Name=="language");var log=(TextBox)controls.Single(c=>c.Name=="log");var grid=(DataGridView)controls.Single(c=>c.Name=="airportGrid");
        community.Text=@"A:\Games\Community";sim.Text=@"C:\MSFS";key.Text="LONG-KEY-EXAMPLE";port.Value=12345;grid.Rows[1].Cells[0].Value=false;
        language.SelectedIndex=2;Application.DoEvents();Check(Ui.Language=="zh"&&controls.OfType<Button>().Any(c=>c.Text=="安装 / 更新"),"Language selector switches to Chinese live");
        CheckSpacing(controls,key);
        Check(grid.Columns[2].HeaderText=="机场名字","Airport headers switch live");
        Check(grid.Columns[3].HeaderText=="制作组","Developer heading switches to Chinese");
        language.SelectedIndex=1;Application.DoEvents();Check(Ui.Language=="en"&&controls.OfType<Button>().Any(c=>c.Text=="Install / Update"),"Language selector switches to English live");
        CheckSpacing(controls,key);
        Check(community.Text==@"A:\Games\Community"&&sim.Text==@"C:\MSFS"&&key.Text=="LONG-KEY-EXAMPLE"&&port.Value==12345,"Language switch retains all form inputs");
        Check(grid.Rows.Count==6&&grid.Rows[1].Cells[0].Value is false&&grid.Columns[2].HeaderText=="Airport name","Language switch retains airport selections");
        Check(grid.Columns[3].HeaderText=="Developer"&&grid.Rows[0].Cells[3].Value is "Example Studio A","Developer data remains intact during language switches");
        Check(!key.UseSystemPasswordChar&&!Regex.IsMatch(log.Text,@"[\u4e00-\u9fff]"),"Plain-text key and English log retained after switching");
        foreach(var button in controls.OfType<Button>().Where(b=>b.Visible)) {
            var textWidth=TextRenderer.MeasureText(button.Text,button.Font,Size.Empty,TextFormatFlags.SingleLine|TextFormatFlags.NoPadding).Width;
            Check(textWidth+8<=button.ClientSize.Width,"English button text fits: "+button.Text);
        }
        var caption=controls.OfType<Label>().Single(c=>c.Text=="Language");Check(caption.Left>=0,"Language label stays inside header");
        Ui.Set("en");
    }
    static void CheckSpacing(Control[] controls,TextBox key){
        foreach(var button in controls.OfType<Button>().Where(b=>b.Visible)){
            var rect=button.RectangleToScreen(button.ClientRectangle);var parent=button.Parent!.RectangleToScreen(button.Parent.ClientRectangle);
            Check(parent.Contains(rect),"Button is not clipped by its parent: "+button.Text);
        }
        var apply=controls.Single(c=>c.Name=="applyPort");
        Check(key.PointToScreen(Point.Empty).Y-apply.PointToScreen(new Point(0,apply.Height)).Y>=8,"Port button and API key have a visible gap");
        var tabs=controls.OfType<TabControl>().Single();
        Check(tabs.PointToScreen(Point.Empty).Y-key.PointToScreen(new Point(0,key.Height)).Y>=10,"API key has bottom clearance above tabs");
    }
}
