param([Parameter(Mandatory=$true)][string]$TabletPath, [switch]$AuthProbe)
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'shared'
$tablet=[IO.Path]::GetFullPath($TabletPath)
$dist=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))+[IO.Path]::DirectorySeparatorChar
if(-not $tablet.StartsWith($dist,[StringComparison]::OrdinalIgnoreCase)){throw 'Shared preparation is restricted to build outputs'}
$shared=Join-Path $tablet 'shared'
New-Item -ItemType Directory -Path $shared -Force | Out-Null
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $shared -Recurse -Force
$prefix='/Pages/VCockpit/Instruments/PMDGTablet/shared'
$wrapper=@'
function installRemoteApps(bus) {
    // Reuse PMDG's bundled SDK for on-demand IniJetway/SimBrief location reads.
    let jetwayLoader, jetwaySession, jetwayAirports = [], airportRead = Promise.resolve();
    window.PMDGSharedApps.install(bus, {
        side: getTabletSide(),
        screenOn: () => ScreenManager.isScreenOn(),
        unfocus: () => Focuser.unfocusView(null),
        importSimbrief: () => {
            const button = document.getElementById('efb_dashboard_requestsimbrief');
            if (!button || typeof button.onclick !== 'function') throw new Error('PMDG import is not ready. Use Request Data from Simbrief in the EFB app.');
            if (button.disabled) throw new Error('PMDG import is already busy. Wait for it to finish.');
            if (!Settings.simbrief_id || Settings.simbrief_id === 'NONE') throw new Error('Set your SimBrief alias in PMDG EFB Preferences, then use Request Data from Simbrief.');
            // Invoke PMDG's own request, UI updates and aircraft transfer once.
            // Do not navigate away or bypass its normal CommBus workflow.
            button.click();
        },
        currentAirport: (lat, lon) => {
            const task = airportRead.then(async () => {
            if (!jetwayLoader) jetwayLoader = new FacilityLoader(FacilityRepository.getRepository(bus));
            if (!jetwaySession) jetwaySession = await jetwayLoader.startNearestSearchSession(FacilitySearchType.Airport);
            const result = await jetwaySession.searchNearest(lat, lon, 3704, 1);
            jetwayAirports = jetwayAirports.filter(icao => !(result.removed || []).includes(icao));
            for (const icao of result.added || []) if (!jetwayAirports.includes(icao)) jetwayAirports.push(icao);
            return jetwayAirports.length ? jetwayLoader.getFacility(FacilityType.Airport, jetwayAirports[0], AirportFacilityDataFlags.Gates) : null;
            });
            airportRead = task.catch(() => {});
            return task;
        }
    });
}

'@
foreach($model in Get-ChildItem -LiteralPath $tablet -Directory -Filter 'pmdg-*'){
    $js=Join-Path $model.FullName 'PMDGTablet.js'
    $text=Get-Content -LiteralPath $js -Raw -Encoding UTF8
    $start=$text.IndexOf('function installGsxRemoteHost(bus)')
    if($start -lt 0){$start=$text.IndexOf('function installRemoteApps(bus)')}
    $end=$text.IndexOf('class PMDGTablet extends BaseInstrument',$start)
    if($start -lt 0 -or $end -lt $start){throw "Unknown extension integration in $js"}
    Write-Utf8 $js ($text.Substring(0,$start)+$wrapper+$text.Substring($end))
    $css=Join-Path $model.FullName 'PMDGTablet.css'
    $text=Get-Content -LiteralPath $css -Raw -Encoding UTF8
    $start=$text.IndexOf('#remote-app-launchers {')
    if($start -ge 0){Write-Utf8 $css ($text.Substring(0,$start))}
    foreach($html in Get-ChildItem -LiteralPath $model.FullName -File -Filter 'PMDGTablet*.html'){
        $text=Get-Content -LiteralPath $html.FullName -Raw -Encoding UTF8
        # Remove legacy and prior shared imports so -ReusePackage stays idempotent.
        $text=[regex]::Replace($text,'(?im)^.*(?:<link|<script)[^\r\n]*(?:landing-analysis/|/shared/)[^\r\n]*(?:\r?\n|$)','')
        $imports=@()
        foreach($style in @('apps.css','landing-analysis/landing-analysis.css','jetways/jetways.css','simbrief/simbrief.css')){$imports+='<link rel="stylesheet" href="'+$prefix+'/'+$style+'" />'}
        foreach($script in @('landing-analysis/core.js','landing-analysis/host.js','landing-analysis/ui.js','jetways/controller.js','jetways/ui.js','simbrief/core.js','simbrief/api.js','simbrief/routes.js','simbrief/tools.js','simbrief/ui.js','apps.js')){$imports+='<script type="text/html" import-script="'+$prefix+'/'+$script+'"></script>'}
        if($AuthProbe){
            $imports+='<link rel="stylesheet" href="'+$prefix+'/simbrief-auth-probe/probe.css" />'
            foreach($script in @('controller.js','ui.js')){$imports+='<script type="text/html" import-script="'+$prefix+'/simbrief-auth-probe/'+$script+'"></script>'}
        }
        $needle='<script type="text/html" import-script="/Pages/VCockpit/Instruments/PMDGTablet/'+$model.Name+'/PMDGTablet.js"></script>'
        if(-not $text.Contains($needle)){throw "Model script import not found: $html"}
        Write-Utf8 $html.FullName ($text.Replace($needle,($imports -join "`r`n")+"`r`n"+$needle))
    }
    foreach($name in @('remoteClient','beyondatc_toolbar','landing-analysis','remote-drag-scroll.js')){
        $target=[IO.Path]::GetFullPath((Join-Path $model.FullName $name))
        if(-not $target.StartsWith($tablet+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe duplicate cleanup path'}
        if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
    }
}
