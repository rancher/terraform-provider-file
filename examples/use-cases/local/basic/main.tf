

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

data "file_local" "basic" {
  name      = file_local.basic.name
  directory = file_local.basic.directory
}
