# Basic Snapshot Use Case

This is a basic example of how you could use the file_snapshot resource.
This config creates a file, takes a snapshot of the file, updates the file, 
retrieves in the updated contents, then outputs the file's contents and the snapshot contents.

We use the uuid() function for testing purposes, every update the file will be changed and the snapshot will remain the same.

# Updating the snapshot

To get the snapshot to update you can send in the "update" argument and change it.
The snapshot will update on that apply and remain static until the update argument is changed again.
