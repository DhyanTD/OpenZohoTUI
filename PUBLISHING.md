# Publishing OpenZohoTui to npm

The user-facing package is `@dhyantd/open-zoho-tui`. It installs the `ozt`
executable and depends on two public supporting packages from this monorepo.

| Publish order | Workspace package | Purpose |
| --- | --- | --- |
| 1 | `@dhyantd/open-zoho-tui-core` | local configuration, credentials, state, and embedded broker URL |
| 2 | `@dhyantd/open-zoho-tui-zoho-client` | Zoho Projects API client; depends on core |
| 3 | `@dhyantd/open-zoho-tui` | the `ozt` CLI/TUI; depends on both packages |

Users install only the third package. npm resolves the supporting packages
automatically.

## Public versus private distribution

These package manifests are configured for public npm publication. Public
packages can be downloaded by anyone, even though `UNLICENSED` reserves the
code's legal rights. Review the code and company policy before publishing.

If the source must remain private, publish to a paid private npm organization
or a company registry instead. That requires users to authenticate and
configure that registry first, so anonymous one-command installation is not
possible.

npm's official guide confirms that scoped packages must be published with
public visibility for anonymous installation: [Creating and publishing scoped
public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

## Maintainer prerequisites

1. Create or use the npm account named `dhyantd`, or create an npm organization
   with that exact scope and grant yourself publish access.
2. Enable two-factor authentication for publishing.
3. Make sure Node.js 22 or newer and npm are installed.
4. Log in to the public registry and verify the active identity:

   ```sh
   npm login --registry=https://registry.npmjs.org
   npm whoami --registry=https://registry.npmjs.org
   ```

Direct publication currently requires publishing 2FA or an appropriately
configured granular access token. See npm's
[scoped-package publishing requirements](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/#publishing-scoped-public-packages).

## First release

The repository currently uses version `0.1.0`. Confirm that none of these exact
package versions already exists:

```sh
npm view @dhyantd/open-zoho-tui-core version
npm view @dhyantd/open-zoho-tui-zoho-client version
npm view @dhyantd/open-zoho-tui version
```

An npm `E404` is expected before a package's first publication. If a version is
already present, bump versions before continuing; npm never permits replacing
an existing package version.

### 1. Build the production artifacts

Keep the broker URL exported for every build and test command. The test and
typecheck scripts rebuild packages and would otherwise replace the embedded URL
with the local fallback.

```sh
export OZT_DEFAULT_BROKER_URL=https://ozt-auth.example.com
npm ci
npm run build
npm test
npm run typecheck
```

The value embedded in `packages/core/dist/build-config.json` must be the public
HTTPS broker URL. Never place the Zoho Client ID, Client Secret, Redis URL, or
any user token in `OZT_DEFAULT_BROKER_URL` or package files.

### 2. Inspect exactly what npm will upload

```sh
npm pack --dry-run --workspace @dhyantd/open-zoho-tui-core
npm pack --dry-run --workspace @dhyantd/open-zoho-tui-zoho-client
npm pack --dry-run --workspace @dhyantd/open-zoho-tui
```

Only compiled `dist` files plus npm's standard metadata and README files should
appear. Stop if output contains `.env`, credentials, source maps you do not want
to distribute, local state, or unrelated repository files.

### 3. Publish in dependency order

```sh
npm publish --workspace @dhyantd/open-zoho-tui-core --access public
npm publish --workspace @dhyantd/open-zoho-tui-zoho-client --access public
npm publish --workspace @dhyantd/open-zoho-tui --access public
```

Enter the npm one-time password when prompted. Do not publish the private broker
workspace; the broker is deployed as a service, not installed by users.

### 4. Verify from a clean user environment

Check registry metadata:

```sh
npm view @dhyantd/open-zoho-tui@latest version bin engines dependencies
```

Then run the TUI directly from npm:

```sh
npx --yes --package=@dhyantd/open-zoho-tui@latest ozt --help
npx --yes --package=@dhyantd/open-zoho-tui@latest ozt
```

For a permanent installation:

```sh
npm install --global @dhyantd/open-zoho-tui@latest
ozt --version
ozt
```

The package requires Node.js 22 or newer. On first login, it should use the
broker URL embedded during the core-package build.

## Publishing an update

Choose a semantic version change:

- patch: bug fix with compatible behavior, for example `0.1.0` to `0.1.1`
- minor: compatible feature, for example `0.1.0` to `0.2.0`
- major: incompatible change after the project reaches a stable public API

For a coordinated patch release, update all three workspace versions without
creating automatic git tags:

```sh
npm version patch --no-git-tag-version --workspace @dhyantd/open-zoho-tui-core
npm version patch --no-git-tag-version --workspace @dhyantd/open-zoho-tui-zoho-client
npm version patch --no-git-tag-version --workspace @dhyantd/open-zoho-tui
npm install --package-lock-only
```

The current `^0.1.0` dependency ranges accept patch releases in the `0.1.x`
line. For a minor or major release, update the internal dependency ranges in
`packages/zoho-client/package.json` and `packages/cli/package.json` to the new
line before publishing.

Then repeat the complete build, test, pack inspection, publish order, and clean
install verification from the first-release procedure. Commit the manifest and
`package-lock.json` version changes with the release.

Existing users update with:

```sh
npm install --global @dhyantd/open-zoho-tui@latest
```

## Broker URL changes

`OZT_DEFAULT_BROKER_URL` is written into the core package during its build. If
the production broker URL changes:

1. bump and republish core
2. bump and republish the Zoho client and TUI for a clear coordinated release
3. tell users to update the global package

Users can switch immediately without waiting for a release:

```sh
ozt config set brokerUrl https://new-ozt-auth.example.com
```

Or for one invocation:

```sh
OZT_BROKER_URL=https://new-ozt-auth.example.com ozt
```

## Failed release handling

Do not try to overwrite a published version. Fix the problem, increment the
version, and publish again. If a published release should not be used, mark it
deprecated and point users to the corrected version:

```sh
npm deprecate @dhyantd/open-zoho-tui@0.1.1 "Use 0.1.2 instead"
```

Prefer deprecation over unpublishing because consumers or internal dependency
versions may already refer to the release.

## Optional publishing automation

After the manual first release works, npm Trusted Publishing can release from
GitHub Actions without storing a long-lived npm token. Configure each of the
three packages on npmjs.com with the same repository and release workflow, give
the workflow `id-token: write`, and continue publishing in dependency order.
Follow npm's current [Trusted Publishing
guide](https://docs.npmjs.com/trusted-publishers/) rather than adding a classic
automation token to the repository.
