
provider "file" {}

locals {
  update    = (var.update == "" ? "code-change-necessary" : var.update)
  pesky_id  = uuid()
  name      = var.name
  directory = var.directory
  count     = 5
  files     = [for i in range(local.count) : format("%s_%d", local.name, i)]
}
# on first update the pesky_id and the snapshot will match
# on subsequent updates the snapshot will remain as the first id and the pesky_id will change
# when the update input is changed, then the snapshot will match again

resource "file_local" "snapshot_use_case_multiple" {
  name      = local.name
  directory = local.directory
  contents  = local.pesky_id
}

resource "file_local_snapshot" "use_case_multiple" {
  depends_on = [
    file_local.snapshot_use_case_multiple,
  ]
  for_each       = toset(local.files)
  name           = local.name
  directory      = local.directory
  update_trigger = local.update
}
