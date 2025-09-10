

provider "file" {}

locals {
  directory = (var.directory == "" ? "." : var.directory)
  name      = (var.name == "" ? "snapshot_use_case_test.txt" : var.name)
  update    = (var.update == "" ? "code-change-necessary" : var.update)
  pesky_id  = uuid()
}

# We use a terraform_data resource to write a file
#   then we update the file using a terraform_data resource
#   then we get the contents of the file using a file_local resource
#   then we snapshot the contents using a file_snapshot resource
#   then we output both the file_local and file_snapshot
# On first run the outputs will match, on subsequent runs the outputs won't match.
#   the output for the file will always be a new uuid, while the snapshot will be the first uuid
# When the update argument is changed, then the snapshot will match the file_local again
#   and again on subsequent runs the snapshot will remain the same while the file always changes
resource "file_local" "example" {
  name     = local.name
  contents = "this is an example file that is used to show how snapshots work"
}
# this always updates the file
resource "terraform_data" "update_file" {
  depends_on = [
    file_local.example,
  ]
  triggers_replace = [
    local.pesky_id
  ]
  provisioner "local-exec" {
    command = <<-EOT
      printf '${local.pesky_id}' > ${local.name}
    EOT
  }
}
# since the update will always run, make sure to always get the data
data "file_local" "example_after_update" {
  depends_on = [
    file_local.example,
    terraform_data.update_file,
  ]
  name      = local.name
  directory = local.directory
}

# the snapshot will always be a uuid because the pesky update_file runs before it in the chain
# however, it will always be the same uuid until the update argument is changed
resource "file_snapshot" "example" {
  depends_on = [
    file_local.example,
    terraform_data.update_file,
    data.file_local.example_after_update,
  ]
  contents       = data.file_local.example_after_update.contents
  update_trigger = local.update
}
