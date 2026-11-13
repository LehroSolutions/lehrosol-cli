# Publishing LehroSol CLI

The npm package is `@lehrosolutions/cli`; its executables are `lehrosol` and `lehr-sol`.
The web dashboard is currently a separate source-checkout client.

Windows npm adapter shims run through their JavaScript entrypoint. Custom
`.cmd`/`.bat` adapter wrappers must be configured as a native executable or a
`.js`/`.mjs` entrypoint; shell wrappers cannot preserve arbitrary prompts safely.

## Prepare and verify

Use Node 24 and npm 11.21.1 (the versions used by the release workflow).
From a clean checkout of the intended release commit, run:

```powershell
npm run release:prepare
```

This runs the package's syntax, isolated test, and documentation gates, packs into
a fresh staging directory, and writes the exact tarball, SHA256SUMS, and release
metadata to `dist/`. Existing tarballs are never selected by filename sorting.
Requested artifacts must exist as regular files and have distinct filenames.
Verification also checks the manifest's artifact names, sizes and hashes against
`SHA256SUMS`; malformed metadata or omitted artifacts fail the gate.
The manifest records the Git revision and whether local changes are included.
Local preparation may include uncommitted work for review. CI preparation rejects
a dirty checkout, including documentation that changed during the build.
The local provenance file is unsigned metadata; npm trusted publishing supplies
registry provenance when the source repository and package are public.

Install that exact tarball into a temporary prefix and check `--version` and
`--help` before publishing. Keep the installation's LEHRO_HOME temporary too.

## Bootstrap the npm package

An npm organization role does not authenticate this machine. Use the authorized
account interactively with `npm login`, and confirm it with `npm whoami`.
Publish the verified tarball, not a newly packed working directory:

```powershell
$release = Get-Content ./dist/release-manifest.json -Raw | ConvertFrom-Json
npm publish ("./dist/" + $release.artifacts[0].name) --ignore-scripts --access public --tag beta
```

Complete any npm account/2FA challenge in your browser. Never put passwords,
recovery codes, or tokens in repository files. Check the published version and
dist-tags with `npm view @lehrosolutions/cli@beta version dist-tags --json`.

On this package's initial publication, npm created `latest` alongside `beta`
despite the explicit beta tag, and rejected removing `latest` with HTTP 400.
This matches the behavior reported in [npm/cli#8490](https://github.com/npm/cli/issues/8490).
Do not publish a fake stable version to work around it. Keep installation
instructions explicit about `@beta`; subsequent prereleases update only `beta`.
The first actual stable release can deliberately advance `latest`.

## Configure subsequent GitHub releases

In the npm package's trusted-publishing settings, authorize:

- GitHub organization: `LehroSolutions`
- Repository: `lehrosol-cli`
- Workflow filename: `release.yml`
- Allow direct publishing (`npm publish`) for the workflow's publish step.

Validate the new trusted publisher within npm's configuration expiry period.
The workflow needs no long-lived npm secret. Public registry provenance requires
a public source repository; making a private GitHub repository public is a
separate owner decision.

For each later release, increment package.json's version and update the changelog.
Commit, push, then create a matching new `v<version>` tag. Do not move existing
release tags. Tagged runs publish the verified tarball: prereleases use `beta`,
stable versions use `latest`. The package's default publishConfig tag is `beta`
to protect manual publication; stable manual releases must explicitly use
`--tag latest`.

After npm publication succeeds, the tagged workflow attaches the same tarball,
SHA256SUMS, release manifest, and SBOM to a matching GitHub Release. Beta versions
are marked as prereleases and do not become GitHub's latest stable release.

A manual GitHub Actions run only builds and uploads the release candidate; it
does not publish to npm. Download and verify its artifact before tagging.
