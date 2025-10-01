// SPDX-License-Identifier: MPL-2.0

package file_local_directory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
	c "github.com/rancher/terraform-provider-file/internal/provider/directory_client"
)

// The `var _` is a special Go construct that results in an unusable variable.
// The purpose of these lines is to make sure our LocalDirectoryFileResource correctly implements the `resource.Resource“ interface.
// These will fail at compilation time if the implementation is not satisfied.
var _ datasource.DataSource = &LocalDirectoryDataSource{}

func NewLocalDirectoryDataSource() datasource.DataSource {
	return &LocalDirectoryDataSource{}
}

type LocalDirectoryDataSource struct {
	client c.DirectoryClient
}

type LocalDirectoryDataSourceModel struct {
	Id          types.String                  `tfsdk:"id"`
	Path        types.String                  `tfsdk:"path"`
	Permissions types.String                  `tfsdk:"permissions"`
	Files       []LocalDirectoryFileInfoModel `tfsdk:"files"`
}

type LocalDirectoryFileInfoModel struct {
	Name         types.String `tfsdk:"name"`
	Size         types.String `tfsdk:"size"`
	Permissions  types.String `tfsdk:"permissions"`
	LastModified types.String `tfsdk:"last_modified"`
	IsDirectory  types.String `tfsdk:"is_directory"`
}

func (r *LocalDirectoryDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_local_directory" // file_local_directory datasource
}

func (r *LocalDirectoryDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "LocalDirectory File DataSource",

		Attributes: map[string]schema.Attribute{
			"path": schema.StringAttribute{
				MarkdownDescription: "Path to directory.",
				Required:            true,
			},
			"permissions": schema.StringAttribute{
				MarkdownDescription: "Permissions of the directory.",
				Computed:            true,
			},
			"files": schema.ListNestedAttribute{
				MarkdownDescription: "List of information about files in the directory.",
				Computed:            true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"name": schema.StringAttribute{
							MarkdownDescription: "The file's name. ",
							Computed:            true,
						},
						"size": schema.StringAttribute{
							MarkdownDescription: "The file's size in bytes. ",
							Computed:            true,
						},
						"permissions": schema.StringAttribute{
							MarkdownDescription: "The file's permissions mode expressed in string format, eg. '0600'. ",
							Computed:            true,
						},
						"last_modified": schema.StringAttribute{
							MarkdownDescription: "The UTC date of the last time the file was updated. ",
							Computed:            true,
						},
						"is_directory": schema.StringAttribute{
							MarkdownDescription: "A string representation of whether or not the item is a directory or a file. " +
								"This will be 'true' if the item is a directory, or 'false' if it isn't.",
							Computed: true,
						},
					},
				},
			},
			"id": schema.StringAttribute{
				MarkdownDescription: "Identifier derived from sha256 hash of path. ",
				Computed:            true,
			},
		},
	}
}

func (r *LocalDirectoryDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	if req.ProviderData == nil {
		return
	}
}

// Read runs before all other resources are run, datasources only get the Read function.
func (r *LocalDirectoryDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Request Object: %#v", req))

	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default OsDirectoryClient.")
		r.client = &c.OsDirectoryClient{}
	}

	var config LocalDirectoryDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}
	id := config.Id.ValueString()
	path := config.Path.ValueString()

	perm, files, err := r.client.Read(path)
	if err != nil && err.Error() == "directory not found" {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		resp.Diagnostics.AddError("failed to read directory", err.Error())
		return
	}

	if id == "" {
		hasher := sha256.New()
		hasher.Write([]byte(path))
		id = hex.EncodeToString(hasher.Sum(nil))
		config.Id = types.StringValue(id)
	}
	config.Permissions = types.StringValue(perm)

	config.Files = []LocalDirectoryFileInfoModel{}
	for fileName, fileData := range files {
		fileInfo := LocalDirectoryFileInfoModel{
			Name:         types.StringValue(fileName),
			Size:         types.StringValue(fileData["Size"]),
			Permissions:  types.StringValue(fileData["Mode"]),
			LastModified: types.StringValue(fileData["ModTime"]),
			IsDirectory:  types.StringValue(fileData["IsDir"]),
		}
		config.Files = append(config.Files, fileInfo)
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &config)...)
	tflog.Debug(ctx, fmt.Sprintf("Response Object: %#v", *resp))
}
