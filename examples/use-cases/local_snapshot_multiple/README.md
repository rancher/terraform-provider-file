# Multiple Snapshot Use Case

This is an example of snapshotting the same file multiple times.
This show the same operations as the basic example,
 but it shows that you can have multiple snapshots working in parallel on the same file without collisions.

# Updating the snapshot

To get the snapshot to update you can send in the "update" argument and change it.
The snapshot will update on that apply and remain static until the update argument is changed again.

# Base 64 Decode

Notice that the snapshot outputs use base64decode to return the actual file's value.

# Snapshots are Sensitive

You could achieve the goals of this resource using a terraform_data with some life-cycle options, except for this part.
The Snapshot resource's "snapshot" attribute is sensitive, this keeps sensitive or long files from being spewed into the logs.
