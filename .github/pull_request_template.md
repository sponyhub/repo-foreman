## Summary

<!-- What changed? Keep the scope focused and call out any user-visible behavior. -->

## Why

<!-- What problem does this solve, and why is this approach appropriate? -->

## Validation

<!-- List the exact commands run and their results. Explain anything not run. -->

- [ ] `npm run check` passes locally.
- [ ] Focused regression tests cover stable bug reproductions or changed behavior, where practical.
- [ ] Package contents and packed CLI behavior were checked when packaging or release assets changed.

## Documentation and compatibility

- [ ] `README.md`, relevant `docs/**`, and `CHANGELOG.md` were updated for user-visible changes, or the reason they are not needed is explained below.
- [ ] CLI, schema, artifact, resume/cache, platform, and release compatibility impacts were considered where applicable.

<!-- Documentation or compatibility notes, including intentional limitations or migration needs. -->

## Security and privacy

- [ ] Security and privacy impact is described below, including any change to permissions, sandboxing, network access, environment handling, shell execution, Git/worktree behavior, redaction, or stored artifacts.
- [ ] No credentials, tokens, customer data, personal data, private prompts, raw sensitive output, or real environment files are included.
- [ ] Broader access or a less restrictive default is explicit, documented, and covered by focused negative-path tests where applicable.
- [ ] Runtime dependency and external-service changes were reviewed and documented where applicable.

<!-- Security/privacy impact, or a concrete explanation of why there is none. -->

## Remaining limitations

<!-- Note known follow-ups, residual risks, or write "None". -->
