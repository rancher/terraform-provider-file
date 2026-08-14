# Terraform Provider File

- A resource and a data source (`internal/provider/`),
- Examples (`examples/`) and generated documentation (`docs/`),
- Miscellaneous meta files.

## Requirements

- [Terraform](https://developer.hashicorp.com/terraform/downloads) >= 1.5
- [Go](https://golang.org/doc/install) >= 1.23

## Building The Provider

1. Clone the repository
1. Enter the repository directory
1. Build the provider using the Make `build` command:

```shell
make build
```

## Adding Dependencies

This provider uses [Go modules](https://github.com/golang/go/wiki/Modules).
Please see the Go documentation for the most up to date information about using Go modules.

To add a new dependency `github.com/author/dependency` to your Terraform provider:

```shell
go get github.com/author/dependency
go mod tidy
```

Then commit the changes to `go.mod` and `go.sum`.

There are two levels of dependency, one is for the dev, test, and build environment,
the other is the Go dependencies as listed above.
We use Nix to manage environment dependencies.
You can install Nix using their scripts: <https://nixos.org/download/>
After that you can enter the development environment using the "flake.nix" file in the root of the repo.
Once Nix is installed source the .envrc and it should manage everything for you.
If this is your first flake, you may need to initialize flakes for this directory.

To initialize flakes:

- `mv flake.nix flake.new`
- `nix --extra-experimental-features flakes --extra-experimental-features nix-command flake init`
- `mv flake.new flake.nix`

## Using the provider

```terraform
# this provider has no configuration currently
provider "file" {}

resource "file_local" "basic_example" {
  name     = "example.txt"
  contents = "An example implementation writing a local file."
}
```

Please see the docs at <https://registry.terraform.io/providers/rancher/file/latest/docs> for more information.

## Developing the Provider

If you wish to work on the provider, you'll first need [Go](http://www.golang.org) installed on your machine (see [Requirements](#requirements) above).

To compile the provider, run `make build`. This will build the provider and put the provider binary in the `$GOPATH/bin` directory.

To generate or update documentation, run `make generate`.

In order to run the full suite of Unit tests, run `make test`.

In order to run the full suite of Acceptance tests, run `make testacc`.

```shell
make testacc
```

To build, generate, and run all tests, run `make`.

## Release Process

This repository utilizes a fully automated, event-driven PR verification and release lifecycle. For a comprehensive overview of how changes are checked, proxy-approved, squash-merged, and published (including our secure Nix tooling and GoReleaser signing workflows), please see our authoritative project standard: **[RELEASING.md](RELEASING.md)**.

## Releasing Workflow Changes (Enterprise Security Compliance)

Due to GitHub's server-side push validation and security model, the standard `GITHUB_TOKEN` is prevented from possessing `workflows: write` privileges. This means that if any release contains modifications to GitHub Actions workflow files (under `.github/workflows/`), automated pipelines (including `release-please` and `GoReleaser`) will be rejected by GitHub when attempting to create and push the release tag.

Since development in this repository takes place on personal forks, maintainers releasing workflow changes must manually push the release tag to the official **upstream** repository from their local machine to bypass this restriction securely:

1. **Manually Tag Main:**

   ```shell
   # 1. Add the upstream remote if you haven't already
   git remote add upstream git@github.com:rancher/terraform-provider-file.git

   # 2. Fetch latest changes from upstream
   git fetch upstream

   # 3. Create the tag locally pointing to upstream/main
   git tag vX.Y.Z upstream/main

   # 4. Push the tag directly to the upstream repository
   git push upstream vX.Y.Z
   ```

2. **Merge the Release PR on GitHub.**

3. **Everything works exactly like it should!**
   - The automated `Release` workflow triggers on the merge push to the upstream `main` branch.
   - `release-please` runs, detects the merged PR, and generates the perfect release notes.
   - Since the tag already exists on `upstream`, the workflow **gracefully skips tag pushing** (preventing any GITHUB_TOKEN authentication failures).
   - GoReleaser cleanly compiles the binaries, signs them with GPG, and publishes the official release with the perfect release-please notes under your manually created tag!

### What if the release PR has already merged?

You will need to use the manual release process, but again you will need to manually tag.

1. **Manually Tag Main:**

   ```shell
   # 1. Add the upstream remote if you haven't already
   git remote add upstream git@github.com:rancher/terraform-provider-file.git

   # 2. Fetch latest changes from upstream
   git fetch upstream

   # 3. Create the tag locally pointing to upstream/main
   git tag vX.Y.Z upstream/main

   # 4. Push the tag directly to the upstream repository
   git push upstream vX.Y.Z
   ```

2. **Trigger the "Manually Create Full Release" Workflow:**
   Set the tag to the tag you created, set the sha to the sha of the tag.
   GoReleaser will pick things up and create the release for you, but the release notes won't be as pretty.
