using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// Session-scoped images read by the native EFB. No remote URL fetch or credentials.
sealed class NativeResources {
    const int MaxBytes=128*1024*1024, MaxEncoded=16*1024*1024;
    readonly object gate=new();
    readonly Dictionary<string,Resource> ready=new();
    readonly Dictionary<string,Upload> pending=new();
    readonly Dictionary<string,Failure> failures=new();
    public record Failure(string Id,string Kind,string Reason,int Status,string Mime,DateTime Updated);
    int bytes;
    public record Resource(byte[] Data,string Mime);
    sealed class Upload(string mime,int count) {public string Mime=mime;public int Count=count,Next;public StringBuilder Text=new();}
    static string Key(string epoch,string id) {
        if(!Regex.IsMatch(epoch,@"\A[a-zA-Z0-9-]{1,80}\z")||!Regex.IsMatch(id,@"\A[0-9]{1,12}\z"))throw new JsonException("Invalid resource id");
        return epoch+"/"+id;
    }
    public bool Add(JsonElement message) {
        var key=Key(message.GetProperty("epoch").GetString()!,message.GetProperty("id").GetString()!);
        var part=message.GetProperty("part").GetInt32();var count=message.GetProperty("count").GetInt32();
        var data=message.GetProperty("data").GetString()!;var mime=message.GetProperty("mime").GetString()!;
        if(count is <1 or >128 || part<0 || part>=count || data.Length>131072 || mime is not ("image/png" or "image/jpeg" or "image/gif" or "image/webp" or "image/svg+xml"))throw new JsonException("Invalid image upload");
        lock(gate) {
            if(part==0){if(pending.Count>=4&&!pending.ContainsKey(key))throw new JsonException("Too many image uploads");pending[key]=new(mime,count);}
            if(!pending.TryGetValue(key,out var upload)||upload.Next!=part||upload.Count!=count||upload.Mime!=mime)throw new JsonException("Image chunk out of order");
            if(upload.Text.Length+data.Length>MaxEncoded){pending.Remove(key);throw new JsonException("Image too large");}
            upload.Text.Append(data);upload.Next++;
            if(upload.Next!=count)return false;
            pending.Remove(key);
            byte[] decoded;try{decoded=Convert.FromBase64String(upload.Text.ToString());}catch(FormatException){throw new JsonException("Invalid image data");}
            var oldSize=ready.TryGetValue(key,out var old)?old.Data.Length:0;
            if(bytes-oldSize+decoded.Length>MaxBytes || (ready.Count>=512&&old==null))throw new JsonException("Image cache full");
            ready[key]=new(decoded,mime);failures.Remove(message.GetProperty("id").GetString()!);bytes+=decoded.Length-oldSize;return true;
        }
    }
    public Resource? Get(string epoch,string id){lock(gate){return ready.GetValueOrDefault(Key(epoch,id));}}
    public void Fail(JsonElement m) {
        string Short(string name,int max){var value=m.GetProperty(name).GetString()??"";return value[..Math.Min(max,value.Length)];}
        var id=Short("id",12);var item=new Failure(id,Short("kind",24),Short("reason",40),m.GetProperty("status").GetInt32(),Short("mime",80),DateTime.UtcNow);
        lock(gate){if(failures.Count>=64&&!failures.ContainsKey(id))failures.Remove(failures.Keys.First());failures[id]=item;}
    }
    public object Diagnostics(){lock(gate){return new{images=ready.Count,bytes,pending=pending.Count,failures=failures.Values.ToArray()};}}
    public void Drop(string epoch,string id){lock(gate){var key=Key(epoch,id);pending.Remove(key);if(ready.Remove(key,out var item))bytes-=item.Data.Length;}}
}
