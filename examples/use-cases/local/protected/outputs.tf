

output "file_resource" {
  value     = jsonencode(file_local.protected)
  sensitive = true
}

output "file_resource_env" {
  value     = jsonencode(file_local.protected_env)
  sensitive = true
}

output "file_data_source" {
  value     = jsonencode(data.file_local.protected)
  sensitive = true
}
