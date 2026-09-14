namespace ScannerAgent;

internal static class BarcodePolicy
{
    public static string Normalize(string value) => string.Concat(value.Where(c => !char.IsWhiteSpace(c))).Trim().Replace('p', 'P');
    public static string Type(string value)
    {
        if (value.Length is >= 8 and <= 512 && value.All(c => c is >= '0' and <= '9')) return "numeric";
        if (value.Length is >= 9 and <= 512 && value[0] == 'P' && value.AsSpan(1).ToArray().All(c => c is >= '0' and <= '9')) return "yandex";
        return "invalid";
    }
}
