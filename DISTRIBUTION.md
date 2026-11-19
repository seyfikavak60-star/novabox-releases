# NovaBox official APK distribution

This repository distributes official external NovaBox R8 APKs only. Application source, signing keys, passwords, customer data, debug APKs and Google Play AABs must not be uploaded here.

## Automatic release updates

1. Create a new stable release from main with a NEW tag such as `v1.06-738` (versionName-versionCode). The APK must have that exact version and a higher versionCode than the current feed.
2. Attach exactly one official universal signed R8 APK, then select Publish release. The normal desktop filename is accepted; the workflow corrects it to `novabox-CODE-VERSION.apk` after verification.
3. Check the Actions run named **Publish verified NovaBox update**. A successful run verifies the public download size/SHA-256, official upgrade certificate, com.novabox.tv package, non-debug status, Android minimum, all four ABIs and 16 KB ZIP alignment. Only then may it update `member/latest.json` and enable the mandatory external update.
4. Do not edit latest.json manually during a normal release. If verification fails, investigate the failed Actions step; do not bypass the checks. Older releases and same-version binary replacements cannot overwrite the current feed. A deliberately paused same-version feed requires manual review.

Do not replace/delete an existing published APK as an ordinary update. Publish a new versionCode instead. Use a canonical lowercase filename before publishing if immutable releases are enabled, because such releases may forbid renaming an asset afterward.

The workflow uses only the short-lived built-in GITHUB_TOKEN with repository contents permission; no signing key or new permanent token is needed. The APK is verified, never executed or installed by the workflow. This is artifact validation, not device, playback or visual acceptance.

Existing external APKs must already support the GitHub update feed. Older versions without that updater need one manual upgrade. Android's system installer still requires user approval, and the package/certificate must match the installed app. Play Store publishing and Play updates remain separate; this repository does not bypass Play App Signing or billing/licensing checks.

For a controlled retry, use Actions -> Publish verified NovaBox update -> Run workflow and enter the published tag. Re-running the already-current verified release is a no-op and does not undo a deliberate pause.
