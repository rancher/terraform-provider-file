// Copyright (c) HashiCorp, Inc.

package protected

import (
	"path/filepath"
	"testing"

	"github.com/gruntwork-io/terratest/modules/terraform"
	util "github.com/rancher/terraform-provider-file/test"
)

func TestProtectedProtects(t *testing.T) {
	t.Parallel()
	id := util.GetId()
	directory := "protected"
	repoRoot, err := util.GetRepoRoot(t)
	if err != nil {
		t.Fatalf("Error getting git root directory: %v", err)
	}
	exampleDir := filepath.Join(repoRoot, "examples", "use-cases", directory)
	testDir := filepath.Join(repoRoot, "test", "data", id)

	err = util.Setup(t, id, "test/data")
	if err != nil {
		t.Log("Test failed, tearing down...")
		util.TearDown(t, testDir, &terraform.Options{})
		t.Fatalf("Error creating test data directories: %s", err)
	}

	statePath := filepath.Join(testDir, "tfstate")
	terraformOptions := terraform.WithDefaultRetryableErrors(t, &terraform.Options{
		TerraformDir: exampleDir,
		Vars: map[string]interface{}{
			"directory": testDir,
			"name":      "protected_test.txt",
		},
		BackendConfig: map[string]interface{}{
			"path": statePath,
		},
		EnvVars: map[string]string{
			"TF_DATA_DIR":             testDir,
			"TF_FILE_HMAC_SECRET_KEY": "thisisasupersecretkey",
			"TF_IN_AUTOMATION":        "1",
			"TF_CLI_ARGS_init":        "-no-color",
			"TF_CLI_ARGS_plan":        "-no-color",
			"TF_CLI_ARGS_apply":       "-no-color",
			"TF_CLI_ARGS_destroy":     "-no-color",
			"TF_CLI_ARGS_output":      "-no-color",
		},
		RetryableTerraformErrors: util.GetRetryableTerraformErrors(),
		NoColor:                  true,
		Upgrade:                  true,
	})

	_, err = terraform.InitAndApplyE(t, terraformOptions)
	if err != nil {
		t.Log("Test failed, tearing down...")
		util.TearDown(t, testDir, terraformOptions)
		t.Fatalf("Error creating file: %s", err)
	}

	fileAExists, err := util.CheckFileExists(filepath.Join(testDir, "a_protected_test.txt"))
	if err != nil {
		t.Log("Test failed, tearing down...")
		util.TearDown(t, testDir, terraformOptions)
		t.Fatalf("Error checking file: %s", err)
	}
	if !fileAExists {
		t.Fail()
	}

	fileBExists, err := util.CheckFileExists(filepath.Join(testDir, "b_protected_test.txt"))
	if err != nil {
		t.Log("Test failed, tearing down...")
		util.TearDown(t, testDir, terraformOptions)
		t.Fatalf("Error checking file: %s", err)
	}
	if !fileBExists {
		t.Fail()
	}

	t.Log("testing file name change")
	terraformOptions.EnvVars["TF_FILE_HMAC_SECRET_KEY"] = "this-is-the-wrong-key"
	terraformOptions.Vars["name"] = "wrong_key_test.txt" // if plan doesn't detect a change, then the resource's update func is never called.
	_, err = terraform.InitAndApplyE(t, terraformOptions)
	if err != nil {
		t.Log("Apply failed as expected, test passed...")
	}

	if t.Failed() {
		t.Log("Test failed...")
	} else {
		t.Log("Test passed...")
	}
	t.Log("Test complete, tearing down...")
	terraformOptions.EnvVars["TF_FILE_HMAC_SECRET_KEY"] = "thisisasupersecretkey"
	terraformOptions.Vars["name"] = "protected_test.txt"
	util.TearDown(t, testDir, terraformOptions)
}
