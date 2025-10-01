
output "pesky_id" {
  value = local.pesky_id
}

output "snapshot" {
  value     = base64decode(file_local_snapshot.use_case_basic.snapshot)
  sensitive = true
}
