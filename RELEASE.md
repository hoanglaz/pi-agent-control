# Release process

No release has been made. Do not use these steps until a public GitHub repository exists, its owner is verified, npm publication rights are confirmed, and a maintainer explicitly approves release.

## One-time setup

1. Create the public repository only after maintainer approval and set the exact canonical `repository` URL in `package.json`.
2. Confirm `pi-agent-control-center` is still available on npm; the earlier E404 is not a reservation or availability guarantee.
3. Configure npm Trusted Publishing for this repository and `.github/workflows/release.yml`; do not create or commit an npm token.
4. Protect the GitHub `npm-release` environment with required reviewers. Confirm the workflow's OIDC provenance requirements against npm's current Trusted Publishing instructions.
5. Review the Pi package manifest and verify that adding the `pi-package` keyword makes the package eligible for the Pi package gallery. Confirm catalog indexing only after npm publication.

## Release

1. Update `CHANGELOG.md`, `package.json`, and `package-lock.json` to the same release version.
2. Run CI checks locally and verify `npm pack --dry-run` contents.
3. Create and push an annotated `v<version>` tag after explicit approval.
4. Manually dispatch **Release** from that tag with `publish_npm` checked. The workflow also requires approval at the protected `npm-release` environment.
5. Verify the npm package version, provenance, install from a clean environment, GitHub release, and `https://pi.dev/packages` listing. Report delayed catalog indexing as pending; never claim listing before it is observable.

The release workflow is deliberately manual and tag-gated. It does not publish on pushes, and it cannot replace repository permissions, npm Trusted Publishing configuration, environment protection, or explicit maintainer approval.
