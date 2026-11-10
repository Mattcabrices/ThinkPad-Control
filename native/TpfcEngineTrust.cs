using Microsoft.Win32;
using System.Security.Cryptography;
using System.Reflection;

internal static class TpfcEngineTrust
{
    // Signed builds embed the exact post-signing engine hash through MSBuild.
    // The source/download lock continues to identify the unmodified upstream asset.
    internal static string ReviewedEngineSha256 => typeof(TpfcEngineTrust).Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>().SingleOrDefault(a=>a.Key=="TpfcEngineSha256")?.Value
        ?? "8930720F8BBD1E4CC72670D24237C50F3FFB7E51E87B4DBFEF9A85FFE88ACCC3";
    internal static bool ImageMatches(string? imagePath,string engine) =>
        string.Equals(imagePath,"\""+engine+"\" -s",StringComparison.OrdinalIgnoreCase);

    public static void EnsureTrustedService()
    {
        var root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ThinkPad Control");
        var engine=Path.Combine(root,"engine","TPFanControl.exe");
        using var registry=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,RegistryView.Registry64);
        using var service=registry.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\TPFanControl");
        if(!ImageMatches(service?.GetValue("ImagePath") as string,engine))
            throw new InvalidOperationException("The bundled TPFanCtrl2 service is not installed. Existing external engines are not automatically trusted. Run setup's hardware-support task.");
        foreach(var item in new[]{
            (engine,ReviewedEngineSha256),
            (Path.Combine(root,"engine","LpcACPIEC.bin"),"C38FD116E7AFF4D1FDB0A494E296BE0A6708E5A22FC72F14587442FB7F8F7906")})
        {
            using var file=File.OpenRead(item.Item1);
            if(!string.Equals(Convert.ToHexString(SHA256.HashData(file)),item.Item2,StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The installed TPFanCtrl2 engine/module does not match the reviewed release.");
        }
    }
}
