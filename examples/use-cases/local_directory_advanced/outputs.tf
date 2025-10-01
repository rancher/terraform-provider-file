

output "directory_resource" {
  value = jsonencode(file_local_directory.basic)
}

output "directory_data_source" {
  value = jsonencode(data.file_local_directory.basic)
}

output "snapshot" {
  value     = base64decode(file_local_snapshot.directory_snapshot.snapshot)
  sensitive = true
}
