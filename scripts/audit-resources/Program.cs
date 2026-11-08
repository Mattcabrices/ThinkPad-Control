using System.Collections;
using System.IO.Compression;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Resources;
using System.Security.Cryptography;
using System.Text.Json;

// Parse resource bytes only. Never load or execute the audited hardware assembly.
var hashes=new List<object>();
void Record(string name,byte[] bytes)
{
    if(bytes.Length>=2&&bytes[0]==0x1F&&bytes[1]==0x8B) {
        using var gzip=new GZipStream(new MemoryStream(bytes),CompressionMode.Decompress);
        using var output=new MemoryStream();gzip.CopyTo(output);bytes=output.ToArray();
    }
    hashes.Add(new{name,sha256=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),length=bytes.Length});
}
using var input=File.OpenRead(args[0]);using var pe=new PEReader(input);
var metadata=pe.GetMetadataReader();var resourceRva=pe.PEHeaders.CorHeader!.ResourcesDirectory.RelativeVirtualAddress;
foreach(var handle in metadata.ManifestResources) {
    var resource=metadata.GetManifestResource(handle);if(!resource.Implementation.IsNil)continue;
    var name=metadata.GetString(resource.Name);
    var reader=pe.GetSectionData(resourceRva).GetReader((int)resource.Offset,pe.PEHeaders.CorHeader.ResourcesDirectory.Size-(int)resource.Offset);
    var data=reader.ReadBytes(reader.ReadInt32());
    if(!name.EndsWith(".resources",StringComparison.OrdinalIgnoreCase)) { if(name.EndsWith(".bin")||name.EndsWith(".gz"))Record(name,data);continue; }
    using var resources=new ResourceReader(new MemoryStream(data));var enumerator=resources.GetEnumerator();
    while(enumerator.MoveNext()) {
        var key=(string)enumerator.Key;
        resources.GetResourceData(key,out var type,out var raw);
        if(type=="ResourceTypeCode.ByteArray")Record(key,raw.AsSpan(4,BitConverter.ToInt32(raw,0)).ToArray());
    }
}
Console.WriteLine(JsonSerializer.Serialize(hashes));
