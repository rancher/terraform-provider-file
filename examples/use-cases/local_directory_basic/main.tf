

provider "file" {}

locals {
  path = var.path
}

resource "file_local_directory" "basic" {
  path = local.path
}

data "file_local_directory" "basic" {
  depends_on = [
    file_local_directory.basic,
  ]
  path = local.path
}
