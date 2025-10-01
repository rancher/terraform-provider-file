# Local Directory Use Case

This is a more advanced use case for adding a directory.

The goal of this use case is to retrieve the files in the directory at a specific point in time.
We don't want the live data because we add files that we don't want included in the output.

These are the steps:
1. we generate a directory
2. add files to it
3. get the directory data
4. save the directory data to a file in the directory
5. snapshot the directory data
6. output the snapshot

The resulting output will always be the files we first placed in the directory excluding the directory data file.

On the initial run the directory data will match the snapshot,
 but on subsequent runs the refresh phase will update the directory data to include the directory data file.
Our snapshot data will always exclude this file though, since it only updates when we alter the update trigger.
