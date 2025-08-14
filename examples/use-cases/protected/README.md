# Protected Use Case

In this use case you provide the Id for the file and expect alterations to the file to also include updates to the Id. 
If the "protected" argument is set to "true" then the Id argument must be set and must match the calculated Id.
The provider will throw an error if the contents of the file don't calculate to the Id sent.

## Calculating the Id

Calculating the Id is done with an HMAC secret key.
Below is a snippet of calculating the Id in bash, you can see the logic for calculating the hash in Go in the unit tests.
The secret key can be sent in to Terraform with the `TF_FILE_HMAC_SECRET_KEY` environment variable so that it stays out of the state,
or you can add it as an argument when creating the resource. 
```
echo "Test data" > data.txt
FILEPATH="./data.txt"
SECRET="super-secret-key"
IDENTIFIER="$(openssl dgst -sha256 -hmac "$SECRET" "$FILE" | awk '{print $2}')"
```

## How is This Secure

The contents of the file are saved unencrypted in the state in this example, so how is this protected?
Security is a complicated subject, this is the most basic form of security for this provider (meaning least secure that isn't the base example).
As the examples progress we will add more features to improve the security of your file.

This example is good for making sure that only certain people can alter a file,
if they don't have access to the HMAC secret they can't calculate the Id and therefore can't change the file contents,
thus the file is "protected" from unauthorized change.
