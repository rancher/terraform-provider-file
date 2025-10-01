# Basic Snapshot Use Case

This is an example of how you could use the file_snapshot resource.
WARNING! Please remember that Terraform must load the entire state into memory,
 ensure you have enough memory on the server running Terraform to store or retrieve the data you are storing.
For larger files, please see the snapshot_compressed use-case for more details.

We use the uuid() function for testing purposes.
Every update, the file will be changed and the snapshot will remain the same.

# Updating the snapshot

To get the snapshot to update you can send in the "update" argument and change it.
The snapshot will update on that apply and remain static until the update argument is changed again.

# Base 64 Decode

Notice that the snapshot outputs use base64decode to return the actual file's value.

# Snapshots are Sensitive

You could achieve the goals of this resource using a terraform_data with some life-cycle options, except for this part.
The Snapshot resource's "snapshot" attribute is sensitive, this keeps sensitive or long files from being spewed into the logs.
