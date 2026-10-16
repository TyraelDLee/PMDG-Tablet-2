using System.Diagnostics;

namespace EfbSetup;
public sealed class SetupForm:Form {
    readonly ComboBox community=new(){Dock=DockStyle.Fill,DropDownStyle=ComboBoxStyle.DropDown};
    readonly TextBox sim=new(){Dock=DockStyle.Fill};
    readonly RadioButton only=new(){Text="仅安装 EFB",AutoSize=true};
    readonly RadioButton lan=new(){Text="安装 EFB + LAN 服务",AutoSize=true,Checked=true};
    readonly NumericUpDown port=new(){Minimum=1024,Maximum=65535,Value=8385,Width=105};
    readonly CheckBox auto=new(){Text="随 MSFS 2024 自动启动",Checked=true,AutoSize=true};
    readonly CheckBox startNow=new(){Text="安装完成后启动 LAN",Checked=true,AutoSize=true};
    readonly TextBox output=new(){Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill,BackColor=Color.FromArgb(245,247,250),BorderStyle=BorderStyle.FixedSingle};
    readonly Button install=new(){Text="安装 / 更新",Width=130,Height=36,BackColor=Color.FromArgb(0,121,194),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
    readonly Button uninstall=new(){Text="卸载",Width=120,Height=36};
    readonly ProgressBar progress=new(){Dock=DockStyle.Fill,Height=6};
    readonly Label status=new(){Text="就绪",AutoSize=true,ForeColor=Color.FromArgb(72,90,107)};
    readonly Button start=new(){Text="启动 LAN",AutoSize=true},stop=new(){Text="停止 LAN",AutoSize=true},config=new(){Text="打开配置",AutoSize=true},applyPort=new(){Text="应用端口",AutoSize=true};
    readonly Installer engine;
    readonly bool hasPayload,preview;
    readonly TableLayoutPanel inputs=new(){ColumnCount=3,RowCount=6,Dock=DockStyle.Fill};
    List<InstallationLocation> detected=[];
    bool busy;
    string? logPath;
    public SetupForm(bool preview=false) {
        this.preview=preview;
        Text="EFB v2 · 安装与管理";Font=new Font("Microsoft YaHei UI",10F);AutoScaleMode=AutoScaleMode.Dpi;
        ClientSize=new Size(1000,860);MinimumSize=new Size(980,880);StartPosition=FormStartPosition.CenterScreen;BackColor=Color.White;
        engine=new Installer(AppContext.BaseDirectory,Paths.DefaultRoot,true,Environment.ProcessPath);
        hasPayload=File.Exists(Path.Combine(AppContext.BaseDirectory,"package","pmdg-tablet-v2","manifest.json"));
        var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(26,20,26,20),ColumnCount=1,RowCount=8};
        foreach(var height in new[]{58F,36F,122F,252F,46F,0F,12F,48F})layout.RowStyles.Add(new RowStyle(height==0?SizeType.Percent:SizeType.Absolute,height==0?100:height));
        var heading=new Label{Text="EFB v2",Font=new Font(Font.FontFamily,26,FontStyle.Bold),Dock=DockStyle.Fill,ForeColor=Color.FromArgb(0,105,174)};
        layout.Controls.Add(heading,0,0);
        layout.Controls.Add(new Label{Text="MSFS 2024  ·  自动检测目录  ·  两种安装模式  ·  普通用户权限",AutoSize=true},0,1);
        var modes=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(12,8,12,8),BackColor=Color.FromArgb(240,246,251)};
        modes.Controls.Add(only);modes.Controls.Add(lan);modes.Controls.Add(new Label{Text="仅 EFB：保留 GSX、BATC 和落地分析；LAN：增加局域网访问。",AutoSize=true,ForeColor=Color.DimGray});
        layout.Controls.Add(modes,0,2);
        inputs.Padding=new Padding(0,12,0,0);inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,192));inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,110));
        for(int i=0;i<6;i++)inputs.RowStyles.Add(new RowStyle(SizeType.Absolute,40));
        AddRow("Community",community,0,()=>BrowseCommunity());
        AddRow("MSFS 配置目录",sim,1,()=>BrowseSim());
        var detectButton=new Button{Text="重新检测",Dock=DockStyle.Fill};detectButton.Click+=(_,_)=>Detect();inputs.Controls.Add(detectButton,2,2);
        var hint=new Label{Text="配置目录内含 UserCfg.opt；仅安装 EFB 时不要求提供。",AutoSize=true,ForeColor=Color.DimGray};inputs.Controls.Add(hint,1,2);
        inputs.Controls.Add(new Label{Text="LAN 端口",AutoSize=true,Padding=new Padding(0,5,0,0)},0,3);
        var network=new FlowLayoutPanel{Dock=DockStyle.Fill};network.Controls.Add(port);network.Controls.Add(applyPort);inputs.Controls.Add(network,1,3);
        var checks=new FlowLayoutPanel{Dock=DockStyle.Fill};checks.Controls.Add(auto);checks.Controls.Add(startNow);inputs.Controls.Add(checks,1,4);inputs.SetColumnSpan(checks,2);
        inputs.Controls.Add(new Label{Text="工具安装目录",AutoSize=true,Padding=new Padding(0,4,0,0)},0,5);
        var rootLabel=new TextBox{Text=Paths.DefaultRoot,ReadOnly=true,BorderStyle=BorderStyle.None,Dock=DockStyle.Fill};inputs.Controls.Add(rootLabel,1,5);inputs.SetColumnSpan(rootLabel,2);
        layout.Controls.Add(inputs,0,3);
        var tools=new FlowLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(0,6,0,0)};tools.Controls.Add(start);tools.Controls.Add(stop);tools.Controls.Add(config);
        var info=new Button{Text="连接信息",AutoSize=true};tools.Controls.Add(info);info.Click+=async(_,_)=>await Work(()=>{LogThread(engine.ConnectionDetails());var cfg=engine.Config();if(cfg==null)return;try{using var http=new System.Net.Http.HttpClient{Timeout=TimeSpan.FromSeconds(3)};var health=http.GetStringAsync($"http://127.0.0.1:{cfg.Port}/health").GetAwaiter().GetResult();using var json=System.Text.Json.JsonDocument.Parse(health);var sides=string.Join(", ",json.RootElement.GetProperty("hosts").EnumerateArray().Select(x=>x.GetString()));LogThread("LAN 服务在线；模拟器平板："+(sides.Length>0?sides:"尚未连接"));}catch{LogThread("LAN 服务未响应，可检查服务日志。");}});
        var openLog=new Button{Text="打开日志",AutoSize=true};tools.Controls.Add(openLog);openLog.Click+=(_,_)=>Safe(()=>{EnsureLog();Process.Start(new ProcessStartInfo("notepad.exe"){ArgumentList={logPath!},UseShellExecute=false});});
        layout.Controls.Add(tools,0,4);layout.Controls.Add(output,0,5);layout.Controls.Add(progress,0,6);
        var footer=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3};footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,134));footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,140));footer.Controls.Add(status,0,0);footer.Controls.Add(uninstall,1,0);footer.Controls.Add(install,2,0);layout.Controls.Add(footer,0,7);
        Controls.Add(layout);
        lan.CheckedChanged+=(_,_)=>Availability();only.CheckedChanged+=(_,_)=>Availability();
        community.SelectedIndexChanged+=(_,_)=>{var entry=detected.FirstOrDefault(x=>x.Community==community.Text);if(entry!=null)sim.Text=entry.Config;};
        install.Click+=async(_,_)=>{var options=new InstallOptions(community.Text,sim.Text,lan.Checked,(int)port.Value,auto.Checked,startNow.Checked);await Work(()=>Log(engine.Install(options,new ProgressRelay(LogThread))));};
        uninstall.Click+=async(_,_)=>{if(MessageBox.Show(this,"将移除 pmdg-tablet-v2 和 LAN 服务及其自动启动项，不恢复旧版本。是否继续？","卸载 EFB v2",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes)await Work(()=>engine.Uninstall(new ProgressRelay(LogThread)));};
        start.Click+=async(_,_)=>await Work(()=>{engine.Start();LogThread("LAN 服务已启动。\r\n"+engine.ConnectionDetails());});
        stop.Click+=async(_,_)=>await Work(()=>{engine.Stop();LogThread("LAN 服务已停止。");});
        config.Click+=(_,_)=>Safe(()=>{var file=Path.Combine(Paths.DefaultRoot,"bridge.json");if(!File.Exists(file))throw new IOException("尚未生成 LAN 配置。");Process.Start(new ProcessStartInfo("notepad.exe"){ArgumentList={file},UseShellExecute=false});});
        applyPort.Click+=async(_,_)=>{var value=(int)port.Value;await Work(()=>{engine.ApplyPort(value);LogThread("端口配置已更新，下次进入飞机时生效。\r\n"+engine.ConnectionDetails());});};
        FormClosing+=(_,e)=>{if(busy)e.Cancel=true;};
        if(preview){community.Text=@"A:\Games\MSFS2024\Community";sim.Text=@"C:\Users\Pilot\AppData\Local\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache";output.Text="检测到 MSFS 2024 的 Community 文件夹。\r\n选择安装模式后，点击“安装 / 更新”。\r\n安装会更新 pmdg-tablet-v2，不创建备份。";}
        else {Detect();Safe(()=>{var state=engine.State();if(state!=null){community.Text=state.CommunityPath;sim.Text=state.SimConfigPath;lan.Checked=state.WithLan;only.Checked=!state.WithLan;auto.Checked=state.AutoStart;var cfg=engine.Config();if(cfg!=null&&cfg.Port is >=1024 and <=65535)port.Value=cfg.Port;Log("已载入现有安装。模式："+(state.WithLan?"EFB + LAN":"仅 EFB"));}if(!hasPayload)Log("此窗口可管理、配置和卸载。安装或更新请从解压后的完整安装包运行。 ");});}
        Availability();
    }
    void AddRow(string label,Control control,int row,Action browse){inputs.Controls.Add(new Label{Text=label,AutoSize=true,Padding=new Padding(0,5,0,0)},0,row);inputs.Controls.Add(control,1,row);var button=new Button{Text="浏览…",Dock=DockStyle.Fill};button.Click+=(_,_)=>Safe(browse);inputs.Controls.Add(button,2,row);}
    void BrowseCommunity(){using var dialog=new FolderBrowserDialog{Description="选择 MSFS 2024 的 Community 或 Community2024 文件夹",UseDescriptionForTitle=true};if(Directory.Exists(community.Text))dialog.SelectedPath=community.Text;if(dialog.ShowDialog(this)==DialogResult.OK)community.Text=dialog.SelectedPath;}
    void BrowseSim(){using var dialog=new FolderBrowserDialog{Description="选择包含 UserCfg.opt 的 MSFS 2024 配置目录",UseDescriptionForTitle=true};if(Directory.Exists(sim.Text))dialog.SelectedPath=sim.Text;if(dialog.ShowDialog(this)==DialogResult.OK)sim.Text=dialog.SelectedPath;}
    void Detect(){Safe(()=>{var result=Paths.Detect();detected=result.Locations;community.Items.Clear();foreach(var c in detected.Select(x=>x.Community).Where(x=>x.Length>0).Distinct())community.Items.Add(c);if(community.Items.Count>0){community.SelectedIndex=0;Log("已检测到 Community。若有多个目录，请从下拉列表选择。");}else Log("未自动找到 Community，请点击“浏览”手动选择。仅 EFB 模式可直接继续。");if(detected.Count>0&&string.IsNullOrWhiteSpace(sim.Text))sim.Text=detected[0].Config;foreach(var warning in result.Warnings)Log(warning);});}
    void EnsureLog(){if(logPath!=null)return;var folder=Path.Combine(Paths.DefaultRoot,"logs");Directory.CreateDirectory(folder);logPath=Path.Combine(folder,"setup-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".log");File.WriteAllText(logPath,"");}
    void Log(string text){if(InvokeRequired){LogThread(text);return;}output.AppendText(text+Environment.NewLine);if(!preview){try{EnsureLog();File.AppendAllText(logPath!,DateTimeOffset.Now.ToString("o")+" "+text+Environment.NewLine);}catch{}}}
    void LogThread(string text){if(!IsDisposed)BeginInvoke(new Action(()=>Log(text)));}
    void Safe(Action action){try{action();}catch(Exception e){Log("错误："+e.Message);}}
    void Availability(){InstallState? state=null;try{if(!preview)state=engine.State();}catch{}inputs.Enabled=!busy;only.Enabled=lan.Enabled=!busy;port.Enabled=auto.Enabled=startNow.Enabled=!busy&&lan.Checked;applyPort.Enabled=!busy&&state?.WithLan==true;start.Enabled=stop.Enabled=config.Enabled=!busy&&state?.WithLan==true;install.Enabled=!busy&&(hasPayload||preview);uninstall.Enabled=!busy&&state!=null;}
    async Task Work(Action action){if(busy)return;busy=true;Availability();progress.Style=ProgressBarStyle.Marquee;status.Text="正在处理，请勿关闭窗口…";try{await Task.Run(action);status.Text="操作完成";}catch(Exception e){status.Text="未完成，请查看下方原因";Log("失败："+e);MessageBox.Show(this,e.Message+"\r\n\r\n完整信息已保存在日志中。","操作未完成",MessageBoxButtons.OK,MessageBoxIcon.Error);}finally{busy=false;progress.Style=ProgressBarStyle.Blocks;Availability();}}
    sealed class ProgressRelay(Action<string> report):IProgress<string>{public void Report(string value)=>report(value);}
}
