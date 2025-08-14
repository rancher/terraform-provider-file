# Copyright (c) HashiCorp, Inc.

# This example overrides the TF_FILE_HMAC_SECRET_KEY environment variable with an explicit key.
resource "file_local" "protected" {
  protected       = true
  id              = "dbdbdd3ed57491955a5b2eb8d3a053f2e68571cf24b4f9ac2b2342f5d208fd4c"
  name            = "protected_example_a.txt"
  contents        = "An example implementation of a protected file."
  hmac_secret_key = "this-is-a-super-secret-key"
}

# This example expects the `TF_FILE_HMAC_SECRET_KEY` environment variable to be set to "thisisasupersecretkey"
# If the environment variable isn't set, then the provider will error, asking for a secret key to be set.
resource "file_local" "protected_env" {
  protected = true
  id        = "a57c553091a64b5beaee4589b2ae5475eaca4ad321e4468bce003323e55cc320"
  name      = "protected_example_b.txt"
  contents  = "An example implementation of a protected file."
}
