# Copyright (c) HashiCorp, Inc.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    file = {
      source  = "rancher/file"
      version = ">= 0.0.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.7.2"
    }
  }
}
