# Compressed Snapshot Use Case

This is an example of how you could use the file_local_snapshot resource.
WARNING! Please remember that Terraform must load the entire state into memory,
 make sure you have the resources available on the machine running Terraform to handle any file you save like this.

This shows how to use the compress argument.
We wanted a way to compress the data that we are saving into the state so that we can store larger files
 without running the machine running Terraform out of memory.

We use the uuid() function for testing purposes, every update the file will be changed and the snapshot will remain the same.

# Updating the snapshot

To get the snapshot to update you can send in the "update" argument and change it.
The snapshot will update on that apply and remain static until the update argument is changed again.

# Getting the data back out of the file

The snapshot data will be compressed and base64 encoded, so retrieving the actual contents is a little bit harder.

This is why we made the Snapshot datasource, given a snapshot output it can decode the contents into usable text?
