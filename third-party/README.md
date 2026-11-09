# Bundled fan engine

ThinkPad Control's original code is MIT. This does not relicense upstream code.

We bundle a rebuild of mews-se/TPFanCtrl2 2.5.1 with the documented single-fan selector patch under
the Unlicense. Thanks to **troubadix**, the original TPFanControl author, and
**ThinkPad-Forum, byrnes, Shuzhengz, FanDjango and mews-se** for maintaining and
extending this work. Thanks to **namazso** for PawnIO and its signed EC module,
and the **LibreHardwareMonitor contributors** for sensor access.

`dependencies.lock.json` pins every bundled engine asset and matching source
archive. Run `scripts/fetch-dependencies.ps1` to download and verify them; no
downloaded code is executed by that script. Packages retain upstream licenses
and include the complete PawnIO.Modules source archive matching the unmodified
LGPL-2.1 LpcACPIEC module. The upstream archives contain their own licenses.
You may replace/rebuild the module in accordance with its license; the standard
package verifies the upstream bytes before installing privileged hardware support.
Modified modules must satisfy the driver's signing requirements. Our MIT license
does not override LGPL rights.

Reviewed release files also pin a `releaseAssetId`. If the normal GitHub release
route exhausts its three transport attempts, source builds may use the official
API for that same repository and pinned asset ID, with at most three attempts.
No credentials are sent. The original SHA256 remains mandatory before bytes
enter the verified cache. Wrong hashes, invalid fallback metadata and permanent
HTTP errors fail closed; fallback never selects a newer or different binary.
The same import-only downloader is packaged for hardware setup. When PawnIO is
missing, setup downloads its pinned installer through these reviewed routes,
then verifies both SHA256 and Windows signature trust before its single launch.
Temporary installer bytes stay in an administrator/SYSTEM-only directory beneath
the protected installation and are removed afterward. Network retries do not
retry installer execution, suppress restart-required results or weaken trust.

The PawnIO driver installer is **not redistributed**. Hardware setup
downloads the official signed 2.2.0 installer, verifies its pinned SHA256 and
Authenticode signature, and runs it only when no PawnIO service exists. Its
source and license are available at https://github.com/namazso/PawnIO and the
official distribution at https://pawnio.eu/.

TPFanCtrl2: https://github.com/mews-se/TPFanCtrl2/tree/878c8c0a751b4cce126d3b3b59dacf6268314239

Module source: https://github.com/namazso/PawnIO.Modules/tree/c683032770575d7705d1149f9d7fa7fd381766fc

The modified engine is built by scripts/build-fan-engine.ps1 from the pinned upstream archive. Original and modified sources, the patch description and fan-engine-build.lock.json ship with each package. Native workers embed the hash of the exact compiled (or subsequently signed) engine. The PawnIO kernel driver and signed EC module are unmodified.

