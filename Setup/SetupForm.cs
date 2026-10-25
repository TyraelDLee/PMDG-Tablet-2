namespace EfbSetup;
public sealed class SetupForm:Form {
    readonly ComboBox community=new(){Name="community",Dock=DockStyle.Fill,DropDownStyle=ComboBoxStyle.DropDown};
    readonly TextBox sim=new(){Name="simConfig",Dock=DockStyle.Fill};
    readonly TextBox airlabs=new(){Name="airlabsKey",Dock=DockStyle.Fill,PlaceholderText=Ui.T("可选；用于 Dispatch 随机真实航班")};
    readonly NumericUpDown port=new(){Name="port",Minimum=1024,Maximum=65535,Value=8385,Width=105};
    readonly TextBox output=new(){Name="log",Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill,BackColor=Color.FromArgb(245,247,250),BorderStyle=BorderStyle.FixedSingle};
    readonly Button install=new(){Text=Ui.T("安装 / 更新"),Width=176,Height=36,BackColor=Color.FromArgb(0,121,194),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
    readonly Button uninstall=new(){Text=Ui.T("卸载"),Width=120,Height=36};
    readonly ProgressBar progress=new(){Dock=DockStyle.Fill,Height=6};
    readonly Label status=new(){Text=Ui.T("就绪"),AutoSize=true,ForeColor=Color.FromArgb(72,90,107)};
    readonly Button applyPort=new(){Name="applyPort",Text=Ui.T("应用端口"),AutoSize=true};
    readonly TabControl tabs=new(){Dock=DockStyle.Fill};
    readonly ComboBox language=new(){Name="language",DropDownStyle=ComboBoxStyle.DropDownList,Width=180,Anchor=AnchorStyles.Right};
    readonly TabPage logTab=new(Ui.T("日志")),airportTab=new(Ui.T("已安装机场"));
    readonly AirportListView airportView=new();
    bool airportsLoaded,shown,settingLanguage;
    readonly List<string> logEntries=[];
    readonly Installer engine;
    readonly bool hasPayload,preview;
    readonly TableLayoutPanel inputs=new(){ColumnCount=3,RowCount=5,Dock=DockStyle.Fill};
    List<InstallationLocation> detected=[];
    bool busy;
    string? logPath;
    public SetupForm(bool preview=false) {
        this.preview=preview;
        Text=Ui.T("EFB v2 · 安装与管理");Font=new Font(Ui.Language=="zh"?"Microsoft YaHei UI":"Segoe UI",10F);AutoScaleMode=AutoScaleMode.Dpi;
        ClientSize=new Size(1000,760);MinimumSize=new Size(980,740);StartPosition=FormStartPosition.CenterScreen;BackColor=Color.White;
        engine=new Installer(AppContext.BaseDirectory,Paths.DefaultRoot,true,Environment.ProcessPath);
        hasPayload=File.Exists(Path.Combine(AppContext.BaseDirectory,"package","pmdg-tablet-v2","manifest.json"));
        var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(26,20,26,20),ColumnCount=1,RowCount=5};
        foreach(var height in new[]{58F,252F,0F,12F,48F})layout.RowStyles.Add(new RowStyle(height==0?SizeType.Percent:SizeType.Absolute,height==0?100:height));
        var heading=new Label{Text="EFB v2",Font=new Font(Font.FontFamily,26,FontStyle.Bold),Dock=DockStyle.Fill,ForeColor=Color.FromArgb(0,105,174)};
        var header=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,Margin=Padding.Empty};
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,320));
        header.Controls.Add(heading,0,0);
        var languageBox=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.RightToLeft,WrapContents=false,Padding=new Padding(0,12,0,0)};
        language.Items.AddRange(["System / 系统","English","简体中文"]);language.SelectedIndex=Ui.Mode=="en"?1:Ui.Mode=="zh"?2:0;
        languageBox.Controls.Add(language);languageBox.Controls.Add(new Label{Text=Ui.T("语言"),AutoSize=true,Padding=new Padding(0,5,4,0)});header.Controls.Add(languageBox,1,0);
        layout.Controls.Add(header,0,0);
        inputs.Padding=new Padding(0,12,0,10);inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,192));inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,110));
        for(int i=0;i<5;i++)inputs.RowStyles.Add(new RowStyle(SizeType.Absolute,i>=3?50:40));
        AddRow("Community",community,0,()=>BrowseCommunity());
        AddRow(Ui.T("MSFS 配置目录"),sim,1,()=>BrowseSim());
        var detectButton=new Button{Text=Ui.T("重新检测"),Dock=DockStyle.Fill};detectButton.Click+=(_,_)=>Detect();inputs.Controls.Add(detectButton,2,2);
        var hint=new Label{Text=Ui.T("配置目录内含 UserCfg.opt，用于注册模拟器自动启动。"),AutoSize=true,ForeColor=Color.DimGray};inputs.Controls.Add(hint,1,2);
        inputs.Controls.Add(new Label{Text=Ui.T("LAN 端口"),AutoSize=true,Padding=new Padding(0,5,0,0)},0,3);
        var network=new FlowLayoutPanel{Dock=DockStyle.Fill};network.Controls.Add(port);network.Controls.Add(applyPort);inputs.Controls.Add(network,1,3);
        inputs.Controls.Add(new Label{Text="AirLabs API key",AutoSize=true,Padding=new Padding(0,4,0,0)},0,4);
        inputs.Controls.Add(airlabs,1,4);inputs.SetColumnSpan(airlabs,2);
        layout.Controls.Add(inputs,0,1);
        logTab.Controls.Add(output);airportTab.Controls.Add(airportView);tabs.TabPages.Add(logTab);tabs.TabPages.Add(airportTab);
        layout.Controls.Add(tabs,0,2);layout.Controls.Add(progress,0,3);
        var footer=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3};footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,134));footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,184));footer.Controls.Add(status,0,0);footer.Controls.Add(uninstall,1,0);footer.Controls.Add(install,2,0);layout.Controls.Add(footer,0,4);
        Controls.Add(layout);
        Ui.Apply(this);
        language.SelectedIndexChanged+=(_,_)=>{
            if(settingLanguage||busy)return;
            var mode=language.SelectedIndex==1?"en":language.SelectedIndex==2?"zh":"auto";
            try{Ui.Set(mode,preview?null:Paths.DefaultRoot);ApplyLanguage();}
            catch(Exception error){ApplyLanguage();Log(Ui.T("语言设置未保存：")+error.Message);}
        };
        community.SelectedIndexChanged+=async(_,_)=>{var entry=detected.FirstOrDefault(x=>x.Community==community.Text);if(entry!=null)sim.Text=entry.Config;if(shown)await InitializeAirports();};
        community.Validated+=async(_,_)=>{if(shown)await InitializeAirports();};
        install.Click+=async(_,_)=>{var options=new InstallOptions(community.Text,sim.Text,Lan:true,Port:(int)port.Value,AutoStart:true,StartNow:false,AirlabsApiKey:airlabs.Text);await Work(()=>{LogThread(engine.Install(options,new ProgressRelay(LogThread)));LogThread(Ui.T("LAN 服务将在下次启动 MSFS 2024 时自动运行。"));});airportsLoaded=false;await InitializeAirports();};
        uninstall.Click+=async(_,_)=>{if(MessageBox.Show(this,Ui.T("将移除 pmdg-tablet-v2 和 LAN 服务及其自动启动项，不恢复旧版本。是否继续？"),Ui.T("卸载 EFB v2"),MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes)await Work(()=>engine.Uninstall(new ProgressRelay(LogThread)));};
        tabs.SelectedIndexChanged+=async(_,_)=>{if(tabs.SelectedTab==airportTab)await InitializeAirports();};
        airportView.RefreshRequested+=async(_,_)=>{
            var communityPath=community.Text;var configPath=sim.Text;AirportInventory? refreshed=null;
            await Work(()=>{refreshed=engine.RefreshAirports(communityPath,configPath);LogThread(Ui.F("机场列表已刷新：已选 {0} / {1} 个机场。",refreshed.Icaos.Length,refreshed.Airports.Length));foreach(var warning in refreshed.Warnings)LogThread(Ui.T("机场扫描提示：")+warning);});
            if(refreshed!=null){airportView.ShowInventory(refreshed);airportsLoaded=true;}
        };
        airportView.SelectionChanged+=(icao,enabled)=>{
            if(preview)return;
            engine.SetAirportEnabled(icao,enabled);
        };
        airportView.SelectionFailed+=e=>{Log(Ui.T("机场选择未保存：")+e.Message);status.Text=Ui.T("机场选择未保存");MessageBox.Show(this,e.Message,Ui.T("机场选择未保存"),MessageBoxButtons.OK,MessageBoxIcon.Error);};
        applyPort.Click+=async(_,_)=>{var value=(int)port.Value;await Work(()=>{engine.ApplyPort(value);LogThread(Ui.T("端口配置已更新，下次进入飞机时生效。\r\n")+engine.ConnectionDetails());});};
        FormClosing+=(_,e)=>{if(busy)e.Cancel=true;};
        if(preview){community.Text=@"A:\Games\MSFS2024\Community";sim.Text=@"C:\Users\Pilot\AppData\Local\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache";airlabs.Text="example-airlabs-key";Log(Ui.T("已载入现有安装。"));Log("http://192.168.1.20:8385/");Log(Ui.T("本机：")+"http://127.0.0.1:8385/");Log(Ui.T("配对码：")+"0042");Log(Ui.T("LAN 服务随 MSFS 2024 自动启动。"));}
        else {Detect();Safe(()=>{airlabs.Text=engine.Airlabs().ApiKey;var state=engine.State();if(state!=null){community.Text=state.CommunityPath;sim.Text=state.SimConfigPath;var cfg=engine.Config();if(cfg!=null&&cfg.Port is >=1024 and <=65535)port.Value=cfg.Port;Log(Ui.T("已载入现有安装。"));if(state.WithLan){Log(engine.ConnectionDetails());Log(state.AutoStart?Ui.T("LAN 服务随 MSFS 2024 自动启动。"):Ui.T("安装 / 更新后将启用随 MSFS 2024 自动启动。"));}}if(!hasPayload)Log(Ui.T("此窗口可配置和卸载。安装或更新请从解压后的完整安装包运行。"));});}
        Availability();
        Shown+=async(_,_)=>{shown=true;await InitializeAirports();};
    }
    internal void ApplyLanguage(){
        SuspendLayout();try{
            Ui.Apply(this);Font=new Font(Ui.Language=="zh"?"Microsoft YaHei UI":"Segoe UI",10F);
            airlabs.PlaceholderText=Ui.T("可选；用于 Dispatch 随机真实航班");
            language.AccessibleName=Ui.T("语言");settingLanguage=true;
            try{language.SelectedIndex=Ui.Mode=="en"?1:Ui.Mode=="zh"?2:0;}finally{settingLanguage=false;}
            airportView.ApplyLanguage();output.Text=string.Join(Environment.NewLine,logEntries.Select(Ui.Render))+Environment.NewLine;
        }finally{ResumeLayout(true);}
    }
    async Task InitializeAirports(){
        if(airportsLoaded||busy)return;
        if(preview){airportView.ShowInventory(PreviewAirports());airportsLoaded=true;return;}
        // A first-time user may still need to choose Community manually. Retry
        // after path selection; never replace a missing path with an empty scan.
        if(!engine.HasLocalAirports&&!Directory.Exists(community.Text))return;
        var communityPath=community.Text;var simPath=sim.Text;AirportInventory? loaded=null;
        await Work(()=>loaded=engine.LoadOrScanAirports(communityPath,simPath),quiet:true);
        if(loaded!=null){airportView.ShowInventory(loaded);airportsLoaded=true;}
    }
    internal void PreviewAirportTab(){tabs.SelectedTab=airportTab;}
    static AirportInventory PreviewAirports()=>AirportInventoryStore.Normalize(new AirportInventory{Airports=[
        new("EDDF",[],"Frankfurt Airport",false,Creator:"Example Studio A"),new("EGLL",[],"London Heathrow Airport",Creator:"Example Studio B"),new("OMDB",[],"Dubai International Airport",Creator:"Example Studio C"),
        new("VHHH",[],"Hong Kong International Airport",Creator:"Example Studio A"),new("YBBN",[],"Brisbane Airport"),new("YMML",[],"Melbourne Airport",Creator:"Example Studio B")]});
    void AddRow(string label,Control control,int row,Action browse){inputs.Controls.Add(new Label{Text=label,AutoSize=true,Padding=new Padding(0,5,0,0)},0,row);inputs.Controls.Add(control,1,row);var button=new Button{Text=Ui.T("浏览…"),Dock=DockStyle.Fill};button.Click+=(_,_)=>Safe(browse);inputs.Controls.Add(button,2,row);}
    void BrowseCommunity(){using var dialog=new FolderBrowserDialog{Description=Ui.T("选择 MSFS 2024 的 Community 或 Community2024 文件夹"),UseDescriptionForTitle=true};if(Directory.Exists(community.Text))dialog.SelectedPath=community.Text;if(dialog.ShowDialog(this)==DialogResult.OK){community.Text=dialog.SelectedPath;if(shown)_=InitializeAirports();}}
    void BrowseSim(){using var dialog=new FolderBrowserDialog{Description=Ui.T("选择包含 UserCfg.opt 的 MSFS 2024 配置目录"),UseDescriptionForTitle=true};if(Directory.Exists(sim.Text))dialog.SelectedPath=sim.Text;if(dialog.ShowDialog(this)==DialogResult.OK)sim.Text=dialog.SelectedPath;}
    void Detect(){Safe(()=>{var result=Paths.Detect();detected=result.Locations;community.Items.Clear();foreach(var c in detected.Select(x=>x.Community).Where(x=>x.Length>0).Distinct())community.Items.Add(c);if(community.Items.Count>0){community.SelectedIndex=0;Log(Ui.T("已检测到 Community。若有多个目录，请从下拉列表选择。"));}else Log(Ui.T("未自动找到 Community，请点击“浏览”手动选择。"));if(detected.Count>0&&string.IsNullOrWhiteSpace(sim.Text))sim.Text=detected[0].Config;foreach(var warning in result.Warnings)Log(warning);});}
    void EnsureLog(){if(logPath!=null)return;var folder=Path.Combine(Paths.DefaultRoot,"logs");Directory.CreateDirectory(folder);logPath=Path.Combine(folder,"setup-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".log");File.WriteAllText(logPath,"");}
    void Log(string text){if(InvokeRequired){LogThread(text);return;}logEntries.Add(text);var translated=Ui.Render(text);output.AppendText(translated+Environment.NewLine);if(!preview){try{EnsureLog();File.AppendAllText(logPath!,DateTimeOffset.Now.ToString("o")+" "+translated+Environment.NewLine);}catch{}}}
    void LogThread(string text){if(!IsDisposed)BeginInvoke(new Action(()=>Log(text)));}
    void Safe(Action action){try{action();}catch(Exception e){Log(Ui.T("错误：")+e.Message);}}
    void Availability(){InstallState? state=null;try{if(!preview)state=engine.State();}catch{}inputs.Enabled=!busy;language.Enabled=!busy;applyPort.Enabled=!busy&&state?.WithLan==true;airportView.SetBusy(busy);install.Enabled=!busy&&(hasPayload||preview);uninstall.Enabled=!busy&&state!=null;}
    async Task Work(Action action,bool quiet=false){if(busy)return;busy=true;Availability();progress.Style=ProgressBarStyle.Marquee;if(!quiet)status.Text=Ui.T("正在处理，请勿关闭窗口…");try{await Task.Run(action);if(!quiet)status.Text=Ui.T("操作完成");}catch(Exception e){status.Text=Ui.T("未完成，请查看下方原因");Log(Ui.T("失败：")+e);MessageBox.Show(this,e.Message+Ui.T("\r\n\r\n完整信息已保存在日志中。"),Ui.T("操作未完成"),MessageBoxButtons.OK,MessageBoxIcon.Error);}finally{busy=false;progress.Style=ProgressBarStyle.Blocks;Availability();}}
    sealed class ProgressRelay(Action<string> report):IProgress<string>{public void Report(string value)=>report(value);}
}
