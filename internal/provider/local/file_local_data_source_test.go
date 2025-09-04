// SPDX-License-Identifier: MPL-2.0

package local

import (
	"context"
	"slices"
	"strconv"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

func TestLocalDataSourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalDataSource
			want datasource.MetadataResponse
		}{
			{"Basic test", LocalDataSource{}, datasource.MetadataResponse{TypeName: "file_local"}},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				res := datasource.MetadataResponse{}
				tc.fit.Metadata(context.Background(), datasource.MetadataRequest{ProviderTypeName: "file"}, &res)
				got := res
				if got != tc.want {
					t.Errorf("%#v.Metadata() is %v; want %v", tc.fit, got, tc.want)
				}
			})
		}
	})
}

func TestLocalDataSourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalDataSource
			have  datasource.ReadRequest
			want  datasource.ReadResponse
			setup map[string]string
		}{
			{
				"Unprotected",
				LocalDataSource{client: &memoryFileClient{}},
				// have
				getDataSourceReadRequest(t, map[string]string{
					"id":              "60cef95046105ff4522c0c1f1aeeeba43d0d729dbcabdd8846c317c98cac60a2",
					"name":            "read.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is an unprotected read test",
					"hmac_secret_key": defaultHmacSecretKey,
				}),
				// want
				getDataSourceReadResponse(t, map[string]string{
					"id":              "60cef95046105ff4522c0c1f1aeeeba43d0d729dbcabdd8846c317c98cac60a2",
					"name":            "read.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is an unprotected read test",
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
				LocalDataSource{client: &memoryFileClient{}},
				// have
				getDataSourceReadRequest(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// want
				getDataSourceReadResponse(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
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
				LocalDataSource{client: &memoryFileClient{}},
				// have
				getDataSourceReadRequest(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected_content.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// want
				getDataSourceReadResponse(t, map[string]string{
					"id":              "84326116e261654e44ca3cb73fa026580853794062d472bc817b7ec2c82ff648",
					"name":            "read_protected_content.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a change in contents in the real file",
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
				LocalDataSource{client: &memoryFileClient{}},
				// have
				getDataSourceReadRequest(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected_mode.tmp",
					"directory":       defaultDirectory,
					"permissions":     defaultPerm,
					"contents":        "this is a protected read test",
					"hmac_secret_key": "this-is-a-test-key",
				}),
				// want
				getDataSourceReadResponse(t, map[string]string{
					"id":              "ec4407ba53b2c40ac2ac18ff7372a6fe6e4f7f8aa04f340503aefc7d9a5fa4e1",
					"name":            "read_protected_mode.tmp",
					"directory":       defaultDirectory,
					"permissions":     "0755",
					"contents":        "this is a protected read test",
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
				r := getDataSourceReadResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%s", diff)
				}
			})
		}
	})
}

// *** Test Helper Functions *** //

func getDataSourceReadRequest(t *testing.T, data map[string]string) datasource.ReadRequest {
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
	stateValue := tftypes.NewValue(getDataSourceObjectAttributeTypes(), stateMap)
	return datasource.ReadRequest{
		Config: tfsdk.Config{
			Raw:    stateValue,
			Schema: getLocalDataSourceSchema().Schema,
		},
	}
}

func getDataSourceReadResponseContainer() datasource.ReadResponse {
	return datasource.ReadResponse{
		State: tfsdk.State{Schema: getLocalDataSourceSchema().Schema},
	}
}

func getDataSourceReadResponse(t *testing.T, data map[string]string) datasource.ReadResponse {
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
	stateValue := tftypes.NewValue(getDataSourceObjectAttributeTypes(), stateMap)
	return datasource.ReadResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalDataSourceSchema().Schema,
		},
	}
}

func getDataSourceObjectAttributeTypes() tftypes.Object {
	return tftypes.Object{
		AttributeTypes: map[string]tftypes.Type{
			"id":              tftypes.String,
			"name":            tftypes.String,
			"directory":       tftypes.String,
			"permissions":     tftypes.String,
			"contents":        tftypes.String,
			"hmac_secret_key": tftypes.String,
		},
	}
}

func getLocalDataSourceSchema() *datasource.SchemaResponse {
	var testResource LocalDataSource
	r := &datasource.SchemaResponse{}
	testResource.Schema(context.Background(), datasource.SchemaRequest{}, r)
	return r
}
