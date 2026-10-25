using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.StaticFiles;

var root = AppContext.BaseDirectory;
var configPath = args.SkipWhile(x => x != "--config").Skip(1).FirstOrDefault() ?? Path.Combine(root, "bridge.json");
try { await Run(); }
catch (Exception e) { Directory.CreateDirectory(Path.Combine(root,"logs")); await File.AppendAllTextAsync(Path.Combine(root,"logs","bridge.log"), $"{DateTimeOffset.Now:o} {e}\n"); Environment.ExitCode=1; }
async Task Run() {
 var cfg = JsonSerializer.Deserialize<Config>(File.ReadAllText(configPath), new JsonSerializerOptions {PropertyNameCaseInsensitive=true}) ?? throw new Exception("bridge.json is empty");
 if (cfg.Port is <1024 or >65535 || cfg.GsxPort is <1 or >65535 || cfg.BatcPort is <1 or >65535 || !Regex.IsMatch(cfg.PairingKey,@"\A[0-9]{4}\z") || cfg.HostKey.Length <32) throw new Exception("Invalid port or keys in bridge.json (PairingKey must be four digits; update using the installer)");
 if (!IPAddress.TryParse(cfg.BindAddress,out _)) throw new Exception("BindAddress must be an IP address");
 var assets=Path.GetFullPath(Path.Combine(cfg.PackagePath,"html_ui"));
 if (!Directory.Exists(assets)) throw new Exception("EFB package not found: "+assets);
 using var mutex=new Mutex(true,"Local\\EfbV2LanBridge-"+cfg.Port,out var owns); if(!owns)return;
 SynchronizeHostConfig(cfg);
 var builder=WebApplication.CreateBuilder(new WebApplicationOptions {Args=[],ContentRootPath=root});
 builder.Logging.ClearProviders();
 builder.Services.Configure<HostOptions>(o=>o.ShutdownTimeout=TimeSpan.FromSeconds(5));
 builder.Services.AddRateLimiter(o=>{o.RejectionStatusCode=429;o.AddFixedWindowLimiter("pair",l=>{l.PermitLimit=5;l.Window=TimeSpan.FromMinutes(1);l.QueueLimit=0;});});
 builder.WebHost.UseKestrel(o=>o.Listen(IPAddress.Parse(cfg.BindAddress),cfg.Port));
 var app=builder.Build();
 app.UseWebSockets(new WebSocketOptions {KeepAliveInterval=TimeSpan.FromSeconds(20)});
 app.UseRateLimiter();
 var hosts=new ConcurrentDictionary<string,Peer>(); var clients=new ConcurrentDictionary<Guid,Peer>();
 var contentTypes=new FileExtensionContentTypeProvider();
 // The short PIN is only for pairing; it must never authenticate a forged cookie.
 var sessionToken=Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(cfg.HostKey),Encoding.UTF8.GetBytes("efb-session-v1:"+cfg.PairingKey)));
 bool Paired(HttpContext c)=>c.Request.Cookies["efb-pair"]==sessionToken;
 bool OriginOk(HttpContext c) { var o=c.Request.Headers.Origin.ToString(); return Uri.TryCreate(o,UriKind.Absolute,out var u) && u.Authority.Equals(c.Request.Host.Value,StringComparison.OrdinalIgnoreCase); }
 async Task Send(Peer p,object obj) { try { await p.Send(JsonSerializer.Serialize(obj)); } catch { p.Socket.Abort(); } }
 async Task Notify(string side,object obj) { foreach(var p in clients.Values.Where(p=>p.Side==side))await Send(p,obj); }
 app.Use(async (c,next)=> { c.Response.Headers.XContentTypeOptions="nosniff"; c.Response.Headers.CacheControl="no-store"; await next(); });
 app.MapGet("/health",()=>Results.Json(new {service="EFB v2 LAN",version="0.2.43",hosts=hosts.Keys}));
 app.MapGet("/session",(HttpContext c)=>Paired(c)?Results.Ok():Results.Unauthorized());
 app.MapGet("/diagnostics",(HttpContext c)=>Paired(c)?Results.Json(hosts.ToDictionary(h=>h.Key,h=>h.Value.Resources.Diagnostics())):Results.Unauthorized());
 app.MapGet("/resources/{side}/{epoch}/{id}",(HttpContext c,string side,string epoch,string id)=>{
  if(!Paired(c))return Results.Unauthorized();
  if(!hosts.TryGetValue(side,out var host))return Results.NotFound();
  NativeResources.Resource? resource;try{resource=host.Resources.Get(epoch,id);}catch(JsonException){return Results.NotFound();}
  if(resource==null)return Results.NotFound();
  c.Response.Headers.ContentSecurityPolicy="sandbox; default-src 'none'; style-src 'unsafe-inline'";
  return Results.File(resource.Data,resource.Mime);
 });
 app.MapPost("/pair",async c=> {
  if(!OriginOk(c)){c.Response.StatusCode=403;return;}
  if(c.Request.ContentLength>1024){c.Response.StatusCode=413;return;}
  var input=await c.Request.ReadFromJsonAsync<PairRequest>();
  if(input?.Key!=cfg.PairingKey){await Task.Delay(500);c.Response.StatusCode=401;return;}
  c.Response.Cookies.Append("efb-pair",sessionToken,new CookieOptions{HttpOnly=true,SameSite=SameSiteMode.Strict,MaxAge=TimeSpan.FromDays(30),Path="/"});
  await c.Response.WriteAsJsonAsync(new {ok=true});
 }).RequireRateLimiting("pair");
 app.MapGet("/",()=>Results.File(Path.Combine(root,"web","index.html"),"text/html"));
 app.MapGet("/client.js",()=>Results.File(Path.Combine(root,"web","client.js"),"text/javascript"));
 app.MapGet("/client-gestures.js",()=>Results.File(Path.Combine(root,"web","client-gestures.js"),"text/javascript"));
 app.MapGet("/client.css",()=>Results.File(Path.Combine(root,"web","client.css"),"text/css"));
 app.MapGet("/lan-controls.css",()=>Results.File(Path.Combine(root,"web","lan-controls.css"),"text/css"));
 app.MapGet("/client-fixes.css",()=>Results.File(Path.Combine(root,"web","client-fixes.css"),"text/css"));
 app.MapGet("/assets/{**file}",async c=> {
  if(!Paired(c)){c.Response.StatusCode=401;return;}
  // Older native adapters may send /assets//Pages/... from PMDG's coui URL.
  var relative=(Convert.ToString(c.Request.RouteValues["file"])??"").TrimStart('/');
  var file=Path.GetFullPath(Path.Combine(assets,relative.Replace('/',Path.DirectorySeparatorChar)));
  if(!file.StartsWith(assets+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase) || relative.Contains("lan-bridge",StringComparison.OrdinalIgnoreCase) || relative.EndsWith("/airlabs-settings.json",StringComparison.OrdinalIgnoreCase) || !File.Exists(file)){c.Response.StatusCode=404;return;}
  if(!contentTypes.TryGetContentType(file,out var mime)){c.Response.StatusCode=404;return;}
  c.Response.ContentType=mime;
  // The native clients still talk to their original backend. Proxying keeps 127.0.0.1
  // on the simulator PC, rather than accidentally connecting to the iPad itself.
  if(relative.EndsWith("remoteClient/js/connection.js",StringComparison.OrdinalIgnoreCase)) {
   var js=await File.ReadAllTextAsync(file); js=js.Replace("function wsUrl() {","function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/services/gsx';");
   await c.Response.WriteAsync(js);return;
  }
  if(relative.EndsWith("beyondatc_toolbar/beyondatc_toolbar.js",StringComparison.OrdinalIgnoreCase)) {
   var js=await File.ReadAllTextAsync(file);js=js.Replace("'ws://127.0.0.1:41716'","((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/services/batc')");
   await c.Response.WriteAsync(js);return;
  }
  await c.Response.SendFileAsync(file);
 });
 app.Map("/services/{service}",async c=> {
  if(!Paired(c)||!OriginOk(c)||!c.WebSockets.IsWebSocketRequest){c.Response.StatusCode=403;return;}
  var service=Convert.ToString(c.Request.RouteValues["service"]);if(service is not ("gsx" or "batc")){c.Response.StatusCode=404;return;}
  using var upstream=new ClientWebSocket();
  using var timeout=CancellationTokenSource.CreateLinkedTokenSource(c.RequestAborted,app.Lifetime.ApplicationStopping);timeout.CancelAfter(TimeSpan.FromSeconds(8));
  try {await upstream.ConnectAsync(new Uri($"ws://127.0.0.1:{(service=="gsx"?cfg.GsxPort:cfg.BatcPort)}/"),timeout.Token);}catch{c.Response.StatusCode=503;return;}
  using var browser=await c.WebSockets.AcceptWebSocketAsync();using var stop=CancellationTokenSource.CreateLinkedTokenSource(c.RequestAborted,app.Lifetime.ApplicationStopping);
  async Task Pipe(WebSocket source,WebSocket dest){var bytes=new byte[65536];try{while(!stop.IsCancellationRequested){var r=await source.ReceiveAsync(bytes,stop.Token);if(r.MessageType==WebSocketMessageType.Close)break;await dest.SendAsync(bytes.AsMemory(0,r.Count),r.MessageType,r.EndOfMessage,stop.Token);}}catch{}finally{stop.Cancel();}}
  await Task.WhenAll(Pipe(browser,upstream),Pipe(upstream,browser));browser.Abort();upstream.Abort();
 });
 app.Map("/ws/{role}",async c=> {
  var role=Convert.ToString(c.Request.RouteValues["role"]);var side=c.Request.Query["side"].ToString().ToUpperInvariant();
  if(side is not ("CA" or "FO") || !c.WebSockets.IsWebSocketRequest){c.Response.StatusCode=400;return;}
  bool isHost=role=="host";
  if(isHost ? !(c.Connection.RemoteIpAddress is {} ip && IPAddress.IsLoopback(ip) && c.Request.Query["key"]==cfg.HostKey) : role!="client" || !Paired(c)||!OriginOk(c)){c.Response.StatusCode=403;return;}
  using var socket=await c.WebSockets.AcceptWebSocketAsync();var peer=new Peer(socket,side);var id=Guid.NewGuid();
  if(isHost){if(hosts.TryGetValue(side,out var old))old.Socket.Abort();hosts[side]=peer;await Notify(side,new {type="host",online=true});await Send(peer,new {type="subscribers",count=clients.Values.Count(p=>p.Side==side)});}
  else {clients[id]=peer;await Send(peer,new {type="ping",now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()});await Send(peer,new {type="host",online=hosts.ContainsKey(side)});if(hosts.TryGetValue(side,out var h)){await Send(h,new {type="subscribers",count=clients.Values.Count(p=>p.Side==side)});await Send(h,new {type="resync"});}}
  try {
   while(socket.State==WebSocketState.Open) {
    var text=await Receive(socket,c.RequestAborted);if(text==null)break;
    using var doc=JsonDocument.Parse(text);var msg=doc.RootElement;var type=msg.GetProperty("type").GetString();
    if(isHost) {
     if(!hosts.TryGetValue(side,out var live)||live!=peer)break;
     if(type=="resource-error")peer.Resources.Fail(msg);
     else if(type=="resource") {
      try{if(peer.Resources.Add(msg))await Send(peer,new{type="resource-ack",id=msg.GetProperty("id").GetString(),ok=true});}
      catch(JsonException){await Send(peer,new{type="resource-ack",id=msg.GetProperty("id").GetString(),ok=false});}
     }
     else if(type=="resource-drop")peer.Resources.Drop(msg.GetProperty("epoch").GetString()!,msg.GetProperty("id").GetString()!);
     else if(type is "frame" or "patch") { peer.Epoch=msg.GetProperty("epoch").GetString();await Notify(side,msg); }
     else if(type=="pong") peer.LastSeen=DateTime.UtcNow;
    } else {
     if(type=="pong")peer.LastSeen=DateTime.UtcNow;
     else if(type=="resync" && hosts.TryGetValue(side,out var h))await Send(h,new {type="resync"});
     else if(type=="action" && hosts.TryGetValue(side,out var target)) {
      // Only bounded UI events for the current host session; no code/eval or arbitrary RPC.
      if(text.Length>32768 || msg.GetProperty("epoch").GetString()!=target.Epoch)continue;
      if(!msg.TryGetProperty("createdAt",out var created) || !created.TryGetInt64(out var stamp))continue;
      var age=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-stamp;
      if(age>3000 || age < -500)continue;
      var ev=msg.GetProperty("event").GetString();
      if(ev is not ("tap" or "click" or "input" or "change" or "scroll" or "view-scroll" or "view-map" or "keydown" or "keyup" or "mousedown" or "mouseup" or "mousemove"))continue;
      if(!peer.AllowAction())continue;
      await Send(target,msg);
     }
    }
   }
  }catch(Exception e) when(e is WebSocketException or OperationCanceledException or JsonException or InvalidOperationException or KeyNotFoundException){}
  finally {
   if(isHost){if(hosts.TryGetValue(side,out var h)&&h==peer){hosts.TryRemove(side,out _);await Notify(side,new {type="host",online=false});}}
   else {clients.TryRemove(id,out _);if(hosts.TryGetValue(side,out var remaining))await Send(remaining,new {type="subscribers",count=clients.Values.Count(p=>p.Side==side)});}
   socket.Abort();
  }
 });
 _ = Task.Run(async()=>{while(!app.Lifetime.ApplicationStopping.IsCancellationRequested){await Task.Delay(10000);foreach(var h in hosts.Values.Concat(clients.Values)){if(DateTime.UtcNow-h.LastSeen>TimeSpan.FromSeconds(35))h.Socket.Abort();else await Send(h,new {type="ping",now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()});}}});
 app.Lifetime.ApplicationStarted.Register(()=>File.AppendAllText(Path.Combine(root,"bridge.log"),$"{DateTimeOffset.Now:o} Listening on {cfg.BindAddress}:{cfg.Port}\n"));
 // Monitor manual/installer-started instances too: they may already own the mutex
 // when exe.xml attempts to start its --sim-start copy.
 app.Lifetime.ApplicationStopping.Register(()=>{foreach(var peer in hosts.Values.Concat(clients.Values))peer.Socket.Abort();});
 _ = Task.Run(async()=>{
  var session=new SimulatorSession(args.Contains("--sim-start"));var elapsed=Stopwatch.StartNew();
  var stop=app.Lifetime.ApplicationStopping;
  try {
   while(!stop.IsCancellationRequested) {
    bool? running=null;
    try {var processes=Process.GetProcessesByName("FlightSimulator2024");try{running=processes.Length>0;}finally{foreach(var process in processes)process.Dispose();}} catch { /* Unknown is not proof of simulator exit. */ }
    if(session.ShouldStop(elapsed.Elapsed,running)) {
     try{File.AppendAllText(Path.Combine(root,"bridge.log"),$"{DateTimeOffset.Now:o} Simulator session ended; stopping bridge.\n");}catch{}
     app.Lifetime.StopApplication();break;
    }
    await Task.Delay(2000,stop);
   }
  } catch(OperationCanceledException) when(stop.IsCancellationRequested) {}
 });
 await app.RunAsync();
}
static async Task<string?> Receive(WebSocket ws,CancellationToken token){using var ms=new MemoryStream();var bytes=new byte[65536];while(true){var r=await ws.ReceiveAsync(bytes,token);if(r.MessageType==WebSocketMessageType.Close)return null;if(r.MessageType!=WebSocketMessageType.Text||ms.Length+r.Count>8*1024*1024)throw new JsonException("Message too large");ms.Write(bytes,0,r.Count);if(r.EndOfMessage)return Encoding.UTF8.GetString(ms.ToArray());}}
static void SynchronizeHostConfig(Config cfg) {
 var relative="html_ui/Pages/VCockpit/Instruments/PMDGTablet/lan-bridge/lan-bridge-config.js";
 var file=Path.Combine(cfg.PackagePath,relative);
 if(!File.Exists(file))throw new Exception("Install the bridge-enabled EFB package before starting the bridge.");
 var script="window.EFB_LAN_CONFIG = "+JsonSerializer.Serialize(new {enabled=true,port=cfg.Port,hostKey=cfg.HostKey})+";";
 if(File.ReadAllText(file)==script)return;
 // Write only the installed bridge's configuration, never PMDG business code.
 var layoutPath=Path.Combine(cfg.PackagePath,"layout.json");
 var layout=JsonNode.Parse(File.ReadAllText(layoutPath)) ?? throw new Exception("Invalid layout.json");
 var entry=layout["content"]?.AsArray().FirstOrDefault(n=>n?["path"]?.GetValue<string>()==relative) ?? throw new Exception("Bridge entry missing in layout.json");
 File.WriteAllText(file,script,new UTF8Encoding(false));
 var info=new FileInfo(file);entry["size"]=info.Length;entry["date"]=info.LastWriteTimeUtc.ToFileTimeUtc();
 File.WriteAllText(layoutPath,layout.ToJsonString(new JsonSerializerOptions{WriteIndented=true}),new UTF8Encoding(false));
}
record PairRequest(string Key);
class Config {public int Port{get;set;}=8385;public string BindAddress{get;set;}="0.0.0.0";public string PackagePath{get;set;}="";public string PairingKey{get;set;}="";public string HostKey{get;set;}="";public int GsxPort{get;set;}=8744;public int BatcPort{get;set;}=41716;}
class Peer(WebSocket socket,string side){public WebSocket Socket=socket;public string Side=side;public string? Epoch;public NativeResources Resources=new();public DateTime LastSeen=DateTime.UtcNow;readonly SemaphoreSlim gate=new(1);DateTime interval=DateTime.UtcNow;int count;public bool AllowAction(){if(DateTime.UtcNow-interval>TimeSpan.FromSeconds(1)){interval=DateTime.UtcNow;count=0;}return ++count<=100;}public async Task Send(string text){await gate.WaitAsync();try{using var timeout=new CancellationTokenSource(5000);await Socket.SendAsync(Encoding.UTF8.GetBytes(text),WebSocketMessageType.Text,true,timeout.Token);}finally{gate.Release();}}}
