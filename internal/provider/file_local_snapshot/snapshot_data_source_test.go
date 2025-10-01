package file_local_snapshot

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

const (
	testDataContents = "these contents are the default for testing"
	// echo -n "these contents are the default for testing" | base64 -w 0  #.
	testDataEncoded = "dGhlc2UgY29udGVudHMgYXJlIHRoZSBkZWZhdWx0IGZvciB0ZXN0aW5n"
	// echo -n "these contents are the default for testing" | gzip -c | base64 -w 0  #.
	testDataCompressed = "H4sIAAAAAAAAAwXBAQoAIAgDwK/sa1KzglDQ9f/utNnEyBBDDStCm5h0e1fwLIitE+sDr6miHioAAAA="

	// echo -n "these contents are the default for testing" | base64 -w 0 | sha256sum | awk '{print $1}'  #.
	testDataEncodedId = "ba8cd27d74eb572956e09da49530c5ab2dd66ee946956e9d55a4cd09b76ab527"

	// echo -n "these contents are the default for testing" | gzip -c | base64 -w 0 | sha256sum | awk '{print $1}'  #.
	testDataCompressedId = "a358aafd3bebe1731735516b321d55bd8a58a64e0e2d92646a6a6fdb63751c5d"

	defaultDecompress = "false"
)

var snapshotDataSourceBooleanFields = []string{"decompress"}

func TestLocalSnapshotDataSourceMetadata(t *testing.T) {
	t.Run("Metadata function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalSnapshotDataSource
			want datasource.MetadataResponse
		}{
			{"Basic test", LocalSnapshotDataSource{}, datasource.MetadataResponse{TypeName: "file_local_snapshot"}},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				res := datasource.MetadataResponse{}
				tc.fit.Metadata(context.Background(), datasource.MetadataRequest{ProviderTypeName: "file"}, &res)
				got := res
				if got != tc.want {
					t.Errorf("%+v.Metadata() is %+v; want %+v", tc.fit, got, tc.want)
				}
			})
		}
	})
}

func TestLocalSnapshotDataSourceSchema(t *testing.T) {
	t.Run("Schema function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalSnapshotDataSource
			want datasource.SchemaResponse
		}{
			{"Basic test", LocalSnapshotDataSource{}, *getLocalSnapshotDataSourceSchema()},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := datasource.SchemaResponse{}
				tc.fit.Schema(context.Background(), datasource.SchemaRequest{}, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Schema() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

func TestLocalSnapshotDataSourceRead(t *testing.T) {
	t.Run("Read function", func(t *testing.T) {
		testCases := []struct {
			name string
			fit  LocalSnapshotDataSource
			have datasource.ReadRequest
			want datasource.ReadResponse
		}{
			{
				"Basic",
				LocalSnapshotDataSource{},
				// have
				getLocalSnapshotDataSourceReadRequest(t, map[string]string{
					"id":         "", // id is computed.
					"data":       "", // data is computed.
					"contents":   testDataEncoded,
					"decompress": defaultDecompress,
				}),
				// want
				getLocalSnapshotDataSourceReadResponse(t, map[string]string{
					"id":         testDataEncodedId,
					"data":       testDataContents,
					"contents":   testDataEncoded,
					"decompress": defaultDecompress,
				}),
			},
			{
				"Compressed",
				LocalSnapshotDataSource{},
				// have
				getLocalSnapshotDataSourceReadRequest(t, map[string]string{
					"id":         "", // id is computed.
					"data":       "", // data is computed.
					"contents":   testDataCompressed,
					"decompress": "true",
				}),
				// want
				getLocalSnapshotDataSourceReadResponse(t, map[string]string{
					"id":         testDataCompressedId,
					"data":       testDataContents,
					"contents":   testDataCompressed,
					"decompress": "true",
				}),
			},
		}
		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				r := getLocalSnapshotDataSourceReadResponseContainer()
				tc.fit.Read(context.Background(), tc.have, &r)
				got := r
				if diff := cmp.Diff(tc.want, got); diff != "" {
					t.Errorf("Read() mismatch (-want +got):\n%+v", diff)
				}
			})
		}
	})
}

// *** Test Helper Functions *** //

// Read.
func getLocalSnapshotDataSourceReadRequest(t *testing.T, data map[string]string) datasource.ReadRequest {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotDataSourceBooleanFields, key) { // snapshotDataSourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getLocalSnapshotDataSourceAttributeTypes(), stateMap)
	return datasource.ReadRequest{
		Config: tfsdk.Config{
			Raw:    stateValue,
			Schema: getLocalSnapshotDataSourceSchema().Schema,
		},
	}
}

func getLocalSnapshotDataSourceReadResponseContainer() datasource.ReadResponse {
	return datasource.ReadResponse{
		State: tfsdk.State{Schema: getLocalSnapshotDataSourceSchema().Schema},
	}
}

func getLocalSnapshotDataSourceReadResponse(t *testing.T, data map[string]string) datasource.ReadResponse {
	stateMap := make(map[string]tftypes.Value)
	for key, value := range data {
		if slices.Contains(snapshotDataSourceBooleanFields, key) { // snapshotDataSourceBooleanFields is a constant
			v, err := strconv.ParseBool(value)
			if err != nil {
				t.Errorf("Error converting %s to bool %s: ", value, err.Error())
			}
			stateMap[key] = tftypes.NewValue(tftypes.Bool, v)
		} else {
			stateMap[key] = tftypes.NewValue(tftypes.String, value)
		}
	}
	stateValue := tftypes.NewValue(getLocalSnapshotDataSourceAttributeTypes(), stateMap)
	return datasource.ReadResponse{
		State: tfsdk.State{
			Raw:    stateValue,
			Schema: getLocalSnapshotDataSourceSchema().Schema,
		},
	}
}

// The helpers helpers.
func getLocalSnapshotDataSourceAttributeTypes() tftypes.Object {
	return tftypes.Object{
		AttributeTypes: map[string]tftypes.Type{
			"id":         tftypes.String,
			"data":       tftypes.String,
			"contents":   tftypes.String,
			"decompress": tftypes.Bool,
		},
	}
}

func getLocalSnapshotDataSourceSchema() *datasource.SchemaResponse {
	var testDataSource LocalSnapshotDataSource
	r := &datasource.SchemaResponse{}
	testDataSource.Schema(context.Background(), datasource.SchemaRequest{}, r)
	return r
}
