# Release checklist

This document describes the public beta release process. The source repository is public; npm publication remains a separate, explicitly authorized step.

## Beta policy

Prereleases use Semantic Versioning identifiers and the npm `next` dist-tag. The first candidate is `0.1.0-beta.1`. The stable `latest` tag should not be used until the beta has been tested across multiple unrelated repositories.

## Prepare

1. Confirm that `package.json` and the runtime manifest report the intended version.
2. Update `CHANGELOG.md` with a dated release entry.
3. Confirm supported Node.js versions in package metadata, README, and CI.
4. Run the full local check on both a supported macOS or Linux environment:

   ```bash
   npm ci
   npm run check
   ```

5. Inspect `npm pack --dry-run` and the actual tarball. It must include the CLI, runtime modules, policies, prompts, schemas, license, and documentation. It must exclude tests, coverage, run artifacts, worktrees, `.env*`, `.npmrc`, and source-repository data.
6. Install the tarball into a disposable Git repository and run:

   ```bash
   npx repo-foreman help
   npx repo-foreman doctor
   ```

   Run the isolated self-test from the source checkout with `npm run self-test` before packing. The beta does not expose self-test as a public CLI command.

7. Confirm all CI matrix jobs pass.

## Publish

Before the first publication, the owner must configure npm package ownership, account protection, and provenance or trusted publishing. Confirm that the public source metadata in `package.json` matches the repository being released.

For an authorized beta publication:

```bash
npm publish --tag next
```

Never run `npm publish` from an unreviewed worktree or with an unexpected npm account. Verify with `npm whoami`, `npm config get registry`, the exact tarball contents, and the version immediately before publishing.

No automated publish workflow should be enabled until npm trusted-publishing configuration exists.

## After publication

1. Verify that `npm view repo-foreman@next` reports the expected version, license, engines, owners, integrity, and zero runtime dependencies.
2. Install by exact version in a clean environment and run help, doctor, and the package smoke test.
3. Create release notes from the changelog without overstating platform or security guarantees.
4. Keep the prior prerelease available long enough to diagnose regressions; use npm deprecation messages rather than unpublishing except for urgent security or legal reasons.
