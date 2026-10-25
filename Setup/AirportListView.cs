namespace EfbSetup;

public sealed class AirportListView:UserControl {
    readonly Label summary=new(){AutoSize=true,Anchor=AnchorStyles.Left,Text=Ui.T("尚未加载机场列表")};
    readonly Label hint=new(){Dock=DockStyle.Fill,Text=Ui.T("仅用于 Dispatch 优先从所选机场随机选择目的地，不影响模拟器中的机场启用状态。"),AutoSize=true,ForeColor=Color.DimGray,Padding=new Padding(0,2,0,5),Margin=new Padding(3,6,3,3)};
    internal readonly Button RefreshButton=new(){Name="refreshAirports",Text=Ui.T("刷新"),AutoSize=true,MinimumSize=new Size(100,30),Anchor=AnchorStyles.Right};
    internal readonly DataGridView Grid=new(){Name="airportGrid",Dock=DockStyle.Fill,AllowUserToAddRows=false,AllowUserToDeleteRows=false,
        AllowUserToResizeRows=false,MultiSelect=false,RowHeadersVisible=false,SelectionMode=DataGridViewSelectionMode.FullRowSelect,
        AutoGenerateColumns=false,BackgroundColor=Color.White,BorderStyle=BorderStyle.FixedSingle,EditMode=DataGridViewEditMode.EditOnEnter};
    bool loading,hasInventory;
    public event Action<string,bool>? SelectionChanged;
    public event Action<Exception>? SelectionFailed;
    public event EventHandler? RefreshRequested;
    public AirportListView() {
        Dock=DockStyle.Fill;Padding=new Padding(8,2,8,5);BackColor=Color.White;
        var layout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,Margin=Padding.Empty};
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,46));layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        var toolbar=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,Margin=Padding.Empty};
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,110));
        toolbar.Controls.Add(summary,0,0);toolbar.Controls.Add(RefreshButton,1,0);
        Grid.Columns.Add(new DataGridViewCheckBoxColumn{Name="Enabled",HeaderText=Ui.T("启用"),Width=58,SortMode=DataGridViewColumnSortMode.NotSortable});
        Grid.Columns.Add(new DataGridViewTextBoxColumn{Name="Icao",HeaderText="ICAO",Width=94,ReadOnly=true,SortMode=DataGridViewColumnSortMode.Automatic});
        Grid.Columns.Add(new DataGridViewTextBoxColumn{Name="AirportName",HeaderText=Ui.T("机场名字"),AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill,FillWeight=65,MinimumWidth=180,ReadOnly=true,SortMode=DataGridViewColumnSortMode.Automatic});
        Grid.Columns.Add(new DataGridViewTextBoxColumn{Name="Creator",HeaderText=Ui.T("制作组"),AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill,FillWeight=35,MinimumWidth=140,ReadOnly=true,SortMode=DataGridViewColumnSortMode.Automatic});
        Grid.RowTemplate.Height=30;
        Grid.DefaultCellStyle.Alignment=DataGridViewContentAlignment.MiddleLeft;
        Grid.ColumnHeadersDefaultCellStyle.Padding=new Padding(0,1,0,2);
        Grid.ColumnHeadersHeightSizeMode=DataGridViewColumnHeadersHeightSizeMode.AutoSize;
        Grid.CurrentCellDirtyStateChanged+=(_,_)=>{if(Grid.IsCurrentCellDirty&&Grid.CurrentCell?.ColumnIndex==0)Grid.CommitEdit(DataGridViewDataErrorContexts.Commit);};
        Grid.CellValueChanged+=(_,e)=>{
            if(loading||e.RowIndex<0||e.ColumnIndex!=0)return;
            var row=Grid.Rows[e.RowIndex];var enabled=row.Cells[0].Value is true;
            try {SelectionChanged?.Invoke(Convert.ToString(row.Cells[1].Value)??"",enabled);}
            catch(Exception error) {
                loading=true;try{row.Cells[0].Value=!enabled;}finally{loading=false;}
                SelectionFailed?.Invoke(error);
            }
            UpdateCount();
        };
        RefreshButton.Click+=(_,_)=>RefreshRequested?.Invoke(this,EventArgs.Empty);
        layout.Controls.Add(toolbar,0,0);layout.Controls.Add(hint,0,1);layout.Controls.Add(Grid,0,2);Controls.Add(layout);
    }
    void UpdateCount()=>summary.Text=Ui.F("已选 {0} / {1} 个机场",Grid.Rows.Cast<DataGridViewRow>().Count(r=>r.Cells[0].Value is true),Grid.Rows.Count);
    public void ShowInventory(AirportInventory inventory) {
        loading=true;hasInventory=true;Grid.SuspendLayout();
        try {
            Grid.Rows.Clear();
            foreach(var a in inventory.Airports) {
                var row=Grid.Rows[Grid.Rows.Add(a.Enabled,a.Icao,a.Name,a.Creator)];
                row.Cells[2].ToolTipText=string.Join(Environment.NewLine,a.Packages.Select(p=>$"{p.Source}: {p.Package}"));
                row.Cells[3].ToolTipText=a.Creator;
            }
            UpdateCount();
            if(inventory.Airports.Length==0)summary.Text=Ui.T("暂无机场，请点击右侧“刷新”");
        } finally {Grid.ResumeLayout();loading=false;}
    }
    internal void ApplyLanguage(){
        RefreshButton.Text=Ui.T("刷新");hint.Text=Ui.T("仅用于 Dispatch 优先从所选机场随机选择目的地，不影响模拟器中的机场启用状态。");
        Grid.Columns[0].HeaderText=Ui.T("启用");Grid.Columns[2].HeaderText=Ui.T("机场名字");
        Grid.Columns[3].HeaderText=Ui.T("制作组");
        if(hasInventory){UpdateCount();if(Grid.Rows.Count==0)summary.Text=Ui.T("暂无机场，请点击右侧“刷新”");}else summary.Text=Ui.T("尚未加载机场列表");
    }
    public void SetBusy(bool busy){Grid.Enabled=!busy;RefreshButton.Enabled=!busy;}
}
