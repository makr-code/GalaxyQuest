# GalaxyQuest: server-initiated GitHub -> Plesk deployment

## Status and scope

**Blocked and obsolete:** the instructions below describe the previous
containerized Apache/MySQL architecture, not the requested native Plesk
Apache/PHP and database architecture. Do not follow them for a new installation.
The superseded `develop` deployment workflow and all legacy stack commands,
including `preflight`, `bootstrap`, `deploy`, `backup`, `verify` and
`rollback`, are blocked in the current `develop` source until a native
deployment has been implemented and verified.
Already transferred bundles and previously published workflows are not affected
by these local changes and must not be used. No application installation has
been performed. A verified SSH host key and valid Plesk API TLS certificate are
required for remote access. No local or remote player database is copied.

### Native Plesk preparation (not yet deployable)

The intended delivery model is **server-side pull**, not a GitHub Actions SSH
push. CI tests source and produces release candidates; a restricted server-side
process will retrieve a specifically approved, immutable artifact and image
digests from GitHub. It must not run `git pull` inside the live document root.
Use separate staging and production state, make production approval explicit,
and verify artifact provenance and checksums, backups, migrations, activation,
health and recovery before enabling any scheduled updates. The current Actions
artifact is a non-deployable candidate with limited retention, not a release
distribution or approval mechanism. Local CI/artifact inspection, authenticated
candidate download and private quarantine extraction are implemented as
operator-run helpers, but have not been run on Plesk. CI also smoke-tests the
exact candidate through a disposable PHP 8.4 FPM/Apache fixture. Versioned native
GitHub Release drafts are implemented in source, but have not been accepted in
a remote workflow run. Deployment approval, scheduling and live activation are
not implemented.

Docker is used for the frontend's **CI build and disposable acceptance fixtures**,
not for serving the game on Plesk. The native package already contains the built
Vite `dist/` plus the selected PHP/runtime files. Plesk serves these through its
native Apache/PHP-FPM stack; Docker on the host is intended for services such as
TRELLIS and ComfyUI. A Plesk Git pull retrieves source, not `dist/` or Actions
artifacts, so it cannot replace the package download and installation steps.

The candidate HTTP acceptance also rehearses a release-directory layout inside
a disposable Docker volume: `releases/previous`, `releases/candidate`, a `current`
symlink and a separate `shared/wordpress` directory. Apache and PHP-FPM receive
read-only mounts; a separate, network-isolated fixture process replaces `current`
using a same-directory symlink rename. It verifies the previous page, candidate
page/assets, rollback after the expected database-readiness failure, repeated
PHP responses after switches and unchanged shared WordPress routes. It does not
test database migration/recovery or approve either fixture as a live release.

The fixture explicitly sets PHP `realpath_cache_size=0`,
`opcache.validate_timestamps=1`, `opcache.revalidate_freq=0` and
`opcache.revalidate_path=1`. Without correct cache handling, swapping a symlink
can continue serving the previous PHP release. These settings are fixture
conditions, not changes to Plesk: verify the actual host's Apache symlink policy,
PHP-FPM/OPcache settings and behavior under load before adopting this layout.
The rehearsal deliberately uses an unready candidate and preserves its
`not-deployable` manifest. It is not a production activation command or proof
of zero-downtime switching.

On 2026-11-14, the current local working tree was exercised in disposable
fixtures. A MySQL-backed CI web image applied and verified 93 migrations and
completed a real test-user login without the previously observed `WMCore` boot
error. Two view-flow tests passed; the third was skipped because its zoom
orchestrator was not ready, and one passing flow used a navigation fallback.
Separately, the native database fixture passed on PHP 8.4.27 and MariaDB
11.8.6, including migration verification, schema isolation and a scoped
fixture backup/restore. These results are not GitHub CI evidence, a test of
the actual Plesk host or an approval to deploy. The working tree was not a
released immutable candidate, and the full view-flow and target-host
acceptance remain outstanding.

For versioned distribution, use protected version tags (for example `v1.2.0`)
and GitHub Releases containing the native package plus a commit/digest manifest.
The existing GitHub Release Publication workflow now reuses the native archive
from successful branch CI for that exact commit, without rebuilding Vite or
repacking the archive. Prerelease tags use staging/develop evidence; stable tags
use production/main evidence and require manual dispatch from `main`. Complete
branch CI before tagging: the latest same-commit branch run must pass all required
jobs and preserve its unexpired native candidate. Missing or unfinished evidence
fails closed rather than falling back to an older successful run.

The six exact-tag quality/security gates remain mandatory. After approval, the
publisher rechecks those gates and the pinned branch CI evidence. It creates
only a **draft** containing the byte-identical native tar archive, SHA-256
checksum and provenance manifest (tag, commit, image identity, source run/attempt
and Actions artifact digest). Both manifests remain `not-deployable`; neither
stable nor prerelease drafts are published or made latest. Matching draft
reruns are no-ops; published releases or differing assets/metadata are never
overwritten. Tag protection and environment review settings require separate
GitHub configuration and are not installed by this workflow.

Promote the exact package tested on staging without rebuilding it, and do not
move a released tag or replace its assets. A tag or draft does not authorize
deployment. The draft path still needs its first remote-run acceptance, and the
native installer, backups, migration gates and recovery runner remain absent.

The local candidate exports `setup.php` for CLI use, not as a web installer.
The source rejects non-CLI requests before loading dependencies, and the
repository Apache rules deny direct HTTP access. A standalone PHP web-server
test without Apache rewrites and an isolated Apache/WordPress routing fixture
cover both defenses; neither verifies the target Plesk configuration. Keep
database initialization and canonical migrations behind their separate
identity, backup and approval gates.

On 2026-11-12 the operator-provided Plesk Git extension was configured with
two separate public-HTTPS repositories under the production domain's Plesk Git
panel: `galaxyquest-develop.git` tracks `develop` and
`galaxyquest-release.git` tracks `main`. Both show **No deployment** after
reloading the panel. Plesk's **Pull now** fetches Git content independently;
it does not build the Vite frontend, verify CI acceptance, perform migrations,
or install the game. The two repository records do not constitute isolated
staging and production deployments. There is no `release` branch on GitHub as
of this inspection, so `main` is used as the current production-source branch,
not as evidence of an approved release. Do not select automatic or manual
deployment to the existing document root; Plesk defaults to automatic
deployment there when creating a repository. Keep deployment disabled until
the native release and WordPress safety gates are completed.

The operator subsequently created staging domain
`08846123-1de4-449b-a0cf-4fe8ec3b3da9.themisdb.org` in the same Plesk
subscription, with a separate document root named for that hostname and PHP
8.4.27. It shares the subscription's system user with the existing sites and
therefore is not an OS-user security boundary. At inspection the hostname did
not resolve externally, HTTPS was enabled but no certificate was selected,
and only `/plesk-stat` was password-protected. Do not deploy application data
until authoritative DNS, a valid certificate, an approved and tested staging
access model and separate database credentials are in place. An opaque
hostname is not access control and is not guaranteed to remain secret.
On 2026-11-12, direct A-record queries to two IONOS authoritative nameservers
and a public resolver initially returned NXDOMAIN. A later check on the same
date found all four IONOS authoritative nameservers returning A
`217.160.0.108` and AAAA `2001:8d8:100f:f000::200` for staging, both with
TTL 3600. These are not the Plesk server addresses. HTTP to the public A
record returned a different server's response, while an IPv4 request pinned
to `82.165.41.60` reached Plesk's HTTPS redirect. The pinned HTTPS connection
failed certificate-chain verification. Correct the staging hostname's A record
in the authoritative IONOS zone to `82.165.41.60` and remove its unrelated
AAAA record; add an IPv6 record only after independently verifying IPv6
reachability. Do not change unrelated domain records or the nameservers.
Recheck authoritative and public DNS after TTL expiry, then issue and verify
the staging certificate without disabling TLS verification. The Plesk
administrator browser session had expired at the later inspection.

After the operator replaced the IONOS Default Site DNS records, all four
authoritative servers returned only A `82.165.41.60` for staging on
2026-11-12. Google and Quad9 resolved the new address, but Cloudflare still
returned the previously cached IPv4 address at the later check; propagation
must still be verified. Subsequently the operator obtained and assigned a
Let's Encrypt certificate. A TLS-verified request pinned to `82.165.41.60`
succeeded for the staging hostname; Plesk reports expiry on 2027-02-10 and
automatic renewal enabled, not a proven future renewal. The root returned HTTP
200 without authentication. The last inspected protected directories list
contained only `/plesk-stat`. This was Plesk's default page, not an installed
GalaxyQuest instance, so it does not test GalaxyQuest's user management.
GalaxyQuest authentication may be used for staging without a second Plesk
password prompt, provided the actual deployed release is verified before
publishing test data: check unauthenticated and authenticated access to
intended public routes, private APIs, static/generated files and administrative
and operational endpoints; separately validate registration/account
provisioning and that staging credentials and data cannot reach production.
An application login does not itself protect every file or service. If these
checks do not establish the required access boundaries, use a separately
verified outer access control or keep staging offline. Do not assume a UUID
hostname or Plesk administrator login protects the website.

The application-only staging access model is not yet approved. A source
inspection on 2026-11-12 found that `api/faction_validation.php` permitted
anonymous diagnostic reads; a local anonymous request returned HTTP 200.
The local source now requires an administrator session: all three diagnostic
actions returned HTTP 401 without a session and POST returned 405 on the
local Apache stack. Unit tests exercise all three actions with simulated
anonymous, ordinary-user and administrator authorization; the change is not
yet published, and real-session acceptance testing remains outstanding.
The verification action also reports a warning instead of failing when no
standing values can be extracted from the YAML.
The local design endpoints now require a session instead of accepting
`X-Demo-User` or manufacturing demo identities. Writes require CSRF; the
legacy wireframe update/delete and vessel generation insert are scoped to
the owner's design in the database statement. Tests use actual auth/CSRF
guards with simulated sessions and an isolated SQLite schema; local anonymous
HTTP requests returned 401, including one with a forged demo header. These
changes are not published and do not establish end-to-end staging access.
The SQLite fixture models the legacy endpoint columns; it does not demonstrate
compatibility with the canonical schema. In particular, the separate
`migrate_trellis2_integration_v1.sql` defines different design and queue
columns and is not in the canonical migration manifest. Treat the design and
generation APIs as unverified, not operational, until the intended schema,
routing, worker lifecycle and real-session ownership behavior are reconciled
and tested on isolated MariaDB. These checks are not a complete access audit.
Before application-only staging access, verify all relevant endpoints and
files with anonymous, ordinary-user and administrator sessions. Otherwise keep
staging offline or use an independently verified outer access control.

Both Plesk repositories were verified as separate bare Git repositories, and
their configured origin was the expected public HTTPS GitHub URL. A manual
**Pull now** was invoked for each with deployment disabled; afterward their
selected branch tips matched GitHub's independently queried tips
(`develop` at `cd7fa7a90715af3ec088857d3858f40e8f7486e1` and `main` at
`e8b89955c5f9993f1e44a0abdb5a8e4bec69b390`). Both tips were already current
before the test, so this does not prove that a new commit is fetched or that
the other repository remains unchanged when a branch advances. The document
root still contained the existing default page and WordPress directory after
the pulls. This is a fetch-only smoke check, not a deployment or CI approval.

`bash deploy/inspect-plesk-git.sh staging|production ABSOLUTE_BARE_REPOSITORY
EXPECTED_COMMIT` is a local, read-only source diagnostic. It requires the exact
public HTTPS origin, selects `develop` for staging or `main` for production and
compares that bare repository's branch tip to an explicitly supplied full
commit ID. Its JSON output has `status: source-only`: it does not fetch, prove
GitHub provenance or CI acceptance, pin a ref against concurrent pulls, inspect
the other repository, approve a release or install anything. Run only from a
trusted copy and account with Git access; the Plesk chroot currently lacks Git.

`node deploy/inspect-github-ci.mjs staging|production FULL_COMMIT_SHA RUN_ID`
is a separate read-only CI diagnostic. It requires Node.js and the authenticated
GitHub CLI with access to the repository. It checks the exact GitHub repository,
push branch, commit and CI workflow, requires a successful completed run and all
eight currently required jobs (including image publication), requires the
named PHP 8.4 FPM/Apache candidate-acceptance and artifact-preservation steps to
have succeeded in that order, checks the attempt-specific complete job list,
requires the unique non-expired
`native-plesk-candidate-attempt-N` artifact for that run attempt, returns its
GitHub artifact ID and SHA-256 digest, and rereads the run to detect a retry.
This identifies the candidate and provides a digest to compare after a future
download; it does not download the archive or verify its contents. Its output
is `ci-candidate-evidence-only`: it does not fetch or compare the current branch
tip, prove that the historical workflow definition had the intended
protections, approve or install a release, or prevent the run being retried
after inspection. Use a trusted diagnostic copy and fail closed on missing
tools, network errors or mismatched evidence.

The optional WordPress admin plugin
`wordpress-integration/gq-deployment-status.php` displays separate Staging
(`develop`) and Production (`main`) comparisons for GitHub CI, a configured
Plesk bare-repository ref and a configured deployed-state JSON file. Configure
`GQ_DEPLOY_STATUS_STAGING_GIT_DIR`, `GQ_DEPLOY_STATUS_PRODUCTION_GIT_DIR`,
`GQ_DEPLOY_STATUS_STAGING_STATE_FILE` and
`GQ_DEPLOY_STATUS_PRODUCTION_STATE_FILE` in `wp-config.php` after confirming
the actual Plesk paths. The previous single-environment
`GQ_DEPLOY_STATUS_ENVIRONMENT`, `GQ_DEPLOY_STATUS_GIT_DIR` and
`GQ_DEPLOY_STATUS_STATE_FILE` settings remain supported for that one
environment.

The plugin can optionally trigger **Plesk Git FETCH** for either configured
repository. Configure `GQ_DEPLOY_STATUS_PLESK_API_URL` as the HTTPS
`https://<plesk-host>:8443/enterprise/control/agent.php` endpoint,
`GQ_DEPLOY_STATUS_PLESK_API_KEY`, and
`GQ_DEPLOY_STATUS_PLESK_STAGING_DOMAIN`,
`GQ_DEPLOY_STATUS_PLESK_STAGING_REPOSITORY`,
`GQ_DEPLOY_STATUS_PLESK_PRODUCTION_DOMAIN` and
`GQ_DEPLOY_STATUS_PLESK_PRODUCTION_REPOSITORY`. Keep the API key in
`wp-config.php` or another protected server-side configuration, never in the
WordPress database or plugin source. Use a Plesk account restricted to the
relevant subscription rather than an administrator key. The action is
administrator-only, nonce-protected and maps only to those fixed domains and
repository names. The plugin calls only the XML API `fetch` operation for
remote-hosting repositories; it does not call `deploy`, change Plesk settings,
or write application files. A successful fetch updates the Plesk Git mirror,
not the website.

The production promotion control remains disabled. The current CI package is
explicitly non-deployable, and a server-side atomic activation/backup/rollback
runner has not been implemented or verified. Do not use Plesk Git `deploy` as
a substitute: the current repositories are configured with **No deployment**,
and their source is not an approved production artifact. The plugin also does
not compare the actual webroot file tree. Its displayed artifact SHA-256
identifies the package only, not the integrity of files currently served. The
optional GitHub token needs repository contents and Actions read permission
and must be configured outside the WordPress database. This plugin remains a
status and fetch-control plane, not a release approval or deployment runner.

Plesk XML API references:

- [Managing Git repositories](https://docs.plesk.com/en-US/obsidian/api-rpc/about-xml-api/reference/managing-git-repositories.75959/)
- [Fetching the remote repository](https://docs.plesk.com/en-US/obsidian/api-rpc/about-xml-api/reference/managing-git-repositories/fetching-the-remote-repository.75998/)

After a successful check, the operator can pass its artifact ID, SHA-256 and
commit to `bash deploy/pull-native-candidate.sh ARTIFACT_ID sha256:DIGEST
FULL_COMMIT_SHA ABSOLUTE_PRIVATE_SPOOL` on the Plesk account. Supply `GH_TOKEN`
through the account's protected secret environment, using a fine-grained
credential scoped to Actions read; never put it in command arguments or shell
history. Keep the helper in an owner-only operations directory outside every
document root and transfer it through a separately trusted administrative
channel, not inside the application candidate. The helper requires `curl`,
`unzip`, `sha256sum`, `tar` and standard Bash/coreutils. It downloads only over
verified HTTPS, compares the ZIP digest, requires the single expected archive
entry, then reads only the inner manifest to confirm its commit, image-ID
shape and non-deployable status. The original ZIP is stored with mode 0600 in
an owner-only spool; application files are not extracted or activated. No live
or staging deployment is enabled by this step. `curl` and `tar` were present
in a prior limited Plesk chroot probe, but `unzip`, `sha256sum`, `stat` and
spool permissions are not yet verified; this helper has not been run on Plesk.

Before any transfer, run the read-only
`bash deploy/preflight-native-candidate-host.sh ABSOLUTE_PRIVATE_SPOOL
ABSOLUTE_PRIVATE_CANDIDATE_ROOT STAGING_DOCUMENT_ROOT PRODUCTION_DOCUMENT_ROOT`
from the trusted operations directory as the non-root Plesk subscription
account. Supply the actual existing document roots for every affected Plesk
domain. The preflight checks required commands and GNU tool options, account
ownership, write access, private modes, and canonical-path overlap with each
supplied document root; it creates no directories, downloads nothing, and
does not activate a release. Create the two private roots separately with
owner-only permissions before running it, and use only paths outside all
document roots. A passing result is host-tooling and path evidence only: it
does not verify that all document roots were supplied, PHP-FPM, Apache/nginx,
WordPress, TLS, databases or backup/recovery. The Plesk chroot's missing-tool
and path-permission checks remain pending until this diagnostic is run there.

#### Separate, read-only Plesk PHP CLI preflight

The shell preflight does not select or inspect PHP. From a trusted operations
copy **outside every document root**, explicitly invoke the intended Plesk PHP
CLI as the non-root subscription account, for example:

```sh
/opt/plesk/php/8.4/bin/php /ABSOLUTE_PRIVATE_OPERATIONS_COPY/deploy/preflight-native-php.php
```

Both paths are operator-verified examples/placeholders, not discovered host
settings. Use the actual installed binary and trusted script location; do not
silently substitute the default `php` on `PATH`. No wrapper accepts an executable
path, and the script accepts **no arguments** (including `--help`). Never expose
this diagnostic as a web endpoint or pass web-request paths to a PHP launcher.
Non-CLI execution is denied before argument inspection or application loading.

The diagnostic reads only the current process's version, SAPI and selected
loaded-extension names. It emits one JSON object and exits 0 only for CLI,
the tested **8.4.x** line and all required extensions; unexpected arguments,
other PHP lines (including newer ones) or missing extensions exit 1. This is
a tested-line gate, not a PHP security-patch assessment. The runtime baseline
is PDO plus `pdo_mysql`, `mysqli`, `curl`, `mbstring`, `gd`, `json`, `session`
and `hash`. The Dockerfile provides `pdo_mysql`, `mysqli`, `curl`, `mbstring`
and `gd`; application evidence includes `config/db.php` (PDO MySQL),
`api/comfyui_job_executor.php` (curl), `api/colonization.php` (mbstring),
`api/textures.php` (GD), `api/helpers.php` (sessions), and `api/totp.php`
(hash). `mysqli` is retained from the Docker baseline, also used by the
separate `wordpress-integration/gq-game-admin.php` tooling; it does not mean
WordPress is booted or verified. JSON is used throughout the API and by this
diagnostic itself. This is not a complete dependency audit of optional workers
or integrations.

No application/configuration is booted; no database, network, download,
migration, file write, activation, backup or rollback is attempted. The JSON
does not enumerate secrets, environment variables, configuration paths or
`phpinfo()` output. PHP's own startup warnings or operator-installed startup
hooks are outside the script's control: use a trusted binary/configuration
and do not publish raw process diagnostics without review.

**CLI success is not PHP-FPM success:** FPM can use a different binary,
configuration and extensions. The result explicitly remains `cli-only` and
`not-deployable`; it does not verify FPM/OPcache, Apache/nginx/Plesk routing,
WordPress isolation, database connectivity, backups/recovery or approve
deployment. Dockerfile OPcache installation is not treated as a CLI minimum
or evidence that FPM cache/symlink switching is safe. Run and validate those
separate host checks before any future promotion. No activation/backup/rollback
runner or deployment approval is introduced.

To unpack a verified ZIP into quarantine, run
`bash deploy/stage-native-candidate.sh ABSOLUTE_CANDIDATE_ZIP sha256:DIGEST
FULL_COMMIT_SHA ABSOLUTE_PRIVATE_CANDIDATE_ROOT`. The destination must already
be an account-owned directory with no group/other permissions and outside all
document roots. The helper rechecks the digest and manifest, rejects paths
outside the archive root and every non-regular/non-directory member, extracts
with ownership and archived permissions disabled, and leaves directories mode
0700 and files mode 0600. It does not activate or make the files web-accessible;
the candidate remains non-deployable until native Apache/PHP-FPM routing,
WordPress coexistence, asset permissions, database and recovery gates pass.
This extraction helper also has not been run on Plesk.

On 2026-11-12 the published failed run `43242313532` was rejected by the
live diagnostic. No successful current run was available for a live positive
test; positive and retry/error cases were tested with isolated fixtures.
The combined Docker/native contract run failed once locally with two workers
during package creation and left a test container. That identified test
container and its image were removed; the package tests and all 69 combined
contract tests then passed with one worker. The CI contract step now uses one
worker. The original failure's root cause was not established, so this is not
proof that concurrent packaging is reliable.

As verified on 2026-11-12, GitHub `develop` at
`fedb22cf752ef420ac406b519af5c2cd23f477b6` contains the CI definition without
Plesk deployment jobs and the fail-closed reusable workflow without SSH or SCP.
This only describes that published branch: it does not revoke already
transferred bundles, cancel earlier jobs, or prove that other published refs
and callers are safe. Keep the old deployment gate disabled.

Read-only server inspection on 2026-11-12 established the following baseline:

- The SSH ED25519 fingerprint presented at the host's public IPv4 address
  matched the host public key displayed in the Plesk administrator terminal.
  Pin and verify that exact key for each SSH client; this observation does not
  configure client trust or verify other host keys.
- Apache, MariaDB and PHP 8.4 FPM were active; nginx was inactive. Docker was
  initially absent, then installed by the operator. A subsequent read-only
  check found Docker active, client/server 29.9.3 and Compose v5.7.1; `docker
  ps` returned no running containers. Installation does not constitute
  acceptance of the sidecar or monitoring configuration.
- On 2026-11-13, an authenticated read-only inspection of Plesk's Docker
  extension showed an empty Containers page and an empty Stacks page. No
  containers or Plesk-managed stacks were listed at that time; this does not
  inspect images or other Docker environments.
- At inspection time no TCP listeners appeared on ports 5500, 5501, 8188 or
  8189. This is not a reservation or proof that a future bind will succeed;
  check again at deployment. `nvidia-smi` was unavailable, so GPU support is
  not established.
- The OS PHP CLI at `/usr/bin/php` reported 8.4.27; the tested CLI extensions
  included `pdo_mysql`, while `intl` was absent. CLI extension availability
  does not establish FPM configuration or application requirements.
- The production domain directory contained an `index.html` and a `wordpress`
  directory. WordPress entry, configuration and settings files existed, but
  there was no `.htaccess` in that directory at inspection time. No file
  contents were inspected or changed. Its actual routing and maintenance state
  must be checked before adding game rewrite rules or activating a release.
- A read-only chroot command using the website user's primary UID/GID found
  Bash, sh, curl and tar on its `PATH`; curl and tar ran. Git and PHP were not
  found on that path. This is not a full SSH login or a check of supplementary
  groups. Test required commands under the actual restricted login before
  choosing an SSH deployment mechanism; do not grant Docker or root
  privileges to compensate.

Earlier on the same date, the published GitHub reusable deployment workflow was
still active and the `develop` CI workflow still referenced it behind
`vars.PLESK_DEPLOY_ENABLED`. After confirming the repository variable was
absent, it was explicitly created as `false` and read back. This blocks the
published `develop` CI caller's variable-gated jobs; it does not disable the
reusable workflow on other refs, prevent other callers or cancel in-flight
jobs. The variable was rechecked as `false` after the updated `develop` source
was published. Do not enable the legacy gate or assume the updated branch
alone protects other refs and callers.

The earlier published `develop` CI run 43167160243 failed multiple gates, including a
duplicate `X-Content-Type-Options` header in the container health smoke test.
The local Apache configuration now removes the application's copy from Apache's
normal response-header table before setting the baseline in its always table;
this was locally tested. The newer published `develop` CI run 43242313532 for
`fedb22cf752ef420ac406b519af5c2cd23f477b6` failed: the Docker context test
expected an outdated fixture count, and the total JavaScript gzip bundle
exceeded its 800 KiB limit. It is not an accepted deployment candidate.
The fixture-count expectation was corrected locally and all three context
tests passed against a real Docker daemon; this correction is not yet
published. On 2026-11-12, a fresh local production build still measured
830,853 gzip bytes against the unchanged 819,200-byte total limit. An
experimental broad chunk regrouping was discarded: although it reduced the
measured total to 819,159 bytes, it combined independently loaded modules
with global side effects and left only 41 bytes of headroom. It is not an
accepted fix. The later start-page fix keeps these modules separate and raises
the total gzip budget to 825 KiB; the resulting local build measures 811.4 KiB.
This does not make an earlier build or deployment candidate acceptable.
A Vite preview alone does not reproduce the native package's
complete runtime file layout, so browser tests against it cannot establish
native deployment acceptance. Four selected start/login, logger and resume
browser tests passed against the existing local Apache stack with the original
build; this is not a native Plesk or complete staging access test. A further
experiment using strict module execution order still exceeded the total budget
and was discarded. A Terser build also exceeded the budget (836,055 bytes)
and was discarded without retaining its dependency or configuration changes.
Subsequent local checks passed JavaScript and PHP lint, PHPStan, the four
previously failing renderer cases, and three runs of the 44-test MySQL
concurrency group. The PHP test fixture now waits for all configured server
workers, not just an open socket. A local full Vitest run with two workers
passed 5,374 tests with 41 skipped. These checks and the isolated MariaDB
native schema/migration/restore fixture are not a replacement for a successful
published CI run or a production backup and restore.

The target architecture uses Plesk's Apache/PHP-FPM and MariaDB, with distinct
staging and production databases and credentials. Production serves the game
at `galaxyquest.themisdb.org/`; the existing `/wordpress` directory and its
database must remain untouched. Plesk currently reports PHP-FPM 8.4 for that
domain. WordPress URLs, routing and security rules must be verified before
changing the document root or serving a release.

Read-only public checks on 2026-11-12 found the production root responding
HTTP 200, `/wordpress/` responding HTTP 503 with a WP Toolkit scheduled
maintenance page, and `/wordpress/wp-json/` responding HTTP 404. A later check
the same day, after creating the disabled Git repositories, found the root
returning the Plesk default page (200), `/wordpress/` returning the GalaxyQuest
Blog page (200), and `/wordpress/wp-json/` still returning 404. The cause of
the WordPress status change is unknown; no maintenance setting was changed.
The originally proposed staging hostname did not resolve from the development
machine; the UUID-based replacement also did not resolve when checked. These are observations,
not proof that WordPress is broken or that maintenance should be disabled.
Preserve its existing state and obtain an operator-approved baseline and
working staging DNS/TLS before any cutover; recheck all results at that time.

On 2026-11-13, TLS-verified public requests returned HTTP 200 for the
production root and UUID staging root, both showing the Plesk default page.
`/wordpress/` returned HTTP 200 with the GalaxyQuest Blog, while
`/wordpress/wp-json/` returned HTTP 404. These reachability checks do not
indicate that the game is deployed or that WordPress REST routing is healthy.

The candidate image acceptance also runs `scripts/check_wordpress_routing.mjs`
against a disposable Apache fixture with a simulated WordPress directory, both
with standard WordPress rewrite rules and without a `.htaccess`. When the
directory exists, the game's root `.htaccess` leaves its routes to WordPress;
without WordPress rewrite rules, missing blog paths return 404 rather than the
game. It does not install WordPress rewrites or repair permalinks. If the
directory does not exist, the game fallback is unchanged. `FilesMatch` denies
selected sensitive extensions even if WordPress has its own rewrite rules; the
fixture checks `.env` case variants, not every sensitive path or server-level
policy. The test checks game
routes, API and health routes, blog permalinks, REST-style routes and static
assets. This tests the repository Apache rules only: it is not a real WordPress
installation, does not cover
Plesk nginx, plugins, PHP-FPM, filesystem permissions, maintenance or TLS, and
must not be treated as approval for cutover.

`native-plesk-services.yml` defines only TTS; the optional
`native-plesk-gpu.yml` adds ComfyUI. Neither defines an Apache or database
service. These are preparation files, **not an approved production stack**:
port collision checks, digest enforcement, host-specific GPU acceptance,
monitoring and deployment integration are not implemented. Do not start them
on the server yet. They bind to IPv4 loopback, not a public interface, but
loopback does not isolate other local users or containers. TTS refuses to start
without a shared secret of at least 32 characters; the native PHP configuration
must use the same secret. ComfyUI has no comparable authentication and needs a
reviewed host access boundary before activation. Staging and production must
use different project names, ports, credentials and volumes.

The read-only `node deploy/check-native-services.mjs staging|production tts|gpu`
resolves Compose from the current environment and rejects invalid project names,
unpinned images, public, reserved or duplicate bindings, short or placeholder
TTS secrets, and unexpected services. It never starts containers or prints the
resolved secrets. It does not check whether ports are already in use, validate
the other environment, establish GPU access isolation or authorize deployment;
direct `docker compose` commands do not automatically run this check.

The Plesk control panel is reachable through the hostname on its certificate,
`jovial-napier.82-165-41-60.plesk.page`; `www.themisdb.org:8443` presented a
certificate for that different hostname when checked. Never disable TLS
verification. Native release activation, safe database initialization and
restore, migration gates, secure PHP-FPM secret propagation, web access rules
(including nginx static-file behavior), monitoring and acceptance against the
actual PHP/MariaDB versions remain outstanding. Keep legacy automation blocked.

The local compatibility check `npm run check:native-db-compatibility` starts
uniquely named disposable Docker fixtures, not a Plesk connection: MariaDB
11.8.6, PHP 8.4 with `pdo_mysql`, a limited staging database account and
separate production and legacy-name sentinel schemas. It imports the base
schema into the selected fixture schema after checking and removing its exact
legacy database preamble and validating the reviewed schema SHA-256 through
`NativeBaseSchema`, runs and verifies the canonical migration manifest,
repeats migrations, seeds faction homeworlds and checks representative fleet
queries and cross-schema denial. It additionally dumps only the staging fixture
and restores into a separate empty test schema with a different account. It
compares table names, migration history and every table's row count, checks
table integrity, and verifies the restored migration manifest. These checks do
not prove every row or stored object matches. It is an experiment, not an
installer or production backup: accounts have broad privileges on their own
test schemas; consistent backups require stopped or coordinated writers; and it
does not validate Plesk PHP-FPM, web routing, actual permissions or remote
configuration. CI runs this check before publishing images.
The source-pinned parser only returns statements; it is not an installer and
does not check database identity, privileges, emptiness, concurrent writers,
or backups. A reviewed schema change requires updating its pin and tests; never
use a changed schema simply by ignoring a pin mismatch.

`scripts/native_db_inspect.php --database=NAME --user=NAME` is a read-only
diagnostic requiring explicit `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASS`
environment variables; `DB_PORT` is optional. It checks the selected database
and authenticated account and reports visible table, view, routine, event and
trigger counts as JSON. `visible_base_table_engines` groups visible `BASE TABLE`
entries by engine and count; views and other table types are not included, and
a null engine remains unknown. It never writes or grants access. Visibility
depends on database privileges: an InnoDB-only result does not prove that all
tables are transactional or that a consistent backup can be taken.
`empty_visible: true` is **not proof** that the schema is empty, is owned by
GalaxyQuest, or is safe to initialize. Concurrent changes, server identity,
permissions and verified backup still require independent checks. Run it only
with an operator-provided environment, never command-line passwords, and do
not use it as an authorization to initialize.

CI prepares a **non-deployable candidate** after the web image passes its
existing acceptance checks, using `package-native-release.sh`. It combines
explicitly selected tracked files from the exact commit with the Vite `dist`
from the accepted image ID; the image revision label must match the commit.
The archive records both IDs and excludes the WordPress installation, mutable
`generated` and `cache` contents, and untracked local files. GitHub stores a
separate candidate artifact for each workflow attempt and exposes its digest
through the Actions API. Its deterministic tar metadata applies only to
identical inputs and the same archiving tools; it does not establish that
separately rebuilt image contents are identical. The existing container
acceptance uses PHP 8.2 and MySQL; the exact candidate additionally runs behind
Apache `mod_proxy_fcgi` on a disposable PHP 8.4 FPM worker with a read-only
document root, checking its home page, built assets, health routes, protected
files and simulated WordPress rewrites. Readiness is expected to return 503
because no database is attached. A separate native database fixture uses PHP
8.4 CLI and MariaDB 11.8. These checks do not cover Plesk's actual PHP-FPM
pool, nginx, the actual WordPress installation, Plesk routing, or the real
database. Do not extract the
candidate into a live document root: persistent generated assets, required
seed assets, secure static-file serving and native release activation remain
unverified.

## Legacy container architecture (obsolete; do not execute)

| Environment | Domain | Compose project | Example web / Grafana loopback ports |
|---|---|---|---|
| Staging | staging-galaxyquest.themisdb.org | galaxyquest-staging | 8082 / 3001 |
| Production | galaxyquest.themisdb.org | galaxyquest-production | 8081 / 3000 |

Both use production application settings, separate credentials, databases,
sessions, generated assets, monitoring and GPU volumes. Do not copy production
player data into staging. All images are pinned by digest. The example ports
are not reservations: select four distinct ports that are actually free on
the target host, and configure each domain's proxy to match its `WEB_PORT`.

Architecture:

```text
local development -> reviewed GitHub push -> CI quality gates
  -> build web + TTS -> scan exact candidates -> fresh-database acceptance
  -> GHCR digests -> staging deployment -> public HTTPS smoke
  -> [main only: production Environment approval] -> production deployment

Plesk nginx + TLS -> 127.0.0.1:8081/8082 -> Apache/PHP -> MySQL + TTS
                                                  -> ComfyUI + TRELLIS2
Prometheus -> exporters + internal app metrics + readiness -> Alertmanager
Grafana -> Prometheus (operator access only)
```

The local developer Compose file is not merged into production. There are no
source-code bind mounts or production builds on the Plesk host. Plesk manages
domains/TLS; Compose, not individual Plesk container edits, owns service lifecycle.
Do not configure an independent Plesk Git auto-deployment or Watchtower.

### Coexistence with the existing Plesk services

The existing host Apache/nginx and MySQL/MariaDB remain installed and running.
Plesk continues to own the public HTTP/HTTPS ports 80 and 443 and its existing
virtual hosts. GalaxyQuest's Apache listens on port 8080 **inside its container**
and is reachable by Plesk only through the chosen loopback `WEB_PORT`.
The app's MySQL runs in its own container and project-specific volume; the
container port 3306 is **not published on the host**. It neither replaces nor
uses the Plesk database server, its socket, credentials, data directory or
databases. The restore-check also uses an isolated container and temporary data.
Switching to Plesk's existing database would require a separately designed
backup, migration and compatibility workflow; do not just change `DB_HOST`.

Before provisioning, an administrator must inventory the host without changing
running services, for example:

```bash
sudo ss -H -ltn
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Look for wildcard and IPv6 bindings as well as `127.0.0.1`, and choose four
distinct free ports for staging/production web and Grafana. Services may change
after inspection: the deployment preflight rejects detected listeners unless
they correspond to exactly the existing loopback binding of the same Compose
project and service. `ss` is required. The check is not an atomic port
reservation; Docker may still reject a race or a conflicting publication that
does not appear as a host listener. The check compares the listener address and
Docker's binding metadata; it does not prove which process owns a socket.
Investigate rather than stopping or reconfiguring any existing Plesk service.

The host remains a shared resource: provision memory, CPU, disk and backup
capacity for both Plesk's existing workloads and the new containers. Verify
other Docker networks and container names do not overlap; dedicated Compose
project names isolate the game volumes and networks.

## 1. Host prerequisites

An administrator must first verify:

- Supported 64-bit Linux Plesk host, x86-64 for the current GPU wheel set.
- Docker Engine, Compose v2 with multiple `--env-file` support, `bash`, `jq`,
  `flock`, `gzip`, `sha256sum`, `curl`, `ss` (iproute2) and GNU coreutils.
- Deployment account allowed to use Docker. Docker group membership is effectively
  root access; use a dedicated account, not ordinary shared-hosting access.
- Server NVIDIA GPU, compatible driver and NVIDIA Container Toolkit. Verify
  `nvidia-smi` and a CUDA container. A hostname is not proof of available hardware.
- Capacity for Plesk plus two MySQL/TTS/app/monitoring stacks, GPU models and a full
  temporary database restore. The restore checker uses RAM-backed storage:
  sufficient additional RAM is required for the uncompressed database.
- Sufficient VRAM for the accepted workflows. Staging and production share the
  physical GPU; do not assume two inference workloads fit simultaneously.
- DNS and valid certificates for both domains, SSH access restricted appropriately.
  Do not expose Docker API ports 2375/2376, MySQL, ComfyUI, TTS or exporters.
- Mailbox `galaxyquest@themisdb.org`, STARTTLS submission on `themisdb.org:587`,
  valid certificate, SMTP authentication, SPF/DKIM/DMARC and actual receipt tested.

Do not install Docker over an existing host installation without an administrator
review. Plesk's paid Remote Docker feature is unnecessary when Docker runs on the
Plesk server itself.

Verify the host key independently through the provider/Plesk console before
adding it to `known_hosts`; do not trust a network `ssh-keyscan` result by itself.
Never disable strict SSH host-key checking.

## 2. GPU image and models

The combined service uses [Dockerfile.production](../../docker/comfyui/Dockerfile.production)
and the committed `tools/comfyui-trellis2` submodule revision. Local uncommitted
submodule patches are deliberately not published by GitHub.

The separate legacy TRELLIS Gradio container is not deployed: its old image did
not install the TRELLIS pipeline. ComfyUI includes TRELLIS2 as custom nodes.

Configure a dedicated disposable Linux x64 NVIDIA GitHub runner with label
`galaxyquest-gpu`, then protect Environment `gpu-build` and restrict it to trusted
branches. Manually run [gpu-image.yml](../../.github/workflows/gpu-image.yml).
It builds dependencies/wheels into the image, scans before registry login,
requires CUDA and the actual TRELLIS2 node catalogue, and publishes only that
accepted image ID. No dependency installation occurs during service startup.

Use the resulting `gpu-release.env` digest as `GPU_IMAGE`. Node loading alone is
not proof of model inference: before release, run a representative API workflow
through image -> model load -> generation -> GLB export, verify the exported GLB,
record model/workflow versions and VRAM use. Provision the licensed/gated model
files into the environment's `gpu-models` volume, including any required DINOv3
access. Do not bake Hugging Face tokens or model access credentials into images.
Workflow-specific background workers remain subject to their own acceptance;
deploying ComfyUI does not automatically start a game generation queue worker.

## 3. Initial server configuration

Run these examples on the Linux server, not Windows PowerShell. Use separate
roots `/srv/galaxyquest/staging` and `/srv/galaxyquest/production` or an equivalent
account-owned path ending in `/galaxyquest/<environment>`.

Place the reviewed contents of [deploy/](../../deploy/) in a versioned directory,
for example `/srv/galaxyquest/production/releases/initial`. Keep this directory
immutable after activation. Repeat for staging.

```bash
root=/srv/galaxyquest/production
bundle="$root/releases/initial"
umask 077
mkdir -p "$root/backups"
chmod 700 "$root" "$root/backups"
cp "$bundle/environment.example" "$root/.env"
for name in runtime.env database.env tts.env grafana.env mysql-exporter.cnf alertmanager.yml; do
  cp "$bundle/$name.example" "$root/$name"
done
chmod 600 "$root/.env" "$root/"*.env
chmod 640 "$root/mysql-exporter.cnf" "$root/alertmanager.yml"
id -g
```

Edit these files privately on the host. Do not paste credentials into chat, GitHub
variables, command arguments, screenshots or commits.

- `.env`: set `DEPLOY_GID` to the deployment account's group; pin every image as
  `repository@sha256:<64 hexadecimal characters>`. Obtain infrastructure digests
  from a reviewed version using `docker buildx imagetools inspect IMAGE:VERSION`.
  The web/TTS digests come from CI's `container-release` artifact; GPU from its
  separate accepted artifact.
- Match `DB_USER`/`DB_PASS` in `runtime.env` with `MYSQL_USER`/`MYSQL_PASSWORD` in
  `database.env`. Use separate random passwords of at least 32 characters for the
  application and root account.
- Match the random `TTS_SECRET` in `runtime.env` and `tts.env`.
- `REGISTRATION_PUBLIC_URL`, `TTS_CORS_ORIGINS`, `PUBLIC_URL` must match this
  environment's HTTPS domain.
- Set SMTP mailbox credentials and the actual operator recipient in Alertmanager.
  Keep Grafana on loopback; use an SSH tunnel, or a separately protected Plesk
  domain with a matching `GF_SERVER_ROOT_URL`.
- Set a separate random 64-character lowercase hex exporter password in
  `mysql-exporter.cnf` (for example generated with `openssl rand -hex 32`).
  Its process and Alertmanager
  get the supplementary `DEPLOY_GID`, allowing read-only group access to these
  two mode-640 files without running them as root.
- Staging: project `galaxyquest-staging`; production: `galaxyquest-production`.
  The example ports 8082/3001 and 8081/3000 must be checked first and may be
  replaced with distinct free unprivileged ports. Avoid host MySQL port 3306.
  `WEB_PORT` must match its domain's Plesk proxy configuration.
- Optional non-GPU acceptance only: clear `COMPOSE_PROFILES` and explicitly set
  `COMFYUI_ENABLED=0`. Do not claim GPU readiness in this mode.

Use separate credentials per environment. Infrastructure/GPU images are operator
pinned; routine app deployments update only web/TTS. Database major-version and
GPU/model upgrades are separate maintenance operations.

```bash
bash "$bundle/stack.sh" "$root" preflight
bash "$bundle/stack.sh" "$root" bootstrap --approve-empty-database
```

Bootstrap rejects a nonempty database, imports the base schema from the pinned
image, makes a restore-tested recovery point, applies only the canonical
migration runner, verifies all checksums, and seeds the new world. Full galaxy
warmup can take time. It does not import developer accounts or a developer DB.
Do not rerun `setup.php` without `--skip-migrations` as a release upgrade path.

**Bootstrap recovery:** a failure after base import leaves a nonempty database.
Do not bypass the guard or delete volumes. Inspect the error, keep the backup,
then continue the reviewed canonical migration/bootstrap steps manually with the
same pinned image. Adopt historical migrations only via existing verified
contracts and explicit approval; do not edit migration sources or checksums.

Bootstrap creates the dedicated metrics DB user from
[metrics-user.sql.example](../../deploy/metrics-user.sql.example), taking its
password privately from `mysql-exporter.cnf` through mysql stdin. The exporter
is not a root user. On an existing installation, provisioning or rotating this
user is an explicit administrator operation; app deployments do not reset it.

For the first administrator, the existing
[administrator CLI](../../scripts/ensure_default_admin.php) requires a unique
`DEFAULT_ADMIN_PASSWORD` of at least 16 characters, delivered as a temporary
environment variable (`docker compose run ... -e DEFAULT_ADMIN_PASSWORD web php
scripts/ensure_default_admin.php`), never a CLI password argument. Read it
privately using `read -rs` on the server and unset it immediately afterwards.
This helper resets the named administrator if rerun, so use it only deliberately;
review its local placeholder email and account/RBAC settings, replace contact
details as appropriate, log in over HTTPS and enable 2FA. Do not enable developer
auth helpers or seed shared default passwords.

## 4. Plesk reverse proxy

On each dedicated GalaxyQuest domain only, install its certificate, enable
HTTPS redirection and disable that domain's Apache proxy mode before adding the reviewed
[nginx directives](../../deploy/plesk-nginx.conf.example) to Additional nginx
directives. Set the upstream port to that environment's verified `WEB_PORT`.
Do not disable Apache, nginx or proxy mode globally, and do not alter other
domains. The template assumes nginx is enabled in Plesk; if it is not, do not
change server-wide settings without an administrator-approved alternative.
Validate the generated nginx configuration with Plesk; existing custom
`location /` blocks must be reconciled rather than duplicated.

All paths must reach the container, not Plesk's old document root. Disable
Plesk's direct static-file serving for the application domain if it bypasses
this proxy. Forward the original Host and HTTPS scheme; SSE buffering is disabled.
Metrics endpoints remain reachable internally but return 403 publicly.

```bash
node scripts/check_deployment_http.mjs https://staging-galaxyquest.themisdb.org
node scripts/check_deployment_http.mjs https://galaxyquest.themisdb.org
```

Run this Node check from a checkout or CI runner. It requires real HTTPS,
liveness/readiness JSON, built Vite assets, security headers and denied
operational endpoints. Also accept registration mail, login/cookies, TTS,
SSE, representative game actions and actual GPU inference before opening access.
There is a short maintenance interval during updates; this is not blue/green
zero-downtime deployment.

## 5. GitHub configuration and release process

Create GitHub Environments `staging`, `production` and `gpu-build`.
**Production MUST require designated reviewers**, prevent self-review where
available, and allow deployments only from `main`. Staging accepts `develop`
and `main`. Use a repository plan which supports these protections.
Protect branch merges and require the existing quality gates. Never bypass
failed CI to obtain a production image.

Set these Environment variables separately:

| Variable | Value |
|---|---|
| `PLESK_HOST` | SSH host |
| `PLESK_USER` | dedicated deployment account |
| `PLESK_PORT` | SSH port, default 22 |
| `PLESK_DEPLOY_ROOT` | absolute account-owned root ending in `/galaxyquest/staging` or `/galaxyquest/production` |
| `PUBLIC_URL` | exact environment URL from the table above |

Environment secrets:

- `PLESK_SSH_KEY`: dedicated unencrypted automation key; restrict its server-side
  account and filesystem access appropriately.
- `PLESK_KNOWN_HOSTS`: independently verified OpenSSH host-key entry, including
  `[hostname]:port` for a nonstandard port.

For private GHCR packages, authenticate the server once using a scoped read-only
package credential via `docker login --password-stdin`. The workflow's
`GITHUB_TOKEN` publishes packages but is never copied to the server.

Only after both initial stacks and protections are accepted, set repository
variable `PLESK_DEPLOY_ENABLED=true`. It intentionally defaults to off while host
keys, server secrets or initial databases are missing.

The main [CI workflow](../../.github/workflows/ci.yml):

1. Requires all existing lint, PHP, JavaScript and browser gates.
2. Builds web and TTS candidates, scans both, tests the exact candidates against
   an empty isolated database, then publishes them without rebuilding.
3. Preserves commit + digest references in `container-release`.
4. On `develop`, deploys automatically to staging.
5. On `main`, deploys the **same main candidate digests** to staging first;
   production then waits for Environment approval.

[deploy-plesk.yml](../../.github/workflows/deploy-plesk.yml) transfers a bundle at
the triggering commit, uses strict SSH trust, serializes deployment per
environment, runs the server lifecycle, and requires public HTTPS acceptance.
The deployment evidence artifact identifies the commit and both app digests.
No live database writes were performed while implementing these files.

## 6. Backup, migration and failure policy

[stack.sh](../../deploy/stack.sh) holds a per-environment `flock` across all
deployment, backup and rollback operations. App writers are stopped before the
database/asset recovery point; do not add independent writers without extending
this lifecycle. External cron/projector/generation workers, if enabled later,
must also be stopped by the operator before maintenance.

The hourly world tick (world events, digest mail outbox) is **not enabled** on
Plesk; production workers remain disabled. When it is accepted, the documented
schedule is a cron job every 5 minutes; the aligned 3600-s global cooldown and
the MySQL scope lock make it run once per hour and stay restart-safe:

```cron
*/5 * * * * cd /path/to/galaxyquest && php scripts/run_simulation_tick.php --scope=global
```

It requires the `SMTP_*` settings above for mail delivery (without them due
mails are marked `skipped`) and must be stopped together with the other writers
before maintenance. See [Headless simulation engine](HEADLESS_SIMULATION_ENGINE.md#hourly-world-tick-flat-tick-engine).

Every app deployment:

1. Validates host, file permissions, placeholders, matching secrets and image pins.
2. Pulls candidates before stopping the application.
3. Stops writers, streams an InnoDB-consistent SQL dump and generated assets into
   private backup files and writes SHA-256 checksums.
4. Restores SQL into a separate temporary MySQL container, checks table counts and
   SQL `CHECK TABLE` results, then removes only that restore container.
5. Runs migration dry-run, canonical Up and deployment verification.
6. Starts the stack and checks application readiness and GPU node availability.
7. Records current/previous app digests and bundle directories only after success.

MySQL DDL is not transactionally reversible. A migration failure deliberately
leaves writers stopped; there is no success-shaped fallback or automatic
destructive DB rollback. Preserve logs, backup and `candidate.env`; investigate
before resuming. `up --dry-run` previews statements; it is not proof they will
execute successfully on every historical schema.

For a compatible schema, an operator may restore previous images and their
previous Compose bundle:

```bash
bash "$(cat "$root/current-bundle")/stack.sh" "$root" rollback --approve-compatible-schema
```

The old image's strict migration verification must pass before activation. If
the newer manifest introduced migrations, this may deliberately reject rollback;
use a reviewed forward fix or a coordinated DB recovery, not checksum editing.

For database recovery: stop all writers, verify the selected `.sql.gz.sha256`
and `.assets.tar.gz.sha256`, restore the dump into an isolated recovery MySQL
instance, verify data and migrations with the matching recorded app release,
and rehearse switching to that recovered state before touching the live DB.
Restore generated assets from the corresponding tar archive with the correct
app UID/GID. Restoring SQL over newer tables is not a clean schema rollback.
Production replacement/restoration remains an explicit administrator operation;
the release script intentionally does not issue `DROP DATABASE` or `down -v`.

Backups stored beside Docker are **not disaster recovery**. Copy encrypted backups
and deployment configuration to independent storage, protect credentials in the
operator secret store, define retention and test loss of the whole server.
TTS/model caches can be downloaded again; preserve required licensed model
versions separately. GPU outputs not yet imported into the game are separate
working data and must be retained/exported if needed.

Optional [backup service](../../deploy/backup.service.example) and
[timer](../../deploy/backup.timer.example) templates invoke the active bundle.
Install them only after replacing the user/root values and a successful manual
backup. Each backup includes a short maintenance interval and full restore test;
failure leaves writers stopped. Monitor systemd failures and backup age, and
test the external alert recipient. No automatic backup pruning is installed.

## 7. Monitoring and local verification

Production monitoring is in [deploy/monitoring/](../../deploy/monitoring/).
Prometheus uses service DNS, scrapes the app's correct `metrics_path`, probes
database/schema readiness through Blackbox, and forwards alerts to Alertmanager.
Grafana provisions the operations dashboard automatically. The production stack
does not mount the Docker socket or start privileged cAdvisor.

Query `up`, `mysql_up`, `probe_success{job="readiness"}` and Alertmanager delivery
errors after installation. A green container health flag alone is insufficient.

Local regression commands:

```powershell
$env:GQ_DOCKER_CONTEXT_TESTS = '1'
npx vitest run tests/js/production-deployment.test.js tests/js/ci-stack.test.js tests/js/image-publication-workflow.test.js tests/js/github-ci-inspect.test.js tests/js/native-candidate-pull.test.js
docker compose exec -T -e XDEBUG_MODE=off web php vendor/bin/phpunit --do-not-cache-result tests/Unit/RegistrationSmtpTest.php
docker build --tag galaxyquest:deployment-validation .
node scripts/check_production_stack.mjs
node scripts/check_smtp_delivery.mjs
```

The isolated acceptance starts only a unique disposable project, checks 503
before schema/migrations and 200 afterwards, repeats migrations, seeds faction
homeworlds, checks built assets/extensions, and removes only its own volumes.
It does not reset the developer database, publish images or contact Plesk.
The separate SMTP check uses an isolated Mailpit fixture and temporary
certificate, exercises STARTTLS and implicit TLS, and rejects an untrusted
certificate. It does not send mail through the actual Plesk mailbox.

Remaining external gates: trusted SSH key, Linux/GPU capacity, clean GPU image
build/inference, SMTP receipt, GitHub Environment protections/secrets, public
Plesk routing, encrypted off-host backup/restore, and a complete successful
GitHub deployment run. Do not label these as verified by local contract tests.

Official references: [Plesk Docker administration](https://docs.plesk.com/en-US/obsidian/administrator-guide/plesk-administration/using-docker.75823/)
and [Plesk's domain-to-container proxy guide](https://support.plesk.com/hc/en-us/articles/12377286180503-How-to-proxy-web-requests-from-domains-to-Docker-containers-via-nginx-in-Plesk).
