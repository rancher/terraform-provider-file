# Boilerplate

This is boilerplate code to get a contributor started writing a new resource.
Just copy and paste this whole directory into the internal/provider directory or 
copy the files and add to an existing directory there.
What you get is a fully testable stub that you can use to shape your new resource.
With the forms already in place for unit testing, just update the logic and you are good to go.

# What this doesn't cover

- This is just a stub, you need to write out the logic for your resource and write affective unit test cases.
- You need to write out your client and the client you are going to use for testing.
- You need to add your resource to the provider's "Resources" function, as well as add the package to the provider's inputs.
- You need to write e2e tests for your resource, see the test directory for more on that.
- You need to add an example in the examples directory, see the examples directory for more on that.

# These unit tests are too functional

You need to use the client code affectively to inject a testing client into your tests.
This allows you to test only the logic in the provider.
Make sure your clients don't do too much or you will end up not testing anything worth while.

# Should I test the client?

In most cases the client is a 3rd party API, it should be tested where it is written, not here.
If you feel there is a lot of logic in your client then you probably need to push that into the provider instead.
Try to limit your client to a few calls to another API, mirror too closely and you won't be able to test errors effectively,
mirror too loosely and you might end up putting too much logic into the client.

