# GalaxyQuest WordPress deployment plugin

The Deployment Status plugin has its own version and release channel. A plugin
update changes only the WordPress plugin, never the game webroot, database,
Plesk configuration or staging/production release.

## Installation and updates

Requirements: WordPress 6.5+, PHP 8.2+, PHP `ext-zip`, writable WordPress plugin
directories and outbound HTTPS to GitHub and its release download CDN.

Install the `gq-deployment-status-X.Y.Z.zip` **release asset** through
**Plugins > Add New > Upload Plugin**, then activate it. Do not use GitHub's
automatically generated source-code ZIP. The installed entrypoint must be:

```text
wp-content/plugins/gq-deployment-status/gq-deployment-status.php
```

For the first migration from the old flat-file plugin, deactivate it, remove
only `wp-content/plugins/gq-deployment-status.php`, then upload and activate
the release ZIP. Preserve `wp-config.php` settings. Never leave both copies
active: they define the same functions. In local development, removing a hard
link removes that link, not the repository source.

The active plugin integrates with the native WordPress Plugins and Updates
screens using its `Update URI`. It looks only for **published, non-prerelease**
tags `gq-deployment-status-vX.Y.Z`; game tags `vX.Y.Z`, drafts and prereleases are
ignored. It chooses the highest plugin SemVer across a bounded paginated release
list, not GitHub's mixed-repository `/releases/latest`.

The plugin does not opt into automatic installation. WordPress administrators
control the normal auto-update setting; WordPress handles capabilities, nonces,
filesystem access and installation. Flat-file, symlink and hardlink development
installs cannot self-update. Keep the existing local hardlink during development,
and use an independent ZIP installation when testing the real upgrade lifecycle.

The update check caches valid results for one hour and errors for five minutes.
**GalaxyQuest Deployment > Refresh status** clears its release cache; the
plugin section links to WordPress's normal update check. API errors are visible
as admin notices and in the plugin panel.

At installation time the plugin re-fetches the exact published release metadata
over verified TLS. It requires a unique canonical ZIP asset with a GitHub
`sha256:` digest, checks the streamed file's size and digest, and validates ZIP
paths, entry types, expanded size, plugin entrypoint and version before handing
the temporary file to WordPress. Failed downloads are deleted. Downgrades,
changed package URLs and draft/prerelease packages are rejected.

The existing optional `GQ_DEPLOY_STATUS_GITHUB_TOKEN` configuration is used only
for API calls and never forwarded to release download redirects. Downloads
currently require **public release assets**. Checksums provide integrity tied
to the trusted GitHub release/API, not independent publisher signatures.

The initial ZIP upload is a manual trust/bootstrap step; verify its published
SHA-256 before uploading. The old 0.1.0 plugin cannot discover this first update.
Recovery from a defective plugin update is an administrator restore/reinstall
of a known-good ZIP or hosting backup, not the game's deployment rollback.

## Independent release strategy

Use the dedicated `release/wordpress-plugin` branch for plugin-only snapshots
or a reviewed commit already contained in `main`. Do not include unrelated
game worktree changes. Bump both the plugin header and
`GQ_DEPLOYMENT_STATUS_PLUGIN_VERSION`, then create an immutable tag:

```text
gq-deployment-status-v0.2.0
```

The `WordPress Deployment Plugin Release` workflow validates tag/version/source
ancestry, runs the standalone updater and package tests, and prepares:

```text
gq-deployment-status-0.2.0.zip
gq-deployment-status-0.2.0.sha256
gq-deployment-status-0.2.0.release.json
```

The ZIP contains only the plugin directory and PHP entrypoint, with deterministic
entry metadata. The manifest binds version, tag, commit, ZIP digest and size.
Game `VERSION.txt` and native game packages are not inputs.

A separate write-enabled job uses the `wordpress-plugin-release` GitHub
environment, rechecks the remote tag and assets, uploads a draft, verifies
GitHub's asset digest, then publishes it with **`latest=false`** to avoid
changing the game release channel. Configure environment reviewers and
branch/tag rules separately if required; the workflow does not create those
protection rules. Prerelease flags may be used for manual candidate review,
but the stable updater intentionally ignores them.

Repeated runs accept only an already published release with identical assets,
notes and ZIP digest. Published releases and assets are never replaced. A
partial draft after an upload/publication failure requires operator inspection;
the workflow will not silently complete or overwrite it.

Plugin releases do not approve any game candidate, invoke Plesk Git, install the
game or change its migration/backup/activation gates.
