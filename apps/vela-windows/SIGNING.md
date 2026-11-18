# Windows release signing

Builds are unsigned unless `-CertificateProfileName` is supplied. Once identity
validation and a certificate profile are ready in the `velasigning` account
(resource group `vela-signing`, endpoint `https://eus.codesigning.azure.net/`):

1. Install Windows SDK SignTool and Microsoft's Trusted Signing client dlib
   (`Microsoft.Trusted.Signing.Client`, now also named `Microsoft.ArtifactSigning.Client`).
   Use the x64 SignTool and x64 `Azure.CodeSigning.Dlib.dll`; install its required
   .NET runtime. Authenticate with `az login` using an identity granted the
   signing role on the certificate profile.
2. Run:

```powershell
./build.ps1 -Version 0.2.16 -Ui C:\release\ui `
  -CertificateProfileName '<profile name>' `
  -SignTool 'C:\path\to\x64\signtool.exe' `
  -SigningDlib 'C:\path\to\x64\Azure.CodeSigning.Dlib.dll'
```

`VELA_SIGNING_DLIB` can supply the dlib path. The script creates `metadata.json`
in `obj/package` with Endpoint, CodeSigningAccountName and CertificateProfileName.
It signs and verifies Vela.exe before Inno packages it, then signs and verifies
the installer, using SHA-256 and Microsoft's timestamp service. Authentication,
signing and verification failures fail the build.
