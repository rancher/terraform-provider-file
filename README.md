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
You can install Nix using their scripts: https://nixos.org/download/
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

Please see the docs at https://registry.terraform.io/providers/rancher/file/latest/docs for more information.

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
