package file_snapshot

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// The `var _` is a special Go construct that results in an unusable variable.
// The purpose of these lines is to make sure our LocalFileDataSource correctly implements the `datasource.DataSource“ interface.
// These will fail at compilation time if the implementation is not satisfied.
var _ datasource.DataSource = &SnapshotDataSource{}

func NewSnapshotDataSource() datasource.DataSource {
	return &SnapshotDataSource{}
}

type SnapshotDataSource struct{}

type SnapshotDataSourceModel struct {
	Id         types.String `tfsdk:"id"`
	Contents   types.String `tfsdk:"contents"`
	Data       types.String `tfsdk:"data"`
	Decompress types.Bool   `tfsdk:"decompress"`
}

func (r *SnapshotDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_snapshot" // file_snapshot
}

func (r *SnapshotDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "File Snapshot data source. \n" +
			"This data source retrieves the contents of a file from the output of a file_snapshot datasource." +
			"Warning! Using this resource places the plain text contents of the snapshot in your state file.",

		Attributes: map[string]schema.Attribute{
			"contents": schema.StringAttribute{
				MarkdownDescription: "The contents of the snapshot to retrieve. " +
					"This could be any gzip compressed base64 encoded data. " +
					"If the data isn't compressed, set the decompress argument to false, or leave it blank. " +
					"If the decompress argument is false, the data will be the base64 decoded contents.",
				Required:  true,
				Sensitive: true,
			},
			"decompress": schema.BoolAttribute{
				MarkdownDescription: "Whether or not to decompress the contents. " +
					"If left empty, this will default to false.",
				Optional: true,
				Computed: true,
			},
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the datasource. The SHA256 hash of the contents.",
				Computed:            true,
			},
			"data": schema.StringAttribute{
				MarkdownDescription: "The resulting data output. This is the plain text representation of the contents attribute. " +
					"This is computed by first decoding the data from base64, then decompressing the resulting gzip. " +
					"If decompress is false, then this will be the base64 decoded version of the contents.",
				Computed:  true,
				Sensitive: true,
			},
		},
	}
}

func (r *SnapshotDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	// This only configures the provider, so anything here must be available in the provider package to configure.
	// If you want to configure a client, do that in the Create/Read/Update/Delete functions.
	if req.ProviderData == nil {
		return
	}
}

func (r *SnapshotDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Read Request Object: %+v", req))

	var config SnapshotDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}
	contents := config.Contents.ValueString()
	decompress := config.Decompress.ValueBool()

	hasher := sha256.New()
	hasher.Write([]byte(contents))
	hashBytes := hasher.Sum(nil)
	hashString := hex.EncodeToString(hashBytes)

	config.Id = types.StringValue(hashString)
	d, err := base64.StdEncoding.DecodeString(contents)
	if err != nil {
		resp.Diagnostics.AddError("Error decoding file: ", err.Error())
		return
	}
	contents = string(d)

	if decompress {
		gzipReader, err := gzip.NewReader(bytes.NewReader([]byte(contents)))
		if err != nil {
			resp.Diagnostics.AddError("Error creating gzip reader: ", err.Error())
			return
		}
		defer gzipReader.Close()
		decompressedBytes, err := io.ReadAll(gzipReader)
		if err != nil {
			resp.Diagnostics.AddError("Error reading compressed bytes: ", err.Error())
			return
		}
		contents = string(decompressedBytes)
	}

	config.Data = types.StringValue(contents)

	resp.Diagnostics.Append(resp.State.Set(ctx, &config)...)
	tflog.Debug(ctx, fmt.Sprintf("Read Response Object: %+v", *resp))
}
