
output "pesky_id" {
  value = local.pesky_id
}

output "snapshots" {
  value = [
    for s in file_local_snapshot.use_case_multiple : base64decode(s.snapshot)
  ]
  sensitive = true
}
