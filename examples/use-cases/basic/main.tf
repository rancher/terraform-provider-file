# Copyright (c) HashiCorp, Inc.

provider "file" {}

locals {
  directory = (var.directory == "" ? "." : var.directory)
  name      = (var.name == "" ? "basic_example.txt" : var.name)
}

resource "file_local" "basic" {
  name      = local.name
  directory = local.directory
  contents  = "An example of the \"most basic\" implementation writing a local file."
}
