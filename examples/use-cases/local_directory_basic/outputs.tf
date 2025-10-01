

output "directory_resource" {
  value = jsonencode(file_local_directory.basic)
}

output "directory_data_source" {
  value = jsonencode(data.file_local_directory.basic)
}
