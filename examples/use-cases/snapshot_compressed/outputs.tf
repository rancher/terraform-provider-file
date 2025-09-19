
output "pesky_id" {
  value = local.pesky_id
}

output "snapshot" {
  value     = data.file_snapshot.use_case_compressed.data
  sensitive = true
}
