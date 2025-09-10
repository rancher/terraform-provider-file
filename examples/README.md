# Examples

This directory contains examples that are used for documentation, and can be run/tested via the Terraform CLI.
The use-cases directory is full of examples that we test automatically before release.

The document generation tool looks for files in the following locations by default. All other *.tf files besides the ones mentioned below are ignored by the documentation tool. This is useful for creating examples that can run and/or are testable even if some parts are not relevant for the documentation.
Note that the resource class must be imported to the provider and listed under the provider "Resources" function before the doc tools will look for them.

* **provider/provider.tf** example file for the provider index page
* **data-sources/`full data source name`/data-source.tf** example file for the named data source page
* **resources/`full resource name`/resource.tf** example file for the named data source page

## Use cases

The examples in the following location show full working solutions using the provider.
The idea is to both give context to the resources involved and to give real tested examples of how to use the provider.

* **use-cases/`arbitrary name`/**
