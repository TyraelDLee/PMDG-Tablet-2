namespace EfbSetup;
internal static class Program {
    [STAThread] static int Main(string[] args) {
        ApplicationConfiguration.Initialize();
        if(args.Length==2&&args[0]=="--self-test")return SelfTest.Run(args[1]);
        if(args.Length==3&&args[0]=="--package-test")return SelfTest.Package(args[1],args[2]);
        if(args.Length==2&&args[0]=="--preview") {
            using var form=new SetupForm(preview:true);form.ShowInTaskbar=false;form.Opacity=0;form.Show();Application.DoEvents();form.PerformLayout();
            using var bmp=new Bitmap(form.Width,form.Height);form.DrawToBitmap(bmp,new Rectangle(Point.Empty,form.Size));bmp.Save(args[1]);return 0;
        }
        using var mutex=new Mutex(true,"Local\\EfbV2Setup",out var owned);
        if(!owned){MessageBox.Show("安装器已经打开，请切换到现有窗口。","EFB v2");return 0;}
        Application.ThreadException+=(_,e)=>MessageBox.Show(e.Exception.Message,"EFB v2 安装器",MessageBoxButtons.OK,MessageBoxIcon.Error);
        Application.Run(new SetupForm());return 0;
    }
}
