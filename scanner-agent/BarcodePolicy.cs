namespace ScannerAgent;
internal static class BarcodePolicy
{
    private static readonly char[] Separators = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff".ToCharArray();
    public static string Normalize(string value) { var s = value.Trim(Separators); return s.StartsWith('p') && s.AsSpan(1).ToArray().All(c => c is >= '0' and <= '9') ? "P" + s[1..] : s; }
    public static string Type(string value) {
        if (value.Length is >= 8 and <= 512 && value.All(c => c is >= '0' and <= '9')) return "numeric";
        if (value.Length is >= 9 and <= 512 && value[0] == 'P' && value.AsSpan(1).ToArray().All(c => c is >= '0' and <= '9')) return "yandex";
        return "invalid";
    }
}
