package boilerplate

import (
	"context"
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
var _ resource.Resource = &BoilerplateResource{}
var _ resource.ResourceWithImportState = &BoilerplateResource{}

type boilerplateClient interface {
	Create(id string) error
	Read(id string) (string, error)
	Update(id string) error
	Delete(id string) error
}

func NewBoilerplateResource() resource.Resource {
	return &BoilerplateResource{}
}

type BoilerplateResource struct {
	client boilerplateClient
}

// BoilerplateResourceModel describes the resource data model.
type BoilerplateResourceModel struct {
	Id types.String `tfsdk:"id"`
}

func (r *BoilerplateResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_boilerplate" // file_boilerplate
}

func (r *BoilerplateResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "File Boilerplate resource. \n" +
			"This resource serves as a starting place to build a new resource. " +
			"Just copy this file, place it in the appropriate folder in internal/provider, " +
			"or create a new folder if it makes logical sense." +
			"Copy the boilerplate test file and client as well, " +
			"rename everything (search and replace 'Boilerplate'), " +
			"and you have a working, testable, stub, ready for logic.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the resource.",
				Required:            true,
			},
		},
	}
}

func (r *BoilerplateResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *BoilerplateResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Create Request Object: %+v", req))

	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default defaultBoilerplateClient.")
		r.client = &defaultBoilerplateClient{}
	}

	var plan BoilerplateResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	pId := plan.Id.ValueString()

	_ = r.client.Create(pId)

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
	tflog.Debug(ctx, fmt.Sprintf("Create Response Object: %+v", *resp))
}

// Read runs at refresh time which happens before all other functions and every time another function would be called.
func (r *BoilerplateResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Read Request Object: %+v", req))

	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default defaultBoilerplateClient.")
		r.client = &defaultBoilerplateClient{}
	}

	var state BoilerplateResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	sId := state.Id.ValueString()

	// Best practice is for the Read function to be idempotent and only update state, avoid side-effects in reality.
	rId, _ := r.client.Read(sId)
	state.Id = types.StringValue(rId)

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	tflog.Debug(ctx, fmt.Sprintf("Read Response Object: %+v", *resp))
}

func (r *BoilerplateResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Update Request Object: %+v", req))

	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default defaultBoilerplateClient.")
		r.client = &defaultBoilerplateClient{}
	}

	var plan BoilerplateResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	pId := plan.Id.ValueString()

	// Best practice is not to read reality, instead compare state to plan and update reality accordingly.
	// The ideal solution is to blindly update reality to match plan, but this is only possible when talking to idempotent APIs.
	_ = r.client.Update(pId)

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
	tflog.Debug(ctx, fmt.Sprintf("Update Response Object: %+v", *resp))
}

func (r *BoilerplateResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Delete Request Object: %+v", req))

	if r.client == nil {
		tflog.Debug(ctx, "Configuring client with default defaultBoilerplateClient.")
		r.client = &defaultBoilerplateClient{}
	}

	var state BoilerplateResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	sId := state.Id.ValueString()

	// There is no need to update state in the delete function, the framework will handle that for you.
	_ = r.client.Delete(sId)

	tflog.Debug(ctx, fmt.Sprintf("Delete Response Object: %+v", *resp))
}

func (r *BoilerplateResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
