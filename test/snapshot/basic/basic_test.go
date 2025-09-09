package basic

import (
	"path/filepath"
	"testing"

  "github.com/gruntwork-io/terratest/modules/terraform"
	util "github.com/rancher/terraform-provider-file/test"
  "github.com/stretchr/testify/assert"
)

func TestSnapshotBasic(t *testing.T) {
	t.Parallel()

	id := util.GetId()
	directory := "snapshot_basic"
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
			"name":      "basic_test.txt",
		},
		BackendConfig: map[string]interface{}{
			"path": statePath,
		},
		EnvVars: map[string]string{
			"TF_DATA_DIR":         testDir,
			"TF_CLI_CONFIG_FILE":  filepath.Join(repoRoot, "test", ".terraformrc"),
			"TF_IN_AUTOMATION":    "1",
			"TF_CLI_ARGS_init":    "-no-color",
			"TF_CLI_ARGS_plan":    "-no-color",
			"TF_CLI_ARGS_apply":   "-no-color",
			"TF_CLI_ARGS_destroy": "-no-color",
			"TF_CLI_ARGS_output":  "-no-color",
		},
		RetryableTerraformErrors: util.GetRetryableTerraformErrors(),
		NoColor:                  true,
		Upgrade:                  true,
		// ExtraArgs:                terraform.ExtraArgs{ Output: []string{"-json"} },
	})

	_, err = terraform.InitAndApplyE(t, terraformOptions)
	if err != nil {
		t.Log("Test failed, tearing down...")
		util.TearDown(t, testDir, terraformOptions)
		t.Fatalf("Error creating file: %s", err)
	}
	outputs, err := terraform.OutputAllE(t, terraformOptions)
	if err != nil {
		t.Log("Output failed, moving along...")
	}

  pesky_id := outputs["pesky_id"]
  snapshot := outputs["snapshot"]
  a := assert.New(t)
  a.Equal(pesky_id, snapshot, "On the first run the snapshot will match the id.")

  _, err = terraform.InitAndApplyE(t, terraformOptions)
	if err != nil {
		t.Log("Test failed, tearing down...")
		util.TearDown(t, testDir, terraformOptions)
		t.Fatalf("Error creating file: %s", err)
	}
	outputs, err = terraform.OutputAllE(t, terraformOptions)
	if err != nil {
		t.Log("Output failed, moving along...")
	}

  pesky_id = outputs["pesky_id"]
  snapshot = outputs["snapshot"]
  a.NotEqual(pesky_id, snapshot, "On subsequent runs the id will change, but the snapshot won't.")

	if t.Failed() {
		t.Log("Test failed...")
	} else {
		t.Log("Test passed...")
	}
	t.Log("Test complete, tearing down...")
	util.TearDown(t, testDir, terraformOptions)
}
