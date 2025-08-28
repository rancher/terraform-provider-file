# Copyright (c) HashiCorp, Inc.

resource "file_local" "basic_example" {
  name     = "example.txt"
  contents = "An example implementation writing a local file."
}

resource "file_local" "protected_example" {
  name     = "protected.txt"
  contents = <<-EOF
    This file can't be updated or deleted without the proper id.
    Calculating the proper id requires knowing the HMAC secret that was used to generate the previous state.
    You can securely pass the secret key using the TF_FILE_HMAC_SECRET_KEY environment variable.
    Before an update or delete operation can begin the provider calculates the id of the previous contents.
    If the previous contents can't be calculated using current key then the provider errors.
    The key used to calculate the id field in this resource is 'this-is-an-example-key'.
    I used the following command to make the calculation: $(openssl dgst -sha256 -hmac "this-is-an-example-key" "$FILE" | awk '{print $2}').

  EOF
  id       = "2b13b6d5e32a0a0bd19fe95c44044aed72b677efd9a9db3f9a37f9bb8b0a893e"
}
