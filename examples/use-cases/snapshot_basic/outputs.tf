
output "pesky_id" {
  value = local.pesky_id
}

output "snapshot" {
  value = file_snapshot.example.snapshot
}
