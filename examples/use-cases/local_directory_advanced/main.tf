

provider "file" {}

locals {
  path = var.path
}

resource "file_local_directory" "basic" {
  path = local.path
}

resource "file_local" "a" {
  depends_on = [
    file_local_directory.basic,
  ]
  name      = "a"
  directory = local.path
  contents  = "An example file to place in the directory."
}
resource "file_local" "b" {
  depends_on = [
    file_local_directory.basic,
  ]
  name      = "b"
  directory = local.path
  contents  = "An example file to place in the directory."
}
resource "file_local" "c" {
  depends_on = [
    file_local_directory.basic,
  ]
  name      = "c"
  directory = local.path
  contents  = "An example file to place in the directory."
}

data "file_local_directory" "basic" {
  depends_on = [
    file_local_directory.basic,
    file_local.a,
    file_local.b,
    file_local.c,
  ]
  path = local.path
}

resource "file_local" "directory_info" {
  depends_on = [
    file_local_directory.basic,
    file_local.a,
    file_local.b,
    file_local.c,
    data.file_local_directory.basic,
  ]
  name      = "directory_info.txt"
  directory = local.path
  contents  = jsonencode(data.file_local_directory.basic)
}

resource "file_local_snapshot" "directory_snapshot" {
  depends_on = [
    file_local_directory.basic,
    file_local.a,
    file_local.b,
    file_local.c,
    data.file_local_directory.basic,
    file_local.directory_info,
  ]
  name           = "directory_info.txt"
  directory      = local.path
  update_trigger = "manual"
}
