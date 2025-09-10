

resource "file_snapshot" "basic_example" {
  contents       = "An example implementation, saving contents to state."
  update_trigger = "an arbitrary string"
}


# A more advanced use case:
# We use a terraform_data resource to write a file
#   then we create a snapshot of the file using file_snapshot
#   then we update the file using a terraform_data resource
#   then we get the contents of the file using a file_local resource
#   then we output both the file_local and file_snapshot, observing that they are different
resource "file_local" "snapshot_file_example" {
  name     = "snapshot_resource_test.txt"
  contents = "this is an example file that is used to show how snapshots work"
}
resource "file_snapshot" "file_example" {
  depends_on = [
    file_local.snapshot_file_example,
  ]
  contents       = file_local.snapshot_file_example.contents
  update_trigger = "code-change-necessary"
}
resource "terraform_data" "update_file" {
  depends_on = [
    file_local.snapshot_file_example,
    file_snapshot.file_example,
  ]
  provisioner "local-exec" {
    command = <<-EOT
      printf 'this updates a file that is used to show how snapshots work' > snapshot_resource_test.txt
    EOT
  }
}
data "file_local" "snapshot_file_example_after_update" {
  depends_on = [
    file_local.snapshot_file_example,
    file_snapshot.file_example,
    terraform_data.update_file,
  ]
  name      = "snapshot_resource_test.txt"
  directory = "."
}

output "file" {
  value = data.file_local.snapshot_file_example_after_update.contents
  # this updates a file that is used to show how snapshots work
}
output "snapshot" {
  value = file_snapshot.file_example.contents
  # this is an example file that is used to show how snapshots work
}
