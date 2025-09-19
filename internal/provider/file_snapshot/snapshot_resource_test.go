package file_snapshot

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

func TestSnapshotResourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  SnapshotResource
			want resource.MetadataResponse
		}{
			{"Basic test", SnapshotResource{}, resource.MetadataResponse{TypeName: "file_snapshot"}},
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

func TestSnapshotResourceSchema(t *testing.T) {
	t.Run("Schema function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  SnapshotResource
			want resource.SchemaResponse
		}{
			{"Basic test", SnapshotResource{}, *getSnapshotResourceSchema()},
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

func TestSnapshotResourceCreate(t *testing.T) {
	t.Run("Create function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   SnapshotResource
			have  resource.CreateRequest
			want  resource.CreateResponse
			setup map[string]string
		}{
			{
				"Basic",
				SnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getSnapshotResourceCreateRequest(t, map[string]string{
					"id":             "",
					"snapshot":       "",
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// want
				getSnapshotResourceCreateResponse(t, map[string]string{
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
				r := getSnapshotResourceCreateResponseContainer()
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
func TestSnapshotResourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  SnapshotResource
			have resource.ReadRequest
			want resource.ReadResponse
		}{
			{
				"Basic",
				SnapshotResource{},
				// have
				getSnapshotResourceReadRequest(t, map[string]string{
					"id":             testId,
					"snapshot":       testEncoded,
					"name":           testName,
					"update_trigger": testTrigger,
					"directory":      defaultDirectory,
					"compress":       defaultCompress,
				}),
				// want
				getSnapshotResourceReadResponse(t, map[string]string{
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
				r := getSnapshotResourceReadResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

func TestSnapshotResourceUpdate(t *testing.T) {
	t.Run("Update function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   SnapshotResource
			have  resource.UpdateRequest
			want  resource.UpdateResponse
			setup map[string]string
		}{
			{
				"Basic",
				SnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getSnapshotResourceUpdateRequest(t, map[string]map[string]string{
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
				getSnapshotResourceUpdateResponse(t, map[string]string{
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
				SnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getSnapshotResourceUpdateRequest(t, map[string]map[string]string{
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
				getSnapshotResourceUpdateResponse(t, map[string]string{
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
				SnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getSnapshotResourceUpdateRequest(t, map[string]map[string]string{
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
				getSnapshotResourceUpdateResponse(t, map[string]string{
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
				r := getSnapshotResourceUpdateResponseContainer()
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

func TestSnapshotResourceDelete(t *testing.T) {
	t.Run("Delete function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  SnapshotResource
			have resource.DeleteRequest
			want resource.DeleteResponse
		}{
			{
				"Basic test",
				SnapshotResource{client: &c.MemoryFileClient{}},
				// have
				getSnapshotResourceDeleteRequest(t, map[string]string{
					"id":             testId,
					"name":           testName,
					"directory":      defaultDirectory,
					"snapshot":       testContents,
					"update_trigger": testTrigger,
					"compress":       defaultCompress,
				}),
				// want
				getSnapshotResourceDeleteResponse(),
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := getSnapshotResourceDeleteResponseContainer()
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
func getSnapshotResourceCreateRequest(t *testing.T, data map[string]string) resource.CreateRequest {
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
	planValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), planMap)
	return resource.CreateRequest{
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
	}
}

func getSnapshotResourceCreateResponseContainer() resource.CreateResponse {
	return resource.CreateResponse{
		State: tfsdk.State{Schema: getSnapshotResourceSchema().Schema},
	}
}

func getSnapshotResourceCreateResponse(t *testing.T, data map[string]string) resource.CreateResponse {
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
	stateValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), stateMap)
	return resource.CreateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
	}
}

// Read.
func getSnapshotResourceReadRequest(t *testing.T, data map[string]string) resource.ReadRequest {
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
	stateValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), stateMap)
	return resource.ReadRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
	}
}

func getSnapshotResourceReadResponseContainer() resource.ReadResponse {
	return resource.ReadResponse{
		State: tfsdk.State{Schema: getSnapshotResourceSchema().Schema},
	}
}

func getSnapshotResourceReadResponse(t *testing.T, data map[string]string) resource.ReadResponse {
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
	stateValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), stateMap)
	return resource.ReadResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
	}
}

// Update.
func getSnapshotResourceUpdateRequest(t *testing.T, data map[string]map[string]string) resource.UpdateRequest {
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
	priorStateValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), stateMap)

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
	planValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), planMap)

	return resource.UpdateRequest{
		State: tfsdk.State{
			Raw:    priorStateValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
	}
}

func getSnapshotResourceUpdateResponseContainer() resource.UpdateResponse {
	return resource.UpdateResponse{
		State: tfsdk.State{Schema: getSnapshotResourceSchema().Schema},
	}
}

func getSnapshotResourceUpdateResponse(t *testing.T, data map[string]string) resource.UpdateResponse {
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
	stateValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), stateMap)
	return resource.UpdateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
	}
}

// Delete.
func getSnapshotResourceDeleteRequest(t *testing.T, data map[string]string) resource.DeleteRequest {
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
	stateValue := tftypes.NewValue(getSnapshotResourceAttributeTypes(), stateMap)
	return resource.DeleteRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getSnapshotResourceSchema().Schema,
		},
	}
}

func getSnapshotResourceDeleteResponseContainer() resource.DeleteResponse {
	// A delete response does not need a schema as it results in a null state.
	return resource.DeleteResponse{}
}

func getSnapshotResourceDeleteResponse() resource.DeleteResponse {
	return resource.DeleteResponse{
		State: tfsdk.State{
			Raw:    tftypes.Value{},
			Schema: nil,
		},
	}
}

// The helpers helpers.
func getSnapshotResourceAttributeTypes() tftypes.Object {
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

func getSnapshotResourceSchema() *resource.SchemaResponse {
	var testResource SnapshotResource
	r := &resource.SchemaResponse{}
	testResource.Schema(context.Background(), resource.SchemaRequest{}, r)
	return r
}
