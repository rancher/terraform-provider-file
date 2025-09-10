
provider "file" {}

locals {
  update   = (var.update == "" ? "code-change-necessary" : var.update)
  pesky_id = uuid()
}
# on first update the pesky_id and the snapshot will match
# on subsequent updates the snapshot will remain as the first id and the pesky_id will change
# when the update input is changed, then the snapshot will match again
resource "file_snapshot" "example" {
  contents       = local.pesky_id
  update_trigger = local.update
}
