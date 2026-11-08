# Signing the public release

Current release plan: prepare a publicly signed release using Microsoft Artifact Signing. The local signing integration is ready, but the existing artifacts remain unsigned until the publisher completes Azure account setup and identity validation and a signed build passes verification. See COMPATIBILITY.md for the public hardware-validation summary.

Open source and code signing are independent. Our code remains MIT, and users
receive the same bundled fan engine regardless of which signing provider we use.
Only the publisher needs a signing account. Users do not need Azure accounts.

## Provider choice and cost

Microsoft Artifact Signing Basic is USD 9.99/month with 5,000 signatures; extra
signatures are USD 0.005 each. Taxes/currency conversion can apply. Billing starts
when the signing account is created and is not prorated. A paid Azure subscription,
supported country/region and successful identity validation are prerequisites.
Check the official pricing and eligibility pages before provisioning anything.
The validated legal name is used in the certificate's publisher identity.

For an occasional release, finish validation before creating the paid signing
resource. Sign and timestamp the release during a paid month, then delete the
Artifact Signing account to stop using the service. Microsoft says account
deletion does not affect certificates already used to sign files. A later build
needs new signatures and another active signing account; identity validation and
setup may be needed again. Do not revoke certificates just to stop billing.
An approval delay crossing billing periods can cost more than one month's fee.

SignPath Foundation has a free approved-OSS route, but its own-binaries-only rule
prevents simply applying its certificate to our downloaded TPFanCtrl2 binary.
Bundling an unsigned engine in a signed installer does not resolve a policy block
when Windows later starts that engine. Upstream signing or a qualifying maintained
fork would need separate approval. No upstream author has been contacted.

## What is implemented

1. `scripts/get-signing-tools.ps1` restores versioned official Microsoft tools
   through NuGet, retains content hashes in its lock file, and checks their
   Microsoft Authenticode signatures. Tools remain inside the workspace.
2. `scripts/sign-file.ps1` supports Artifact Signing or an explicit trusted
   code-signing certificate in the Windows certificate store. No PFX/password
   arguments or certificate/root installation are used. Existing trusted vendor
   signatures are preserved. New signatures require SHA256, RFC3161 timestamps
   and successful Authenticode verification.
3. `build-desktop.ps1 -SigningConfig <path>` verifies the original upstream engine,
   signs a separate copy, and embeds that copy's final hash in the native worker
   through assembly metadata. The upstream download lock remains unchanged.
   Installed engine hashes are recorded separately in installed-artifacts.json.
4. The package signer signs Windows EXE/DLL files and PowerShell scripts. Non-PE
   native files are preserved. PawnIO's already-signed module is never changed.
5. Inno Setup invokes the same signing callback for setup, uninstaller and its
   temporary executable copies. Signed builds fail rather than silently emit an
   unsigned installer. The package manifest is generated after payload signing.
6. `verify-release.ps1 -RequireTrustedSignatures -InstallerPath <path>` checks
   file hashes, unmanifested files, all shipped PE/script signatures and timestamps,
   and the installer signature. Verify the actual downloaded artifacts on a clean
   target machine as well; this does not guarantee every Windows policy's approval.

The integration is implemented and locally preflight-tested. No certificate or
Azure signing profile is currently provisioned. No signing request has been sent;
the paid cloud-signing and signed-installer paths are not end-to-end validated.
Neither a self-signed certificate nor a .NET strong name substitutes for public
Authenticode trust. Code signing does not guarantee immediate SmartScreen reputation.

## Set up Microsoft Artifact Signing

The owner completes Azure paid subscription setup, identity verification, a
**Public Trust** profile, and the Certificate Profile Signer role assignment in
their own account. Do not send identity documents, passwords, tokens or private
keys through this chat or commit them to the repository. Individual availability
is currently limited to the US and Canada; check current eligibility first.

Run `scripts/get-signing-tools.ps1`. Copy the example configuration and metadata
from `signing/` into `.tools/signing/`, fill in the paths from tools.json, and set
the actual regional endpoint, signing account and Public Trust profile names.
Examples use Azure CLI authentication and exclude other credential providers.
Install/sign in with the official Azure CLI when an account is ready. The signing
client also requires .NET 8 and the Visual C++ x64 redistributable. The local SDK
runtime is selected when present; the native C++ prerequisite needs verification.

```powershell
./scripts/sign-file.ps1 -Config ./.tools/signing/release.local.json -CheckOnly
# CheckOnly validates local tools/configuration, not cloud credentials or billing.
./scripts/build-desktop.ps1 -SigningConfig ./.tools/signing/release.local.json
./scripts/package-source.ps1
```

Do not run the signed-build command with dummy account metadata. Actual signing needs
explicitly configured, authorized credentials. Keep the original unsigned upstream
hash and resulting signed engine hash for provenance. Generate release checksums
after signing and packaging. The runtime engine pin is baked into each worker;
it does not accept arbitrary replacement engines based only on a writable hash file.

## References (checked November 5, 2026)

- https://learn.microsoft.com/azure/artifact-signing/how-to-change-sku
- https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
- https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations
- https://signpath.org/terms.html
- https://jrsoftware.org/ishelp/topic_setup_signtool.htm
- https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation


