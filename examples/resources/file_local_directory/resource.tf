
resource "file_local_directory" "basic_example" {
  path        = "path/to/new/directory"
  permissions = "0700"
}
