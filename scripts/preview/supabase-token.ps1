# Dot-source this (". ./scripts/preview/supabase-token.ps1") to put the Supabase CLI's own
# access token into THIS process's environment as SUPABASE_ACCESS_TOKEN, for the Management
# API calls in copy-crm.mjs. The token is read from Windows Credential Manager, where
# `npx supabase login` keeps it (target "Supabase CLI:supabase"); it is never printed and
# never written to a file, and it disappears with the process.
#
# Why not `npx supabase db query --linked`: before every query that command POSTs
# /v1/projects/<ref>/cli/login-role, which creates or refreshes a temporary login role in
# the target database. Against Vega Vista's own project that would be a write. The
# Management API's /database/query/read-only endpoint needs only this token and runs the
# statement as a read-only role.

if (-not ("VvPreview.Cred" -as [type])) {
  Add-Type -Namespace VvPreview -Name Cred -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
private static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
[DllImport("advapi32.dll")]
private static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
private struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
  public int Persist; public int AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}
public static string Read(string target) {
  IntPtr p;
  if (!CredRead(target, 1, 0, out p)) return null;
  try {
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    byte[] b = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);
    return System.Text.Encoding.UTF8.GetString(b);
  } finally { CredFree(p); }
}
'@
}

$token = [VvPreview.Cred]::Read("Supabase CLI:supabase")
if ($token -and $token.StartsWith("go-keyring-base64:")) {
  $token = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($token.Substring(18)))
}
if (-not $token -or -not $token.StartsWith("sbp_")) {
  throw "No Supabase CLI token in Credential Manager. Run: npx supabase login"
}
$env:SUPABASE_ACCESS_TOKEN = $token
Remove-Variable token
