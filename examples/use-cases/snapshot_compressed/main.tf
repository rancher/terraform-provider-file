
provider "file" {}

locals {
  pesky_id  = uuid() // this is for testing purposes only, any file which changes outside of Terraform could be used
  update    = var.update
  name      = var.name
  directory = var.directory
}
# on first update the pesky_id and the snapshot output will match
# on subsequent updates the snapshot output will stay the same and the pesky_id will change
# when the update input is changed, then the snapshot output will match the pesky_id again

resource "file_local" "snapshot_use_case_compressed" {
  name      = local.name
  directory = local.directory
  contents  = local.pesky_id
}
resource "file_snapshot" "use_case_compressed" {
  depends_on = [
    file_local.snapshot_use_case_compressed,
  ]
  name           = local.name
  directory      = local.directory
  update_trigger = local.update
  compress       = true
}
data "file_snapshot" "use_case_compressed" {
  depends_on = [
    file_local.snapshot_use_case_compressed,
    file_snapshot.use_case_compressed,
  ]
  contents   = file_snapshot.use_case_compressed.snapshot
  decompress = true
}
