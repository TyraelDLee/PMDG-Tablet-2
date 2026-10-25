namespace EfbSetup;
internal static class Program {
    [STAThread] static int Main(string[] args) {
        ApplicationConfiguration.Initialize();
        // Test/preview modes must not read or change the user's language file.
        if(args.Any(a=>a.StartsWith("--preview",StringComparison.Ordinal))||args.Contains("--self-test")||args.Contains("--package-test"))Ui.Set(args.Any(a=>a.EndsWith("-zh",StringComparison.Ordinal))?"zh":"en");
        else Ui.Initialize(Paths.DefaultRoot);
        if(args.Length==2&&args[0]=="--self-test")return SelfTest.Run(args[1]);
        if(args.Length==3&&args[0]=="--package-test")return SelfTest.Package(args[1],args[2]);
        if(args.Length==2&&(args[0]=="--preview"||args[0]=="--preview-airports"||args[0]=="--preview-zh"||args[0]=="--preview-airports-zh")) {
            using var form=new SetupForm(preview:true);form.ShowInTaskbar=false;form.Opacity=0;form.Show();Application.DoEvents();form.PerformLayout();
            if(args[0].Contains("airports",StringComparison.Ordinal)){form.PreviewAirportTab();Application.DoEvents();form.PerformLayout();}
            using var bmp=new Bitmap(form.Width,form.Height);form.DrawToBitmap(bmp,new Rectangle(Point.Empty,form.Size));bmp.Save(args[1]);return 0;
        }
        using var mutex=new Mutex(true,"Local\\EfbV2Setup",out var owned);
        if(!owned){MessageBox.Show(Ui.T("安装器已经打开，请切换到现有窗口。"),"EFB v2");return 0;}
        Application.ThreadException+=(_,e)=>MessageBox.Show(e.Exception.Message,Ui.T("EFB v2 安装器"),MessageBoxButtons.OK,MessageBoxIcon.Error);
        Application.Run(new SetupForm());return 0;
    }
}
