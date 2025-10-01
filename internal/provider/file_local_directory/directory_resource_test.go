// SPDX-License-Identifier: MPL-2.0

package file_local_directory

import (
	"context"
	"slices"
	"strconv"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
	c "github.com/rancher/terraform-provider-file/internal/provider/directory_client"
)

const (
	defaultId      = ""
	defaultPerm    = "0700"
	defaultCreated = ""
	testPath       = "path/to/new/directory"
	// echo -n "path/to/new/directory" | sha256sum | awk '{print $1}' #.
	testId      = "2d020a0327fe0a114bf587a2b24894d67654203b0bd4428546ad5bf4ed7ed6a7"
	testCreated = "path"
)

var booleanFields = []string{"fake"}

func TestLocalDirectoryResourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalDirectoryResource
			want resource.MetadataResponse
		}{
			{"Basic test", LocalDirectoryResource{}, resource.MetadataResponse{TypeName: "file_local_directory"}},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				res := resource.MetadataResponse{}
				tc.fit.Metadata(context.Background(), resource.MetadataRequest{ProviderTypeName: "file"}, &res)
				got := res
				if got != tc.want {
					t.Errorf("%#v.Metadata() is %v; want %v", tc.fit, got, tc.want)
					return
				}
			})
		}
	})
}

func TestLocalDirectorySchema(t *testing.T) {
	t.Run("Schema function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalDirectoryResource
			want resource.SchemaResponse
		}{
			{"Basic test", LocalDirectoryResource{}, *getLocalDirectoryResourceSchema()},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := resource.SchemaResponse{}
				tc.fit.Schema(context.Background(), resource.SchemaRequest{}, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Schema() mismatch (-want +got):\n%s", diff)
					return
				}
			})
		}
	})
}

func TestLocalDirectoryResourceCreate(t *testing.T) {
	t.Run("Create function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalDirectoryResource
			have resource.CreateRequest
			want resource.CreateResponse
		}{
			{
				"Basic",
				LocalDirectoryResource{client: &c.MemoryDirectoryClient{}},
				// have
				getCreateRequest(t, map[string]string{
					"path":        testPath,
					"permissions": defaultPerm,
					"id":          defaultId,
					"created":     defaultCreated,
				}),
				// want
				getCreateResponse(t, map[string]string{
					"path":        testPath,
					"permissions": defaultPerm,
					"id":          testId,
					"created":     testCreated,
				}),
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				var plannedState LocalDirectoryResourceModel
				if diags := tc.have.Plan.Get(context.Background(), &plannedState); diags.HasError() {
					t.Errorf("Failed to get planned state: %v", diags)
					return
				}
				plannedPath := plannedState.Path.ValueString()
				r := getCreateResponseContainer()
				tc.fit.Create(context.Background(), tc.have, &r)
				defer func() {
					if err := tc.fit.client.Delete(plannedPath); err != nil {
						t.Errorf("Error cleaning up: %v", err)
						return
					}
				}()
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Create() mismatch (-want +got):\n%s", diff)
					return
				}
			})
		}
	})
}

func TestLocalDirectoryResourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalDirectoryResource
			have  resource.ReadRequest
			want  resource.ReadResponse
			setup map[string]string
		}{
			{
				"Basic",
				LocalDirectoryResource{client: &c.MemoryDirectoryClient{}},
				// have
				getReadRequest(t, map[string]string{
					"id":          testId,
					"path":        testPath,
					"created":     testCreated,
					"permissions": defaultPerm,
				}),
				// want
				getReadResponse(t, map[string]string{
					"id":          testId,
					"path":        testPath,
					"created":     testCreated,
					"permissions": defaultPerm,
				}),
				// setup
				map[string]string{
					"path":        testPath,
					"permissions": defaultPerm,
				},
			},
			{
				"Updates permission",
				LocalDirectoryResource{client: &c.MemoryDirectoryClient{}},
				// have
				getReadRequest(t, map[string]string{
					"id":          testId,
					"path":        testPath,
					"created":     testCreated,
					"permissions": defaultPerm,
				}),
				// want
				getReadResponse(t, map[string]string{
					"id":          testId,
					"path":        testPath,
					"created":     testCreated,
					"permissions": "0777",
				}),
				// setup
				map[string]string{
					"path":        testPath,
					"permissions": "0777",
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				created, err := tc.fit.client.Create(tc.setup["path"], tc.setup["permissions"])
				if err != nil {
					t.Errorf("Error setting up: %v", err)
					return
				}
				defer func() {
					if err := tc.fit.client.Delete(created); err != nil {
						t.Errorf("Error tearing down: %v", err)
						return
					}
				}()
				r := getReadResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%s", diff)
					return
				}
			})
		}
	})
}
func TestLocalDirectoryResourceUpdate(t *testing.T) {
	t.Run("Update function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalDirectoryResource
			have  resource.UpdateRequest
			want  resource.UpdateResponse
			setup map[string]string
		}{
			{
				"Basic",
				LocalDirectoryResource{client: &c.MemoryDirectoryClient{}},
				// have
				getUpdateRequest(t, map[string]map[string]string{
					"priorState": {
						"id":          testId,
						"path":        testPath,
						"permissions": defaultPerm,
						"created":     testCreated,
					},
					"plan": {
						"id":          testId,
						"path":        testPath,
						"permissions": defaultPerm,
						"created":     testCreated,
					},
				}),
				// want
				getUpdateResponse(t, map[string]string{
					"id":          testId,
					"path":        testPath,
					"permissions": defaultPerm,
					"created":     testCreated,
				}),
				// setup
				map[string]string{
					"path":        testPath,
					"permissions": defaultPerm,
				},
			},
			{
				"Updates permissions",
				LocalDirectoryResource{client: &c.MemoryDirectoryClient{}},
				// have
				getUpdateRequest(t, map[string]map[string]string{
					"priorState": {
						"id":          testId,
						"path":        testPath,
						"permissions": defaultPerm,
						"created":     testCreated,
					},
					"plan": {
						"id":          testId,
						"path":        testPath,
						"permissions": "0755",
						"created":     testCreated,
					},
				}),
				// want
				getUpdateResponse(t, map[string]string{
					"id":          testId,
					"path":        testPath,
					"permissions": "0755",
					"created":     testCreated,
				}),
				// setup
				map[string]string{
					"path":        testPath,
					"permissions": defaultPerm,
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				created, err := tc.fit.client.Create(tc.setup["path"], tc.setup["permissions"])
				if err != nil {
					t.Errorf("Error setting up: %v", err)
					return
				}
				defer func() {
					if err := tc.fit.client.Delete(created); err != nil {
						t.Errorf("Error tearing down: %v", err)
						return
					}
				}()
				r := getUpdateResponseContainer()
				tc.fit.Update(context.Background(), tc.have, &r)
				got := r
				var plannedState LocalDirectoryResourceModel
				if diags := tc.have.Plan.Get(context.Background(), &plannedState); diags.HasError() {
					t.Errorf("Failed to get planned state: %v", diags)
					return
				}
				plannedPath := plannedState.Path.ValueString()
				plannedPermissions := plannedState.Permissions.ValueString()
				permissionsAfterUpdate, _, err := tc.fit.client.Read(plannedPath)
				if err != nil {
					t.Errorf("Failed to read directory for update verification: %s", err)
					return
				}
				if permissionsAfterUpdate != plannedPermissions {
					t.Errorf("Directory permissions were not updated correctly. Got %q, want %q", permissionsAfterUpdate, plannedPermissions)
					return
				}
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%s", diff)
					return
				}
			})
		}
	})
}

func TestLocalDirectoryResourceDelete(t *testing.T) {
	t.Run("Delete function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalDirectoryResource
			have  resource.DeleteRequest
			want  resource.DeleteResponse
			setup map[string]string
		}{
			{
				"Basic test",
				LocalDirectoryResource{client: &c.MemoryDirectoryClient{}},
				// have
				getDeleteRequest(t, map[string]string{
					"id":          testId,
					"path":        testPath,
					"permissions": defaultPerm,
					"created":     testCreated,
				}),
				// want
				getDeleteResponse(),
				// setup
				map[string]string{
					"path":        testPath,
					"permissions": defaultPerm,
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				_, err := tc.fit.client.Create(tc.setup["path"], tc.setup["permissions"])
				if err != nil {
					t.Errorf("Error setting up: %v", err)
					return
				}
				r := getDeleteResponseContainer()
				tc.fit.Delete(context.Background(), tc.have, &r)
				got := r
				// Verify the directory was actually deleted
				if _, _, err := tc.fit.client.Read(tc.setup["path"]); err == nil || err.Error() != "directory not found" {
					if err == nil {
						t.Errorf("Expected directory to be deleted, but it still exists.")
						return
					}
					t.Errorf("Expected directory to be deleted, but it still exists. Error: %s", err.Error())
					return
				}
				// verify that the directory was removed from state
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%s", diff)
					return
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
					return resource.CreateRequest{}
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
			Schema: getLocalDirectoryResourceSchema().Schema,
		},
	}
}
func getCreateResponseContainer() resource.CreateResponse {
	return resource.CreateResponse{
		State: tfsdk.State{Schema: getLocalDirectoryResourceSchema().Schema},
	}
}
func getCreateResponse(t *testing.T, data map[string]string) resource.CreateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
				return resource.CreateResponse{}
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
			Schema: getLocalDirectoryResourceSchema().Schema,
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
				return resource.ReadRequest{}
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
			Schema: getLocalDirectoryResourceSchema().Schema,
		},
	}
}
func getReadResponseContainer() resource.ReadResponse {
	return resource.ReadResponse{
		State: tfsdk.State{Schema: getLocalDirectoryResourceSchema().Schema},
	}
}
func getReadResponse(t *testing.T, data map[string]string) resource.ReadResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
				return resource.ReadResponse{}
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
			Schema: getLocalDirectoryResourceSchema().Schema,
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
				return resource.UpdateRequest{}
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
					return resource.UpdateRequest{}
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
			Schema: getLocalDirectoryResourceSchema().Schema,
		},
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getLocalDirectoryResourceSchema().Schema,
		},
	}
}
func getUpdateResponseContainer() resource.UpdateResponse {
	return resource.UpdateResponse{
		State: tfsdk.State{Schema: getLocalDirectoryResourceSchema().Schema},
	}
}
func getUpdateResponse(t *testing.T, data map[string]string) resource.UpdateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(booleanFields, key) { // booleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
				return resource.UpdateResponse{}
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
			Schema: getLocalDirectoryResourceSchema().Schema,
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
				return resource.DeleteRequest{}
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
			Schema: getLocalDirectoryResourceSchema().Schema,
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
			"path":        tftypes.String,
			"permissions": tftypes.String,
			"created":     tftypes.String,
			"id":          tftypes.String,
		},
	}
}

func getLocalDirectoryResourceSchema() *resource.SchemaResponse {
	var testResource LocalDirectoryResource
	r := &resource.SchemaResponse{}
	testResource.Schema(context.Background(), resource.SchemaRequest{}, r)
	return r
}
