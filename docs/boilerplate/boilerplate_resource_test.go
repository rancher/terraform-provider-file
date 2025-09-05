package boilerplate

import (
	"context"
	"slices"
	"strconv"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	defaultId = "fake123"
)

var boilerplateResourceBooleanFields = []string{}

func TestBoilerplateResourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  BoilerplateResource
			want resource.MetadataResponse
		}{
			{"Basic test", BoilerplateResource{}, resource.MetadataResponse{TypeName: "file_boilerplate"}},
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

func TestBoilerplateResourceSchema(t *testing.T) {
	t.Run("Schema function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  BoilerplateResource
			want resource.SchemaResponse
		}{
			{"Basic test", BoilerplateResource{}, *getBoilerplateResourceSchema()},
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

func TestBoilerplateResourceCreate(t *testing.T) {
	t.Run("Create function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  BoilerplateResource
			have resource.CreateRequest
			want resource.CreateResponse
		}{
			{
				"Basic",
				BoilerplateResource{client: &memoryBoilerplateClient{}},
				// have
				getBoilerplateResourceCreateRequest(t, map[string]string{
					"id": defaultId,
				}),
				// want
				getBoilerplateResourceCreateResponse(t, map[string]string{
					"id": "fake123",
				}),
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				var plannedState BoilerplateResourceModel
				if diags := tc.have.Plan.Get(context.Background(), &plannedState); diags.HasError() {
					t.Errorf("Failed to get planned state: %+v", diags)
				}
				plannedId := plannedState.Id.ValueString()
				r := getBoilerplateResourceCreateResponseContainer()
				// run the resource's Create command
				tc.fit.Create(context.Background(), tc.have, &r)
				defer func() {
					// run the client's Delete function
					if err := tc.fit.client.Delete(plannedId); err != nil {
						t.Errorf("Error cleaning up: %+v", err)
					}
				}()
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Create() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}
func TestBoilerplateResourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   BoilerplateResource
			have  resource.ReadRequest
			want  resource.ReadResponse
			setup map[string]string
		}{
			{
				"Basic",
				BoilerplateResource{client: &memoryBoilerplateClient{}},
				// have
				getBoilerplateResourceReadRequest(t, map[string]string{
					"id": defaultId,
				}),
				// want
				getBoilerplateResourceReadResponse(t, map[string]string{
					"id": defaultId,
				}),
				map[string]string{
					"id": defaultId,
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				if err := tc.fit.client.Create(tc.setup["id"]); err != nil {
					t.Errorf("Error setting up: %+v", err)
				}
				defer func() {
					if err := tc.fit.client.Delete(tc.setup["id"]); err != nil {
						t.Errorf("Error tearing down: %+v", err)
					}
				}()
				r := getBoilerplateResourceReadResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

func TestBoilerplateResourceUpdate(t *testing.T) {
	t.Run("Update function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   BoilerplateResource
			have  resource.UpdateRequest
			want  resource.UpdateResponse
			setup map[string]string
		}{
			{
				"Basic test",
				BoilerplateResource{client: &memoryBoilerplateClient{}},
				// have
				getBoilerplateResourceUpdateRequest(t, map[string]map[string]string{
					"priorState": {
						"id": defaultId,
					},
					"plan": {
						"id": defaultId,
					},
				}),
				// want
				getBoilerplateResourceUpdateResponse(t, map[string]string{
					"id": defaultId,
				}),
				// setup
				map[string]string{
					"id": defaultId,
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				if err := tc.fit.client.Create(tc.setup["id"]); err != nil {
					t.Errorf("Error setting up: %+v", err)
				}
				defer func() {
					if err := tc.fit.client.Delete(tc.setup["id"]); err != nil {
						t.Errorf("Error tearing down: %+v", err)
					}
				}()
				r := getBoilerplateResourceUpdateResponseContainer()
				tc.fit.Update(context.Background(), tc.have, &r)
				got := r
				var plannedState BoilerplateResourceModel
				if diags := tc.have.Plan.Get(context.Background(), &plannedState); diags.HasError() {
					t.Errorf("Failed to get planned state: %v", diags)
				}
				plannedId := plannedState.Id.ValueString()
				idAfterUpdate, err := tc.fit.client.Read(plannedState.Id.ValueString())
				if err != nil {
					t.Errorf("Failed to read boilerplate for update verification: %+v", err)
				}
				if idAfterUpdate != plannedId {
					t.Errorf("Id was not updated correctly. Got %q, want %q", idAfterUpdate, plannedId)
				}
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

func TestBoilerplateResourceDelete(t *testing.T) {
	t.Run("Delete function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   BoilerplateResource
			have  resource.DeleteRequest
			want  resource.DeleteResponse
			setup map[string]string
		}{
			{
				"Basic test",
				BoilerplateResource{client: &memoryBoilerplateClient{}},
				// have
				getBoilerplateResourceDeleteRequest(t, map[string]string{
					"id": defaultId,
				}),
				// want
				getBoilerplateResourceDeleteResponse(),
				// setup
				map[string]string{
					"id": defaultId,
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				if err := tc.fit.client.Create(tc.setup["id"]); err != nil {
					t.Errorf("Error setting up: %+v", err)
				}
				r := getBoilerplateResourceDeleteResponseContainer()
				tc.fit.Delete(context.Background(), tc.have, &r)
				got := r
				// Verify the boilerplate was actually deleted.
				if id, err := tc.fit.client.Read(tc.setup["id"]); err == nil || err.Error() != "some obj not found" {
					if err == nil {
						t.Errorf("Expected boilerplate to be deleted, but it still exists. Boilerplate id: %+v", id)
					}
					t.Errorf("Expected boilerplate to be deleted, but it still exists. Error: %s", err.Error())
				}
				// Verify that the file was removed from state.
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Update() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

// *** Test Helper Functions *** //
// Create.
func getBoilerplateResourceCreateRequest(t *testing.T, data map[string]string) resource.CreateRequest {
	planMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
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
	planValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), planMap)
	return resource.CreateRequest{
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
	}
}

func getBoilerplateResourceCreateResponseContainer() resource.CreateResponse {
	return resource.CreateResponse{
		State: tfsdk.State{Schema: getBoilerplateResourceSchema().Schema},
	}
}

func getBoilerplateResourceCreateResponse(t *testing.T, data map[string]string) resource.CreateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), stateMap)
	return resource.CreateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
	}
}

// Read.
func getBoilerplateResourceReadRequest(t *testing.T, data map[string]string) resource.ReadRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), stateMap)
	return resource.ReadRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
	}
}

func getBoilerplateResourceReadResponseContainer() resource.ReadResponse {
	return resource.ReadResponse{
		State: tfsdk.State{Schema: getBoilerplateResourceSchema().Schema},
	}
}

func getBoilerplateResourceReadResponse(t *testing.T, data map[string]string) resource.ReadResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), stateMap)
	return resource.ReadResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
	}
}

// Update.
func getBoilerplateResourceUpdateRequest(t *testing.T, data map[string]map[string]string) resource.UpdateRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data["priorState"] {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	priorStateValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), stateMap)

	planMap := make(map[string]tftypes.Value)
	for key, value := range data["plan"] {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
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
	planValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), planMap)

	return resource.UpdateRequest{
		State: tfsdk.State{
			Raw:    priorStateValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
		Plan: tfsdk.Plan{
			Raw:    planValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
	}
}

func getBoilerplateResourceUpdateResponseContainer() resource.UpdateResponse {
	return resource.UpdateResponse{
		State: tfsdk.State{Schema: getBoilerplateResourceSchema().Schema},
	}
}

func getBoilerplateResourceUpdateResponse(t *testing.T, data map[string]string) resource.UpdateResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), stateMap)
	return resource.UpdateResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
	}
}

// Delete.
func getBoilerplateResourceDeleteRequest(t *testing.T, data map[string]string) resource.DeleteRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(boilerplateResourceBooleanFields, key) { // boilerplateResourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getBoilerplateResourceAttributeTypes(), stateMap)
	return resource.DeleteRequest{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getBoilerplateResourceSchema().Schema,
		},
	}
}

func getBoilerplateResourceDeleteResponseContainer() resource.DeleteResponse {
	// A delete response does not need a schema as it results in a null state.
	return resource.DeleteResponse{}
}

func getBoilerplateResourceDeleteResponse() resource.DeleteResponse {
	return resource.DeleteResponse{
		State: tfsdk.State{
			Raw:    tftypes.Value{},
			Schema: nil,
		},
	}
}

// The helpers helpers.
func getBoilerplateResourceAttributeTypes() tftypes.Object {
	return tftypes.Object{
		AttributeTypes: map[string]tftypes.Type{
			"id": tftypes.String,
		},
	}
}

func getBoilerplateResourceSchema() *resource.SchemaResponse {
	var testResource BoilerplateResource
	r := &resource.SchemaResponse{}
	testResource.Schema(context.Background(), resource.SchemaRequest{}, r)
	return r
}
