// SPDX-License-Identifier: MPL-2.0

package local

import (
	"context"
	"fmt"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// The `var _` is a special Go construct that results in an unusable variable.
// The purpose of these lines is to make sure our LocalFileResource correctly implements the `resource.Resource“ interface.
// These will fail at compilation time if the implementation is not satisfied.
var _ datasource.DataSource = &LocalDataSource{}

func NewLocalDataSource() datasource.DataSource {
	return &LocalDataSource{}
}

type LocalDataSource struct {
	client fileClient
}

type LocalDataSourceModel struct {
	Id            types.String `tfsdk:"id"`
	Name          types.String `tfsdk:"name"`
	Directory     types.String `tfsdk:"directory"`
	Contents      types.String `tfsdk:"contents"`
	Permissions   types.String `tfsdk:"permissions"`
	HmacSecretKey types.String `tfsdk:"hmac_secret_key"`
}

func (r *LocalDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_local" // file_local datasource
}

func (r *LocalDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Local File DataSource",

		Attributes: map[string]schema.Attribute{
			"name": schema.StringAttribute{
				MarkdownDescription: "File name, required.",
				Required:            true,
			},
			"directory": schema.StringAttribute{
				MarkdownDescription: "The directory where the file exists.",
				Required:            true,
			},
			"hmac_secret_key": schema.StringAttribute{
				MarkdownDescription: "A string used to generate the file identifier, " +
					"you can pass this value in the environment variable `TF_FILE_HMAC_SECRET_KEY`. ",
				Optional:  true,
				Computed:  true,
				Sensitive: true,
			},
			"contents": schema.StringAttribute{
				MarkdownDescription: "The file contents.",
				Computed:            true,
			},
			"permissions": schema.StringAttribute{
				MarkdownDescription: "The file permissions.",
				Computed:            true,
			},
			"id": schema.StringAttribute{
				MarkdownDescription: "Identifier derived from sha256+HMAC hash of file contents. ",
				Computed:            true,
			},
		},
	}
}

func (r *LocalDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	if req.ProviderData == nil {
		return
	}
}

// Read runs before all other resources are run, datasources only get the Read function.
func (r *LocalDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Request Object: %#v", req))

	// Allow the ability to inject a file client, but use the osFileClient by default.
	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default osFileClient.")
		r.client = &osFileClient{}
	}

	var config LocalDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	cName := config.Name.ValueString()
	cDirectory := config.Directory.ValueString()
	cPerm := config.Permissions.ValueString()
	cHmacSecretKey := config.HmacSecretKey.ValueString()

	cKey := cHmacSecretKey
	if cKey == "" {
		tflog.Debug(ctx, "Checking for secret key in environment variable TF_FILE_HMAC_SECRET_KEY.")
		cKey = os.Getenv("TF_FILE_HMAC_SECRET_KEY")
	}

	if cKey == "" {
		tflog.Debug(ctx, "Key not found, attempting to use constant.")
		cKey = unprotectedHmacSecret // this is a constant defined in file_local_resource.go
	}

	perm, contents, err := r.client.Read(cDirectory, cName)
	if err != nil && err.Error() == "File not found." {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		resp.Diagnostics.AddError("Error reading file: ", err.Error())
		return
	}

	// update state with actual contents
	config.Contents = types.StringValue(contents)
	id, err := calculateId(contents, cKey)
	if err != nil {
		resp.Diagnostics.AddError("Error reading file: ", "Problem calculating id from key: "+err.Error())
		return
	}
	config.Id = types.StringValue(id)

	if perm != cPerm {
		// update the state with the actual mode
		config.Permissions = types.StringValue(perm)
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &config)...)
	tflog.Debug(ctx, fmt.Sprintf("Response Object: %#v", *resp))
}
