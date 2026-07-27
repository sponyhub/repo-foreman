# Release checklist

This document describes the public beta release process. The source repository is public; npm publication remains a separate, explicitly authorized step.

## Beta policy

Prereleases use Semantic Versioning identifiers and the npm `next` dist-tag. The first candidate is `0.1.0-beta.1`. npm requires every package to have a `latest` tag, so the bootstrap publication also leaves `latest` pointing to the first beta. Later beta publications move only `next`; replace `latest` only when a stable release has been tested across multiple unrelated repositories.

## Prepare

1. Confirm that `package.json` and the runtime manifest report the intended version.
2. Update `CHANGELOG.md` with a dated release entry.
3. Confirm supported Node.js versions and operating systems in package metadata and README.
4. Run the full local check manually on each supported Node.js and operating-system combination claimed for the release:

   ```bash
   npm ci
   npm run check
   ```

   GitHub Actions runs the same command on macOS and Linux with Node.js 22.14 and 24 for pull requests and pushes to `main`. Confirm that the release commit has a successful `Required CI` result. CI supplements the manual release gate and does not replace any supported-platform run recorded for the release.

5. Inspect `npm pack --dry-run` and the actual tarball. It must include the CLI, runtime modules, policies, prompts, schemas, license, and documentation. It must exclude tests, coverage, run artifacts, worktrees, `.env*`, `.npmrc`, and source-repository data.
6. Install the tarball into a disposable Git repository and run:

   ```bash
   npx repo-foreman help
   npx repo-foreman doctor
   ```

   Run the isolated self-test from the source checkout with `npm run self-test` before packing. The beta does not expose self-test as a public CLI command.

7. Record the manual release-gate result for each supported combination.

## Publish

For the bootstrap publication, enable two-factor authentication on the intended owner's npm account and verify the package name, account, registry, public source metadata, and tarball. An unpublished package does not yet have owner or trusted-publisher settings, and a local manual publication cannot generate npm provenance. RepoForeman uses an explicitly authorized interactive publication for this one bootstrap version; record that it does not carry provenance.

For an authorized beta publication:

```bash
npm publish --tag next --access public
```

Never run `npm publish` from an unreviewed worktree or with an unexpected npm account. Verify with `npm whoami`, `npm config get registry`, the exact tarball contents, and the version immediately before publishing.

Every publication requires explicit human authorization. Do not add or enable a publication workflow without explicit maintainer approval, and do not configure one to publish on ordinary pushes or tags.

## After publication

1. Verify that `npm view repo-foreman@next` reports the expected version, license, engines, integrity, repository, and zero runtime dependencies, and that `npm owner ls repo-foreman` reports the intended owner. For the bootstrap beta, also confirm that npm's required `latest` tag points to the same first version; later betas must move only `next` until a stable release is approved.
2. Install by exact version in a clean environment and run help, doctor, and the package smoke test.
3. Create release notes from the changelog without overstating platform or security guarantees.
4. Keep the prior prerelease available long enough to diagnose regressions; use npm deprecation messages rather than unpublishing except for urgent security or legal reasons.
5. Require two-factor authentication and disallow tokens in the npm package's publishing-access settings.
6. Before any later release, configure trusted publishing with the `npm publish` action allowed for an explicitly approved, manually initiated workflow using npm 11.5.1 or newer on a GitHub-hosted runner or GitLab.com shared runner. npm then generates provenance automatically. Until that setup has been reviewed and enabled, later publication is blocked.
