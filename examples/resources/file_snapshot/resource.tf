
# basic use case
resource "file_local" "snapshot_file_basic_example" {
  name     = "snapshot_resource_basic_example.txt"
  contents = "this is an example file that is used to show how snapshots work"
}
resource "file_snapshot" "basic_example" {
  depends_on = [
    file_local.snapshot_file_basic_example,
  ]
  name           = "snapshot_resource_basic_example.txt"
  update_trigger = "an arbitrary string"
}
output "snapshot_basic" {
  value     = file_snapshot.basic_example.snapshot
  sensitive = true
}

# A more advanced use case:
# We use a file_local resource to write a local file in the current directory
#   then we create a snapshot of the file using file_snapshot
#   then we update the file using a terraform_data resource
#   then we get the contents of the file using a file_local datasource
#   then we output both the file_local datasource and file_snapshot resource, observing that they are different
resource "file_local" "snapshot_file_example" {
  name     = "snapshot_resource_test.txt"
  contents = "this is an example file that is used to show how snapshots work"
}
resource "file_snapshot" "file_example" {
  depends_on = [
    file_local.snapshot_file_example,
  ]
  name           = "snapshot_resource_test.txt"
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
  name = "snapshot_resource_test.txt"
}

output "file" {
  value = data.file_local.snapshot_file_example_after_update.contents
  # this updates a file that is used to show how snapshots work
}
output "snapshot" {
  value     = base64decode(file_snapshot.file_example.snapshot)
  sensitive = true
  # this is an example file that is used to show how snapshots work
}
