package file_local_snapshot

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
	testContents = "these contents are the default for testing"
	// echo -n "these contents are the default for testing" | base64 -w 0  #.
	testEncoded = "dGhlc2UgY29udGVudHMgYXJlIHRoZSBkZWZhdWx0IGZvciB0ZXN0aW5n"
	// echo -n "these contents are the default for testing" | gzip -c | base64 -w 0  #.
	// testCompressed = "H4sIAAAAAAAAAwXBAQoAIAgDwK/sa1KzglDQ9f/utNnEyBBDDStCm5h0e1fwLIitE+sDr6miHioAAAA="
	// echo -n "these contents are the default for testing" | base64 -w 0 | sha256sum | awk '{print $1}'  #.
	testId = "ba8cd27d74eb572956e09da49530c5ab2dd66ee946956e9d55a4cd09b76ab527"
	// echo -n "these contents are the default for testing" | gzip -c | base64 -w 0 | sha256sum | awk '{print $1}'  #.
	testCompressedId = "a358aafd3bebe1731735516b321d55bd8a58a64e0e2d92646a6a6fdb63751c5d"
	testName         = "tmpTestFileName.txt"
	// You can use any arbitrary string to define the trigger, I chose to use the base64 encoded contents.
	testTrigger = "dGhlc2UgY29udGVudHMgYXJlIHRoZSBkZWZhdWx0IGZvciB0ZXN0aW5n"

	defaultDirectory   = "."
	defaultPermissions = "0600"
	defaultCompress    = "false"
)

var snapshotResourceBooleanFields = []string{"compress"}

func TestLocalSnapshotResourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalSnapshotResource
			want resource.MetadataResponse
		}{
			{"Basic test", LocalSnapshotResource{}, resource.MetadataResponse{TypeName: "file_local_snapshot"}},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				res := resource.MetadataResponse{}
				tc.fit.Metadata(context.Background(), resource.MetadataRequest{ProviderTypeName: "file"}, &res)
				got := res
				if got != tc.want {
					t.Errorf("%+v.Metadata() is %+v; want %+v", tc.fit, got, tc.want)
				}
			})
		}
	})
}

func TestLocalSnapshotResourceSchema(t *testing.T) {
	t.Run("Schema function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalSnapshotResource
			want resource.SchemaResponse
		}{
			{"Basic test", LocalSnapshotResource{}, *getLocalSnapshotResourceSchema()},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := resource.SchemaResponse{}
				tc.fit.Schema(context.Background(), resource.SchemaRequest{}, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Schema() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

func TestLocalSnapshotResourceCreate(t *testing.T) {
	t.Run("Create function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalSnapshotResource
			have  resource.CreateRequest
			want  resource.CreateResponse
			setup map[string]string
		}{
			{
				"Basic",
				LocalSnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getLocalSnapshotResourceCreateRequest(t, map[string]string{
					"id":             "",
					"snapshot":       "",
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// want
				getLocalSnapshotResourceCreateResponse(t, map[string]string{
					"id":             testId,
					"snapshot":       testEncoded,
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// setup
				map[string]string{
					"name":      testName,
					"directory": defaultDirectory,
					"contents":  testContents,
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := getLocalSnapshotResourceCreateResponseContainer()
				if err := tc.fit.client.Create(tc.setup["directory"], tc.setup["name"], tc.setup["contents"], defaultPermissions); err != nil {
					t.Errorf("Error setting up: %v", err)
				}
				defer func() {
					if err := tc.fit.client.Delete(tc.setup["directory"], tc.setup["name"]); err != nil {
						t.Errorf("Error tearing down: %v", err)
					}
				}()

				tc.fit.Create(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Create() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}
func TestLocalSnapshotResourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalSnapshotResource
			have resource.ReadRequest
			want resource.ReadResponse
		}{
			{
				"Basic",
				LocalSnapshotResource{},
				// have
				getLocalSnapshotResourceReadRequest(t, map[string]string{
					"id":             testId,
					"snapshot":       testEncoded,
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// want
				getLocalSnapshotResourceReadResponse(t, map[string]string{
					"id":             testId,
					"snapshot":       testEncoded,
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := getLocalSnapshotResourceReadResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

func TestLocalSnapshotResourceUpdate(t *testing.T) {
	t.Run("Update function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalSnapshotResource
			have  resource.UpdateRequest
			want  resource.UpdateResponse
			setup map[string]string
		}{
			{
				"Basic",
				LocalSnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getLocalSnapshotResourceUpdateRequest(t, map[string]map[string]string{
					"priorState": {
						"id":             testId,
						"snapshot":       testEncoded,
						"name":           testName,
						"update_trigger": testTrigger,
						"directory":      defaultDirectory,
						"compress":       defaultCompress,
					},
					"plan": {
						"id":             "",
						"snapshot":       "",
						"name":           testName,
						"update_trigger": testTrigger,
						"directory":      defaultDirectory,
						"compress":       defaultCompress,
					},
				}),
				// want
				getLocalSnapshotResourceUpdateResponse(t, map[string]string{
					"id":             testId,
					"snapshot":       testEncoded,
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// setup
				map[string]string{
					"name":      testName,
					"directory": defaultDirectory,
					"contents":  testContents,
				},
			},
			{
				"Updates when trigger changes",
				LocalSnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getLocalSnapshotResourceUpdateRequest(t, map[string]map[string]string{
					"priorState": {
						"id":             testId,
						"snapshot":       testEncoded,
						"name":           testName,
						"update_trigger": testTrigger,
						"directory":      defaultDirectory,
						"compress":       defaultCompress,
					},
					"plan": {
						"id":             "",
						"snapshot":       "",
						"name":           testName,
						"update_trigger": "updated-trigger",
						"directory":      defaultDirectory,
						"compress":       defaultCompress,
					},
				}),
				// want
				getLocalSnapshotResourceUpdateResponse(t, map[string]string{
					"id":             testId,                                                 // id shouldn't change
					"snapshot":       "dGhlc2UgY29udGVudHMgYXJlIHVwZGF0ZWQgZm9yIHRlc3Rpbmc=", // echo -n "these contents are updated for testing" | base64 -w 0 #.
					"name":           testName,
					"update_trigger": "updated-trigger",
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// setup
				map[string]string{
					"name":      testName,
					"directory": defaultDirectory,
					"contents":  "these contents are updated for testing",
				},
			},
			{
				"Doesn't update when trigger stays the same",
				LocalSnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getLocalSnapshotResourceUpdateRequest(t, map[string]map[string]string{
					"priorState": {
						"id":             testId,
						"snapshot":       testEncoded,
						"name":           testName,
						"update_trigger": testTrigger,
						"directory":      defaultDirectory,
						"compress":       defaultCompress,
					},
					"plan": {
						"id":             "",
						"snapshot":       "",
						"name":           testName,
						"update_trigger": testTrigger,
						"directory":      defaultDirectory,
						"compress":       defaultCompress,
					},
				}),
				// want
				getLocalSnapshotResourceUpdateResponse(t, map[string]string{
					"id":             testId,
					"snapshot":       testEncoded,
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// setup
				map[string]string{
					"name":      testName,
					"directory": defaultDirectory,
					"contents":  "these contents are updated for testing",
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := getLocalSnapshotResourceUpdateResponseContainer()
				if err := tc.fit.client.Create(tc.setup["directory"], tc.setup["name"], tc.setup["contents"], defaultPermissions); err != nil {
					t.Errorf("Error setting up: %v", err)
				}
				defer func() {
					if err := tc.fit.client.Delete(tc.setup["directory"], tc.setup["name"]); err != nil {
						t.Errorf("Error tearing down: %v", err)
					}
				}()

				tc.fit.Update(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

func TestLocalSnapshotResourceDelete(t *testing.T) {
	t.Run("Delete function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalSnapshotResource
			have resource.DeleteRequest
			want resource.DeleteResponse
		}{
			{
				"Basic test",
				LocalSnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getLocalSnapshotResourceDeleteRequest(t, map[string]string{
					"id":             testId,
					"name":           testName,
					"directory":      defaultDirectory,
					"snapshot":       testContents,
					"update_trigger": testTrigger,
					"compress":       defaultCompress,
				}),
				// want
				getLocalSnapshotResourceDeleteResponse(),
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := getLocalSnapshotResourceDeleteResponseContainer()
				tc.fit.Delete(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

// *** Test Helper Functions *** //
// Create.
func getLocalSnapshotResourceCreateRequest(t *testing.T, data map[string]string) resource.CreateRequest {
	planMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
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
	planValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), planMap)
	return resource.CreateRequest{
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
	}
}

func getLocalSnapshotResourceCreateResponseContainer() resource.CreateResponse {
	return resource.CreateResponse{
		State: tfsdk.State{Schema: getLocalSnapshotResourceSchema().Schema},
	}
}

func getLocalSnapshotResourceCreateResponse(t *testing.T, data map[string]string) resource.CreateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), stateMap)
	return resource.CreateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
	}
}

// Read.
func getLocalSnapshotResourceReadRequest(t *testing.T, data map[string]string) resource.ReadRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), stateMap)
	return resource.ReadRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
	}
}

func getLocalSnapshotResourceReadResponseContainer() resource.ReadResponse {
	return resource.ReadResponse{
		State: tfsdk.State{Schema: getLocalSnapshotResourceSchema().Schema},
	}
}

func getLocalSnapshotResourceReadResponse(t *testing.T, data map[string]string) resource.ReadResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), stateMap)
	return resource.ReadResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
	}
}

// Update.
func getLocalSnapshotResourceUpdateRequest(t *testing.T, data map[string]map[string]string) resource.UpdateRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data["priorState"] {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	priorStateValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), stateMap)

	planMap := make(map[string]tftypes.Value)
	for key, value := range data["plan"] {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
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
	planValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), planMap)

	return resource.UpdateRequest{
		State: tfsdk.State{
			Raw:    priorStateValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
	}
}

func getLocalSnapshotResourceUpdateResponseContainer() resource.UpdateResponse {
	return resource.UpdateResponse{
		State: tfsdk.State{Schema: getLocalSnapshotResourceSchema().Schema},
	}
}

func getLocalSnapshotResourceUpdateResponse(t *testing.T, data map[string]string) resource.UpdateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), stateMap)
	return resource.UpdateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
	}
}

// Delete.
func getLocalSnapshotResourceDeleteRequest(t *testing.T, data map[string]string) resource.DeleteRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotResourceBooleanFields, key) { // snapshotResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getLocalSnapshotResourceAttributeTypes(), stateMap)
	return resource.DeleteRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalSnapshotResourceSchema().Schema,
		},
	}
}

func getLocalSnapshotResourceDeleteResponseContainer() resource.DeleteResponse {
	// A delete response does not need a schema as it results in a null state.
	return resource.DeleteResponse{}
}

func getLocalSnapshotResourceDeleteResponse() resource.DeleteResponse {
	return resource.DeleteResponse{
		State: tfsdk.State{
			Raw:    tftypes.Value{},
			Schema: nil,
		},
	}
}

// The helpers helpers.
func getLocalSnapshotResourceAttributeTypes() tftypes.Object {
	return tftypes.Object{
		AttributeTypes: map[string]tftypes.Type{
			"id":             tftypes.String,
			"name":           tftypes.String,
			"directory":      tftypes.String,
			"snapshot":       tftypes.String,
			"update_trigger": tftypes.String,
			"compress":       tftypes.Bool,
		},
	}
}

func getLocalSnapshotResourceSchema() *resource.SchemaResponse {
	var testResource LocalSnapshotResource
	r := &resource.SchemaResponse{}
	testResource.Schema(context.Background(), resource.SchemaRequest{}, r)
	return r
}
