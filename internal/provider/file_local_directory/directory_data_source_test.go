// SPDX-License-Identifier: MPL-2.0

package file_local_directory

import (
	"context"
	"math/rand"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
	c "github.com/rancher/terraform-provider-file/internal/provider/directory_client"
)

const (
	// echo -n '/tmp/foo' | sha256sum | awk '{print $1}' #.
	testDirectoryId      = "e2e1dcd28fea64180e4cd859b299ce67c4c02a3cbd49eca0042f7b5b47d241b5"
	testDirectoryPath    = "/tmp/foo"
	defaultDirectoryPerm = "0755"
)

func TestLocalDirectoryDataSourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalDirectoryDataSource
			want datasource.MetadataResponse
		}{
			{"Basic test", LocalDirectoryDataSource{}, datasource.MetadataResponse{TypeName: "file_local_directory"}},
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

func TestLocalDirectoryDataSourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name  string
			fit   LocalDirectoryDataSource
			have  datasource.ReadRequest
			want  datasource.ReadResponse
			setup map[string]interface{}
		}{
			{
				"Basic",
				LocalDirectoryDataSource{client: &c.MemoryDirectoryClient{}},
				// have
				getReadDataSourceRequest(t, map[string]interface{}{
					"path": testDirectoryPath,
				}),
				// want
				getReadDataSourceResponse(t, map[string]interface{}{
					"id":          testDirectoryId,
					"path":        testDirectoryPath,
					"permissions": defaultDirectoryPerm,
					"files": []interface{}{
						map[string]interface{}{
							"name":          filepath.Join(testDirectoryPath, "test_file_a"),
							"size":          "10",
							"permissions":   "0700",
							"last_modified": "2025-09-29 16:09:15.039952008 +0000 UTC",
							"is_directory":  "false",
						},
						map[string]interface{}{
							"name":          filepath.Join(testDirectoryPath, "test_file_b"),
							"size":          "100",
							"permissions":   "0400",
							"last_modified": "2021-02-18 00:56:32 +0000 UTC",
							"is_directory":  "false",
						},
					},
				}),
				// setup
				map[string]interface{}{
					"path":        testDirectoryPath,
					"permissions": defaultDirectoryPerm,
					"files": []map[string]string{
						{
							"name":         "test_file_a",
							"size":         "10",
							"permissions":  "0700",
							"lastModified": "2025-09-29 16:09:15.039952008 +0000 UTC",
						},
						{
							"name":         "test_file_b",
							"size":         "100",
							"permissions":  "0400",
							"lastModified": "2021-02-18 00:56:32 +0000 UTC",
						},
					},
				},
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				path := tc.setup["path"].(string)
				permissions := tc.setup["permissions"].(string)
				files := tc.setup["files"].([]map[string]string)
				created, err := tc.fit.client.Create(path, permissions)
				if err != nil {
					t.Errorf("Error setting up: %v", err)
					return
				}
				characterSet := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
				rand := rand.New(rand.NewSource(time.Now().UnixNano()))
				for _, file := range files {
					size, err := strconv.Atoi(file["size"])
					if err != nil {
						t.Errorf("could not convert size '%s' to an integer: %v", file["size"], err)
						return
					}
					b := make([]byte, size)
					for i := range b {
						b[i] = characterSet[rand.Intn(len(characterSet))]
					}
					contents := string(b)
					err = tc.fit.client.CreateFile(filepath.Join(path, file["name"]), contents, file["permissions"], file["lastModified"])
					if err != nil {
						t.Errorf("Error setting up: %v", err)
						return
					}
				}
				defer func() {
					if err := tc.fit.client.Delete(created); err != nil {
						t.Errorf("Error tearing down: %v", err)
						return
					}
				}()
				r := getReadDataSourceResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
        val := map[string]tftypes.Value{}
        err = tc.want.State.Raw.As(&val)
        if err != nil {
          t.Errorf("Error converting tc.want.State.Raw to map: %v", err)
          return
        }
        rawWantFiles := val["files"]

        err = got.State.Raw.As(&val)
        if err != nil {
          t.Errorf("Error converting got.State.Raw to map: %v", err)
          return
        }
        rawGotFiles := val["files"]

        if diff := cmp.Diff(rawWantFiles, rawGotFiles); diff != "" {
          t.Errorf("Read() mismatch (-want +got):\n%s", diff)
          return
        }
        if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%s", diff)
					return
				}
			})
		}
	})
}

//* Helpers *//

func getReadDataSourceRequest(t *testing.T, data map[string]interface{}) datasource.ReadRequest {
	objType := getDataObjectAttributeTypes()
	val := buildValue(t, objType, data)

	return datasource.ReadRequest{
		Config: tfsdk.Config{
			Raw:    val,
			Schema: getLocalDirectoryDataSourceSchema().Schema,
		},
	}
}

func getReadDataSourceResponseContainer() datasource.ReadResponse {
	return datasource.ReadResponse{
		State: tfsdk.State{Schema: getLocalDirectoryDataSourceSchema().Schema},
	}
}

func getReadDataSourceResponse(t *testing.T, data map[string]interface{}) datasource.ReadResponse {
	objType := getDataObjectAttributeTypes()
	val := buildValue(t, objType, data)

	return datasource.ReadResponse{
		State: tfsdk.State{
			Raw:    val,
			Schema: getLocalDirectoryDataSourceSchema().Schema,
		},
	}
}

//* Helper's Helpers *//

func buildValue(t *testing.T, tfType tftypes.Type, data interface{}) tftypes.Value {
	if data == nil {
		return tftypes.NewValue(tfType, nil)
	}

	switch typ := tfType.(type) {
	case tftypes.Object:
		dataMap, ok := data.(map[string]interface{})
		if !ok {
			t.Fatalf("Expected map[string]interface{} for tftypes.Object, got %T", data)
		}
		attrValues := make(map[string]tftypes.Value)
		for name, attrType := range typ.AttributeTypes {
			attrValues[name] = buildValue(t, attrType, dataMap[name])
		}
		return tftypes.NewValue(typ, attrValues)

	case tftypes.List:
		dataSlice, ok := data.([]interface{})
		if !ok {
			t.Fatalf("Expected []interface{} for tftypes.List, got %T", data)
		}
		elemValues := make([]tftypes.Value, 0, len(dataSlice))
		for _, v := range dataSlice {
			elemValues = append(elemValues, buildValue(t, typ.ElementType, v))
		}
		return tftypes.NewValue(typ, elemValues)

	default:
		// Handle primitive types
		if tfType.Is(tftypes.String) {
			val, ok := data.(string)
			if !ok {
				t.Fatalf("Expected string for tftypes.String, got %T", data)
			}
			return tftypes.NewValue(tfType, val)
		}
		if tfType.Is(tftypes.Number) {
			var numVal interface{}
			switch v := data.(type) {
			case int:
				numVal = v
			case float64:
				numVal = v
			default:
				t.Fatalf("Expected int or float64 for tftypes.Number, got %T", data)
			}
			return tftypes.NewValue(tfType, numVal)
		}
		if tfType.Is(tftypes.Bool) {
			val, ok := data.(bool)
			if !ok {
				t.Fatalf("Expected bool for tftypes.Bool, got %T", data)
			}
			return tftypes.NewValue(tfType, val)
		}

		t.Fatalf("Unsupported tftype: %T", tfType)
		return tftypes.Value{}
	}
}

func getDataObjectAttributeTypes() tftypes.Object {
	return tftypes.Object{
		AttributeTypes: map[string]tftypes.Type{
			"id":          tftypes.String,
			"path":        tftypes.String,
			"permissions": tftypes.String,
			"files": tftypes.List{
				ElementType: tftypes.Object{
					AttributeTypes: map[string]tftypes.Type{
						"name":          tftypes.String,
						"size":          tftypes.String,
						"permissions":   tftypes.String,
						"last_modified": tftypes.String,
						"is_directory":  tftypes.String,
					},
				},
			},
		},
	}
}

func getLocalDirectoryDataSourceSchema() *datasource.SchemaResponse {
	var testResource LocalDirectoryDataSource
	r := &datasource.SchemaResponse{}
	testResource.Schema(context.Background(), datasource.SchemaRequest{}, r)
	return r
}
