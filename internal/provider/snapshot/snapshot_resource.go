package snapshot

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// The `var _` is a special Go construct that results in an unusable variable.
// The purpose of these lines is to make sure our LocalFileResource correctly implements the `resource.Resource“ interface.
// These will fail at compilation time if the implementation is not satisfied.
var _ resource.Resource = &SnapshotResource{}
var _ resource.ResourceWithImportState = &SnapshotResource{}

func NewSnapshotResource() resource.Resource {
	return &SnapshotResource{}
}

type SnapshotResource struct{}

// SnapshotResourceModel describes the resource data model.
type SnapshotResourceModel struct {
	Id            types.String `tfsdk:"id"`
	Contents      types.String `tfsdk:"contents"`
	Snapshot      types.String `tfsdk:"snapshot"`
	UpdateTrigger types.String `tfsdk:"update_trigger"`
}

func (r *SnapshotResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_snapshot" // file_snapshot
}

func (r *SnapshotResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "File Snapshot resource. \n" +
			"This resource saves some content in state and doesn't update it until the trigger argument changes. " +
			"Importantly, this resource ignores changes in the configuration for the contents argument." +
			"The refresh phase doesn't update state, instead " +
			"the state can only change on create or update and only when the update_trigger argument changes.",

		Attributes: map[string]schema.Attribute{
			"contents": schema.StringAttribute{
				MarkdownDescription: "Contents to save. While this argument is exposed, you shouldn't use its output. " +
					"Instead use the snapshot attribute to get the data saved in the snapshot.",
				Required: true,
			},
			"update_trigger": schema.StringAttribute{
				MarkdownDescription: "When this argument changes the snapshot will be updated to whatever is in the contents.",
				Required:            true,
			},
			"snapshot": schema.StringAttribute{
				MarkdownDescription: "Saved contents. This will match the contents during create and whenever the update_trigger changes.",
				Computed:            true,
			},
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the resource. The SHA256 hash of the base64 encoded contents.",
				Computed:            true,
			},
		},
	}
}

func (r *SnapshotResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *SnapshotResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Create Request Object: %+v", req))

	var plan SnapshotResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	pContents := plan.Contents.ValueString()
	encodedContents := base64.StdEncoding.EncodeToString([]byte(pContents))
	h := sha256.New()
	h.Write([]byte(encodedContents))
	contentsHash := h.Sum(nil)
	hexContents := hex.EncodeToString(contentsHash)

	plan.Id = types.StringValue(hexContents)
	plan.Snapshot = types.StringValue(pContents)

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
	tflog.Debug(ctx, fmt.Sprintf("Create Response Object: %+v", *resp))
}

func (r *SnapshotResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Read Request Object: %+v", req))

	var state SnapshotResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// read is a no-op

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	tflog.Debug(ctx, fmt.Sprintf("Read Response Object: %+v", *resp))
}

func (r *SnapshotResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Update Request Object: %+v", req))

	var plan SnapshotResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	pContents := plan.Contents.ValueString()
	pUpdateTrigger := plan.UpdateTrigger.ValueString()

	var state SnapshotResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	sUpdateTrigger := state.UpdateTrigger.ValueString()
	sSnapshot := state.Snapshot.ValueString()
	sId := state.Id.ValueString()

	encodedContents := base64.StdEncoding.EncodeToString([]byte(pContents))
	h := sha256.New()
	h.Write([]byte(encodedContents))
	contentsHash := h.Sum(nil)
	hexContents := hex.EncodeToString(contentsHash)

	if pUpdateTrigger != sUpdateTrigger {
		tflog.Debug(
      ctx,
      fmt.Sprintf("Update trigger has changed from %s to %s, updating snapshot to contents and id.", sUpdateTrigger, pUpdateTrigger),
    )
		plan.Snapshot = types.StringValue(pContents)
		plan.Id = types.StringValue(hexContents)
	} else {
		tflog.Debug(ctx, fmt.Sprintf("Update trigger hasn't changed, keeping previous snapshot (%s) and id (%s).", sSnapshot, sId))
		plan.Snapshot = types.StringValue(sSnapshot)
		plan.Id = types.StringValue(sId)
	}
  tflog.Debug(ctx, fmt.Sprintf("Setting state to this plan: \n%+v", &plan))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
	tflog.Debug(ctx, fmt.Sprintf("Update Response Object: %+v", *resp))
}

func (r *SnapshotResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Delete Request Object: %+v", req))

	// delete is a no-op

	tflog.Debug(ctx, fmt.Sprintf("Delete Response Object: %+v", *resp))
}

func (r *SnapshotResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
