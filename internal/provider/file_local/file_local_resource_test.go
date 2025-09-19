// SPDX-License-Identifier: MPL-2.0

package file_local

import (
	"context"
	"slices"
	"strconv"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
	c "github.com/rancher/terraform-provider-file/internal/provider/file_client"
)

const (
	defaultId            = ""
	defaultDirectory     = "."
	defaultPerm          = "0600"
	defaultProtected     = "false"
	defaultHmacSecretKey = ""
)

var booleanFields = []string{"protected", "fake"}

func TestLocalResourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalResource
			want resource.MetadataResponse
		}{
			{"Basic test", LocalResource{}, resource.MetadataResponse{TypeName: "file_local"}},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				res := resource.MetadataResponse{}
				tc.fit.Metadata(context.Background(), resource.MetadataRequest{ProviderTypeName: "file"}, &res)
				got := res
				if got != tc.want {
					t.Errorf("%#v.Metadata() is %v; want %v", tc.fit, got, tc.want)
				}
			})
		}
	})
}

func TestLocalSchema(t *testing.T) {
	t.Run("Schema function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalResource
			want resource.SchemaResponse
		}{
			{"Basic test", LocalResource{}, *getLocalResourceSchema()},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := resource.SchemaResponse{}
				tc.fit.Schema(context.Background(), resource.SchemaRequest{}, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Schema() mismatch (-want +got):\n%s", diff)
				}
			})
		}
	})
}

func TestLocalResourceCreate(t *testing.T) {
	t.Run("Create function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalResource
			have resource.CreateRequest
			want resource.CreateResponse
		}{
			{
				"Basic",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getCreateRequest(t, map[string]string{
					"id":              defaultId,
					"name":            "test_basic.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a basic test",
					"protected":       defaultProtected,
					"hmac_secret_key": defaultHmacSecretKey, // this should use the hard coded hmac secret key for unprotected files
				}),
				// want
				getCreateResponse(t, map[string]string{
					"id":              "3de642fb91d2fb0ce02fe66c3d19ebdf44cbc6a2ebcc2dad22f1950b67c1217f",
					"name":            "test_basic.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a basic test",
					"protected":       defaultProtected,
					"hmac_secret_key": defaultHmacSecretKey,
				}),
			},
			{
				"Protected",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getCreateRequest(t, map[string]string{
					"id":              "4ccd8ec7ea24e0524c8aba459fbf3a2649ec3cd96a1c8f9dfb326cc57a9d3127",
					"name":            "test_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a test",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// want
				getCreateResponse(t, map[string]string{
					"id":              "4ccd8ec7ea24e0524c8aba459fbf3a2649ec3cd96a1c8f9dfb326cc57a9d3127",
					"name":            "test_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a test",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
			},
			{
				"Protected using key from environment",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getCreateRequest(t, map[string]string{
					"id":              "59fed8691a76c7693fc9dcd4fda28390a1fd3090114bc64f3e5a3abe312a92f5",
					"name":            "test_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a test",
					"protected":       "true",
					"hmac_secret_key": defaultHmacSecretKey, // this relies on TF_FILE_HMAC_SECRET_KEY=thisisasupersecretkey in your environment
				}),
				// want
				getCreateResponse(t, map[string]string{
					"id":              "59fed8691a76c7693fc9dcd4fda28390a1fd3090114bc64f3e5a3abe312a92f5",
					"name":            "test_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a test",
					"protected":       "true",
					"hmac_secret_key": defaultHmacSecretKey,
				}),
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				var plannedState LocalResourceModel
				if diags := tc.have.Plan.Get(context.Background(), &plannedState); diags.HasError() {
					t.Errorf("Failed to get planned state: %v", diags)
				}
				plannedProtected := plannedState.Protected.ValueBool()
				plannedHmacSecretKey := plannedState.HmacSecretKey.ValueString()
				plannedDirectory := plannedState.Directory.ValueString()
				plannedName := plannedState.Name.ValueString()
				if plannedProtected && plannedHmacSecretKey == "" {
					t.Setenv("TF_FILE_HMAC_SECRET_KEY", "thisisasupersecretkey")
				}
				r := getCreateResponseContainer()
				tc.fit.Create(context.Background(), tc.have, &r)
				defer func() {
					if err := tc.fit.client.Delete(plannedDirectory, plannedName); err != nil {
						t.Errorf("Error cleaning up: %v", err)
					}
				}()
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Create() mismatch (-want +got):\n%s", diff)
				}
			})
		}
	})
}

func TestLocalResourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalResource
			have  resource.ReadRequest
			want  resource.ReadResponse
			setup map[string]string
		}{
			{
				"Unprotected",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getReadRequest(t, map[string]string{
					"id":              "60cef95046105ff4522c0c1f1aeeeba43d0d729dbcabdd8846c317c98cac60a2",
					"name":            "read.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is an unprotected read test",
					"protected":       defaultProtected,
					"hmac_secret_key": defaultHmacSecretKey,
				}),
				// want
				getReadResponse(t, map[string]string{
					"id":              "60cef95046105ff4522c0c1f1aeeeba43d0d729dbcabdd8846c317c98cac60a2",
					"name":            "read.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is an unprotected read test",
					"protected":       defaultProtected,
					"hmac_secret_key": defaultHmacSecretKey,
				}),
				map[string]string{
					"mode":      defaultPerm,
					"directory": defaultDirectory,
					"name":      "read.tmp",
					"contents":  "this is an unprotected read test",
				},
			},
			{
				"Protected",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getReadRequest(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// want
				getReadResponse(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// reality
				map[string]string{
					"mode":      defaultPerm,
					"directory": defaultDirectory,
					"name":      "read_protected.tmp",
					"contents":  "this is a protected read test",
				},
			},
			{
				"Protected with content update",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getReadRequest(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected_content.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// want
				getReadResponse(t, map[string]string{
					"id":              "84326116e261654e44ca3cb73fa026580853794062d472bc817b7ec2c82ff648",
					"name":            "read_protected_content.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a change in contents in the real file",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// reality
				map[string]string{
					"mode":      defaultPerm,
					"directory": defaultDirectory,
					"name":      "read_protected_content.tmp",
					"contents":  "this is a change in contents in the real file",
				},
			},
			{
				"Protected with mode update",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getReadRequest(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected_mode.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// want
				getReadResponse(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected_mode.tmp",
					"directory":       defaultDirectory,
					"permissions":     "0755",
					"contents":        "this is a protected read test",
					"protected":       "true",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// reality
				map[string]string{
					"mode":      "0755",
					"directory": defaultDirectory,
					"name":      "read_protected_mode.tmp",
					"contents":  "this is a protected read test",
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				if err := tc.fit.client.Create(tc.setup["directory"], tc.setup["name"], tc.setup["contents"], tc.setup["mode"]); err != nil {
					t.Errorf("Error setting up: %v", err)
				}
				defer func() {
					if err := tc.fit.client.Delete(tc.setup["directory"], tc.setup["name"]); err != nil {
						t.Errorf("Error tearing down: %v", err)
					}
				}()
				r := getReadResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%s", diff)
				}
			})
		}
	})
}
func TestLocalResourceUpdate(t *testing.T) {
	t.Run("Update function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalResource
			have  resource.UpdateRequest
			want  resource.UpdateResponse
			setup map[string]string
		}{
			{
				"Basic test",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getUpdateRequest(t, map[string]map[string]string{
					"priorState": {
						"id":              defaultId,
						"name":            "update_basic.tmp",
						"directory":       defaultDirectory,
						"permissions":     defaultPerm,
						"contents":        "this is an update test",
						"protected":       defaultProtected,
						"hmac_secret_key": defaultHmacSecretKey,
					},
					"plan": {
						"id":              defaultId,
						"name":            "update_basic.tmp",
						"directory":       defaultDirectory,
						"permissions":     defaultPerm,
						"contents":        "this is a basic update test",
						"protected":       defaultProtected,
						"hmac_secret_key": defaultHmacSecretKey,
					},
				}),
				// want
				getUpdateResponse(t, map[string]string{
					"id":              "0ec41eee6c157a3f7e50b78d586ee2ddb4d6e93b6de8bdf6d9354cf720e89549",
					"name":            "update_basic.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a basic update test",
					"protected":       defaultProtected,
					"hmac_secret_key": defaultHmacSecretKey,
				}),
				// setup
				map[string]string{
					"mode":      defaultPerm,
					"directory": defaultDirectory,
					"name":      "update_basic.tmp",
					"contents":  "this is an update test",
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				if err := tc.fit.client.Create(tc.setup["directory"], tc.setup["name"], tc.setup["contents"], tc.setup["mode"]); err != nil {
					t.Errorf("Error setting up: %v", err)
				}
				defer func() {
					if err := tc.fit.client.Delete(tc.setup["directory"], tc.setup["name"]); err != nil {
						t.Errorf("Error tearing down: %v", err)
					}
				}()
				r := getUpdateResponseContainer()
				tc.fit.Update(context.Background(), tc.have, &r)
				got := r
				var plannedState LocalResourceModel
				if diags := tc.have.Plan.Get(context.Background(), &plannedState); diags.HasError() {
					t.Errorf("Failed to get planned state: %v", diags)
				}
				plannedContents := plannedState.Contents.ValueString()
				_, contentsAfterUpdate, err := tc.fit.client.Read(plannedState.Directory.ValueString(), plannedState.Name.ValueString())
				if err != nil {
					t.Errorf("Failed to read file for update verification: %s", err)
				}
				if contentsAfterUpdate != plannedContents {
					t.Errorf("File content was not updated correctly. Got %q, want %q", contentsAfterUpdate, plannedContents)
				}
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%s", diff)
				}
			})
		}
	})
}

func TestLocalResourceDelete(t *testing.T) {
	t.Run("Delete function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalResource
			have  resource.DeleteRequest
			want  resource.DeleteResponse
			setup map[string]string
		}{
			{
				"Basic test",
				LocalResource{client: &c.MemoryFileClient{}},
				// have
				getDeleteRequest(t, map[string]string{
					"id":              "fd6fb8621c4850c228190f4d448ce30881a32609d6b4c7341d48d0027e597567",
					"name":            "delete.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a delete test",
					"protected":       defaultProtected,
					"hmac_secret_key": defaultHmacSecretKey,
				}),
				// want
				getDeleteResponse(),
				// setup
				map[string]string{
					"mode":      defaultPerm,
					"directory": defaultDirectory,
					"name":      "delete.tmp",
					"contents":  "this is a delete test",
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				if err := tc.fit.client.Create(tc.setup["directory"], tc.setup["name"], tc.setup["contents"], tc.setup["mode"]); err != nil {
					t.Errorf("Error setting up: %v", err)
				}
				r := getDeleteResponseContainer()
				tc.fit.Delete(context.Background(), tc.have, &r)
				got := r
				// Verify the file was actually deleted from disk
				if _, c, err := tc.fit.client.Read(tc.setup["directory"], tc.setup["name"]); err == nil || err.Error() != "file not found" {
					if err == nil {
						t.Errorf("Expected file to be delete, but it still exists. File contents: %s", c)
					}
					t.Errorf("Expected file to be deleted, but it still exists. Error: %s", err.Error())
				}
				// verify that the file was removed from state
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%s", diff)
				}
			})
		}
	})
}

// *** Test Helper Functions *** //

func getCreateRequest(t *testing.T, data map[string]string) resource.CreateRequest {
	planMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			if value == "" {
				planMap[key] = tftypes.NewValue(tftypes.Bool, tftypes.UnknownValue)
			} else {
				v, err := strconv.ParseBool(value)
				if err != nil {
					t.Errorf("Error converting %s to bool %s: ", value, err.Error())
				}
				planMap[key] = tftypes.NewValue(tftypes.Bool, v)
			}
		} else {
			if value == "" {
				planMap[key] = tftypes.NewValue(tftypes.String, tftypes.UnknownValue)
			} else {
				planMap[key] = tftypes.NewValue(tftypes.String, value)
			}
		}
	}
	planValue := tftypes.NewValue(getObjectAttributeTypes(), planMap)
	return resource.CreateRequest{
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getLocalResourceSchema().Schema,
		},
	}
}
func getCreateResponseContainer() resource.CreateResponse {
	return resource.CreateResponse{
		State: tfsdk.State{Schema: getLocalResourceSchema().Schema},
	}
}
func getCreateResponse(t *testing.T, data map[string]string) resource.CreateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getObjectAttributeTypes(), stateMap)
	return resource.CreateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalResourceSchema().Schema,
		},
	}
}

func getReadRequest(t *testing.T, data map[string]string) resource.ReadRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getObjectAttributeTypes(), stateMap)
	return resource.ReadRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalResourceSchema().Schema,
		},
	}
}
func getReadResponseContainer() resource.ReadResponse {
	return resource.ReadResponse{
		State: tfsdk.State{Schema: getLocalResourceSchema().Schema},
	}
}
func getReadResponse(t *testing.T, data map[string]string) resource.ReadResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getObjectAttributeTypes(), stateMap)
	return resource.ReadResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalResourceSchema().Schema,
		},
	}
}

func getUpdateRequest(t *testing.T, data map[string]map[string]string) resource.UpdateRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data["priorState"] {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	priorStateValue := tftypes.NewValue(getObjectAttributeTypes(), stateMap)

	planMap := make(map[string]tftypes.Value)
	for key, value := range data["plan"] {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			if value == "" {
				planMap[key] = tftypes.NewValue(tftypes.Bool, tftypes.UnknownValue)
			} else {
				v, err := strconv.ParseBool(value)
				if err != nil {
					t.Errorf("Error converting %s to bool %s: ", value, err.Error())
				}
				planMap[key] = tftypes.NewValue(tftypes.Bool, v)
			}
		} else {
			if value == "" {
				planMap[key] = tftypes.NewValue(tftypes.String, tftypes.UnknownValue)
			} else {
				planMap[key] = tftypes.NewValue(tftypes.String, value)
			}
		}
	}
	planValue := tftypes.NewValue(getObjectAttributeTypes(), planMap)

	return resource.UpdateRequest{
		State: tfsdk.State{
			Raw:    priorStateValue,
			Schema: getLocalResourceSchema().Schema,
		},
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getLocalResourceSchema().Schema,
		},
	}
}
func getUpdateResponseContainer() resource.UpdateResponse {
	return resource.UpdateResponse{
		State: tfsdk.State{Schema: getLocalResourceSchema().Schema},
	}
}
func getUpdateResponse(t *testing.T, data map[string]string) resource.UpdateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getObjectAttributeTypes(), stateMap)
	return resource.UpdateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalResourceSchema().Schema,
		},
	}
}

func getDeleteRequest(t *testing.T, data map[string]string) resource.DeleteRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getObjectAttributeTypes(), stateMap)
	return resource.DeleteRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalResourceSchema().Schema,
		},
	}
}
func getDeleteResponseContainer() resource.DeleteResponse {
	// A delete response does not need a schema as it results in a null state.
	return resource.DeleteResponse{}
}
func getDeleteResponse() resource.DeleteResponse {
	return resource.DeleteResponse{
		State: tfsdk.State{
			Raw:    tftypes.Value{},
			Schema: nil,
		},
	}
}

func getObjectAttributeTypes() tftypes.Object {
	return tftypes.Object{
		AttributeTypes: map[string]tftypes.Type{
			"id":              tftypes.String,
			"name":            tftypes.String,
			"directory":       tftypes.String,
			"permissions":     tftypes.String,
			"contents":        tftypes.String,
			"hmac_secret_key": tftypes.String,
			"protected":       tftypes.Bool,
		},
	}
}

func getLocalResourceSchema() *resource.SchemaResponse {
	var testResource LocalResource
	r := &resource.SchemaResponse{}
	testResource.Schema(context.Background(), resource.SchemaRequest{}, r)
	return r
}
