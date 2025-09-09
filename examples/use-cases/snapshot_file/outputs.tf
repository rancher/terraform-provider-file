
output "file" {
  value = data.file_local.example_after_update.contents
}

output "snapshot" {
  value = file_snapshot.example.contents
}
