package file_local_snapshot

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
	c "github.com/rancher/terraform-provider-file/internal/provider/file_client"
)

// The `var _` is a special Go construct that results in an unusable variable.
// The purpose of these lines is to make sure our LocalFileResource correctly implements the `resource.Resource“ interface.
// These will fail at compilation time if the implementation is not satisfied.
var _ resource.Resource = &LocalSnapshotResource{}
var _ resource.ResourceWithImportState = &LocalSnapshotResource{}

func NewLocalSnapshotResource() resource.Resource {
	return &LocalSnapshotResource{}
}

type LocalSnapshotResource struct {
	client c.FileClient
}

// LocalSnapshotResourceModel describes the resource data model.
type LocalSnapshotResourceModel struct {
	Id            types.String `tfsdk:"id"`
	Name          types.String `tfsdk:"name"`
	Directory     types.String `tfsdk:"directory"`
	LocalSnapshot      types.String `tfsdk:"snapshot"`
	UpdateTrigger types.String `tfsdk:"update_trigger"`
	Compress      types.Bool   `tfsdk:"compress"`
}

func (r *LocalSnapshotResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_local_snapshot" // file_local_snapshot
}

func (r *LocalSnapshotResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "File LocalSnapshot resource. \n" +
			"This resource saves some content in state and doesn't update it until the trigger argument changes. " +
			"The refresh phase doesn't update state, instead " +
			"the state can only change on create or update and only when the update_trigger argument changes.",

		Attributes: map[string]schema.Attribute{
			"name": schema.StringAttribute{
				MarkdownDescription: "Name of the file to save. Changing this forces recreate, moving the file isn't supported.",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(), // the location of the file shouldn't change
				},
			},
			"directory": schema.StringAttribute{
				MarkdownDescription: "Path of the file to save. Changing this forces recreate, moving the file isn't supported.",
				Optional:            true,
				Computed:            true, // whenever an argument has a default value it should have Computed: true
				Default:             stringdefault.StaticString("."),
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(), // the location of the file shouldn't change
				},
			},
			"update_trigger": schema.StringAttribute{
				MarkdownDescription: "When this argument changes the snapshot will be updated.",
				Required:            true,
			},
			"compress": schema.BoolAttribute{
				MarkdownDescription: "Whether the provider should compress the contents and snapshot or not. Defaults to 'false'. " +
					"When set to 'true' the provider will compress the contents and snapshot attributes using the gzip compression algorithm. " +
					"Changing this attribute forces recreate, compressing snapshots which are already saved in state isn't supported. " +
					"Warning! To prevent memory errors the provider generates temporary files to facilitate encoding and compression.",
				Optional: true,
				Computed: true,
				Default:  booldefault.StaticBool(false),
				PlanModifiers: []planmodifier.Bool{
					boolplanmodifier.RequiresReplace(), // compressing files which were previously uncompressed isn't supported
				},
			},
			"snapshot": schema.StringAttribute{
				MarkdownDescription: "Base64 encoded contents of the file specified in the name and directory fields. " +
					"This data will be added on create and only updated when the update_trigger field changes. " +
					"Warning! To prevent memory errors the provider generates temporary files to facilitate encoding and compression.",
				Computed:  true,
				Sensitive: true,
			},
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the resource. The SHA256 hash of the base64 encoded contents.",
				Computed:            true,
			},
		},
	}
}

func (r *LocalSnapshotResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	// This only configures the provider, so anything here must be available in the provider package to configure.
	// If you want to configure a client, do that in the Create/Read/Update/Delete functions.
	if req.ProviderData == nil {
		return
	}
}

// We should:
// - generate reality and state to match plan in the Create function
// - update state to match reality in the Read function
// - update reality and state to match plan in the Update function (don't compare old state, just override)
// - destroy reality in the Destroy function (state is handled automatically)

func (r *LocalSnapshotResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Create Request Object: %+v", req))

	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default OsFileClient.")
		r.client = &c.OsFileClient{}
	}

	var plan LocalSnapshotResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	pName := plan.Name.ValueString()
	pDir := plan.Directory.ValueString()
	pCompress := plan.Compress.ValueBool()

	name := pName
	if pCompress {
		err := r.client.Compress(pDir, pName, "compressed_"+pName)
		if err != nil {
			resp.Diagnostics.AddError("Error compressing file: ", err.Error())
			return
		}
		name = "compressed_" + pName
	}

	err := r.client.Encode(pDir, name, "encoded_"+pName)
	if err != nil {
		resp.Diagnostics.AddError("Error encoding file: ", err.Error())
		return
	}
	_, encodedContents, err := r.client.Read(pDir, "encoded_"+pName)
	if err != nil {
		resp.Diagnostics.AddError("Error reading encoded file: ", err.Error())
		return
	}
	plan.LocalSnapshot = types.StringValue(encodedContents)

	hash, err := r.client.Hash(pDir, pName)
	if err != nil {
		resp.Diagnostics.AddError("Error hashing file: ", err.Error())
		return
	}
	plan.Id = types.StringValue(hash)

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)

	if pCompress {
		err := r.client.Delete(pDir, "compressed_"+pName)
		if err != nil {
			resp.Diagnostics.AddError("Error cleaning up temporary compressed file: ", err.Error())
			return
		}
	}

	err = r.client.Delete(pDir, "encoded_"+pName)
	if err != nil {
		resp.Diagnostics.AddError("Error cleaning up temporary encoded file: ", err.Error())
		return
	}

	tflog.Debug(ctx, fmt.Sprintf("Create Response Object: %+v", *resp))
}

func (r *LocalSnapshotResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Read Request Object: %+v", req))

	var state LocalSnapshotResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// read is a no-op

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	tflog.Debug(ctx, fmt.Sprintf("Read Response Object: %+v", *resp))
}

// a difference between the plan and the state has been found.
// we want to update reality and state to match the plan.
// our snapshot will only update if the update trigger has changed.
func (r *LocalSnapshotResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Update Request Object: %+v", req))

	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default OsFileClient.")
		r.client = &c.OsFileClient{}
	}

	var plan LocalSnapshotResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	pName := plan.Name.ValueString()
	pDir := plan.Directory.ValueString()
	pUpdateTrigger := plan.UpdateTrigger.ValueString()

	var state LocalSnapshotResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	sUpdateTrigger := state.UpdateTrigger.ValueString()
	sLocalSnapshot := state.LocalSnapshot.ValueString()
	sCompress := state.Compress.ValueBool()
	sId := state.Id.ValueString()

	plan.Id = types.StringValue(sId)

	if pUpdateTrigger != sUpdateTrigger {
		tflog.Debug(ctx, fmt.Sprintf("Update trigger has changed from %s to %s, updating snapshot.", sUpdateTrigger, pUpdateTrigger))

		name := pName
		if sCompress {
			err := r.client.Compress(pDir, pName, "compressed_"+pName)
			if err != nil {
				resp.Diagnostics.AddError("Error compressing file: ", err.Error())
				return
			}
			name = "compressed_" + pName
		}

		err := r.client.Encode(pDir, name, "encoded_"+pName)
		if err != nil {
			resp.Diagnostics.AddError("Error encoding file: ", err.Error())
			return
		}
		_, encodedContents, err := r.client.Read(pDir, "encoded_"+pName)
		if err != nil {
			resp.Diagnostics.AddError("Error reading encoded file: ", err.Error())
			return
		}
		plan.LocalSnapshot = types.StringValue(encodedContents)
	} else {
		tflog.Debug(ctx, fmt.Sprintf("Update trigger hasn't changed, keeping previous snapshot (%s).", sLocalSnapshot))
		plan.LocalSnapshot = types.StringValue(sLocalSnapshot)
	}

	tflog.Debug(ctx, fmt.Sprintf("Setting state to this plan: \n%+v", &plan))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)

	if sCompress {
		err := r.client.Delete(pDir, "compressed_"+pName)
		if err != nil {
			resp.Diagnostics.AddError("Error cleaning up temporary compressed file: ", err.Error())
			return
		}
	}
	err := r.client.Delete(pDir, "encoded_"+pName)
	if err != nil {
		resp.Diagnostics.AddError("Error cleaning up temporary encoded file: ", err.Error())
		return
	}
	tflog.Debug(ctx, fmt.Sprintf("Update Response Object: %+v", *resp))
}

func (r *LocalSnapshotResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Delete Request Object: %+v", req))

	// delete is a no-op

	tflog.Debug(ctx, fmt.Sprintf("Delete Response Object: %+v", *resp))
}

func (r *LocalSnapshotResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
