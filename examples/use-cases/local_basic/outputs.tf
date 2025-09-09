

output "file_resource" {
  value     = jsonencode(file_local.basic)
  sensitive = true
}

output "file_data_source" {
  value     = jsonencode(data.file_local.basic)
  sensitive = true
}
