// SPDX-License-Identifier: MPL-2.0

package provider

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/boolvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// The `var _` is a special Go construct that results in an unusable variable.
// The purpose of these lines is to make sure our LocalFileResource correctly implements the `resource.Resource“ interface.
// These will fail at compilation time if the implementation is not satisfied.
var _ resource.Resource = &LocalResource{}
var _ resource.ResourceWithImportState = &LocalResource{}

// type FileClient struct{}

// func (f *FileClient) Create() {}
// func (f *FileClient) Read() {}
// func (f *FileClient) Update() {}
// func (f *FileClient) Delete() {}

func NewLocalResource() resource.Resource {
	return &LocalResource{}
}

// LocalResource defines the resource implementation.
// This facilitates the LocalResource class, it can now be used in functions with *LocalResource.
type LocalResource struct{}

// LocalResourceModel describes the resource data model.
type LocalResourceModel struct {
	Id            types.String `tfsdk:"id"`
	Name          types.String `tfsdk:"name"`
	Contents      types.String `tfsdk:"contents"`
	Directory     types.String `tfsdk:"directory"`
	Mode          types.String `tfsdk:"mode"`
	HmacSecretKey types.String `tfsdk:"hmac_secret_key"`
	Protected     types.Bool   `tfsdk:"protected"`
	// Fake          types.Bool   `tfsdk:"fake"`
}

func (r *LocalResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_local" // file_local resource
}

func (r *LocalResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Local File resource",

		Attributes: map[string]schema.Attribute{
			"name": schema.StringAttribute{
				MarkdownDescription: "File name, required.",
				Required:            true,
			},
			"contents": schema.StringAttribute{
				MarkdownDescription: "File contents, required.",
				Required:            true,
			},
			"directory": schema.StringAttribute{
				MarkdownDescription: "The directory where the file will be placed, defaults to the current working directory.",
				Optional:            true,
				Computed:            true, // whenever an argument has a default value it should have Computed: true
				Default:             stringdefault.StaticString("."),
			},
			"mode": schema.StringAttribute{
				MarkdownDescription: "The file permissions to assign to the file, defaults to '0600'.",
				Optional:            true,
				Computed:            true,
				Default:             stringdefault.StaticString("0600"),
			},
			"hmac_secret_key": schema.StringAttribute{
				MarkdownDescription: "A string used to generate the file identifier, " +
					"you can pass this value in the environment variable `TF_FILE_HMAC_SECRET_KEY`." +
					"The provider will use a hard coded value as the secret key for unprotected files.",
				Optional:  true,
				Computed:  true,
				Sensitive: true,
				// This is for arguments that may be calculated by the provider if left empty.
				// It tells the Plan that this argument, if unspecified, can eventually be whatever is in state.
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"id": schema.StringAttribute{
				MarkdownDescription: "Identifier derived from sha256+HMAC hash of file contents. " +
					"When setting 'protected' to true this argument is required. " +
					"However, when 'protected' is false then this should be left empty (computed by the provider).",
				Optional: true,
				Computed: true,
			},
			"protected": schema.BoolAttribute{
				MarkdownDescription: "Whether or not to fail update or create if the calculated id doesn't match the given id." +
					"When this is true, the 'id' field is required and must match what we calculate as the hash at both create and update times." +
					"If the 'id' configured doesn't match what we calculate then the provider will error rather than updating or creating the file." +
					"When setting this to true, you will need to either set the `TF_FILE_HMAC_SECRET_KEY` environment variable or set the hmac_secret_key argument.",
				Optional: true,
				Computed: true,
				// This tells Terraform that if this argument is changed, then we need to recreate the resource rather than updating it.
				// This means that if this argument is altered in the config then it won't make it to the update function.
				// So the plan's Protected argument must equal the state's
				PlanModifiers: []planmodifier.Bool{
					boolplanmodifier.RequiresReplace(),
				},
				Validators: []validator.Bool{
					// This tells Terraform that if this argument is set in the plan, you must also set the 'id' argument.
					boolvalidator.AlsoRequires(path.Expressions{
						path.MatchRoot("id"),
					}...),
				},
				Default: booldefault.StaticBool(false),
			},
		},
	}
}

// Configure the provider for the resource if necessary.
func (r *LocalResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	if req.ProviderData == nil {
		return
	}
}

// We should:
// - generate reality and state in the Create function
// - update state to match reality in the Read function
// - update state to config and update reality to config in the Update function by looking for differences in the state and the config
// - destroy reality and state in the Destroy function

func (r *LocalResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Request Object: %v", req))
	var err error
	var plan LocalResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	id := plan.Id.ValueString()
	name := plan.Name.ValueString()
	directory := plan.Directory.ValueString()
	contents := plan.Contents.ValueString()
	modeString := plan.Mode.ValueString()
	hmacSecretKey := plan.HmacSecretKey.ValueString()
	protected := plan.Protected.ValueBool()

	key := hmacSecretKey
	if key == "" {
		key = os.Getenv("TF_FILE_HMAC_SECRET_KEY")
		if key != "" {
			// key was in the environment, so we want to keep the secret key empty
			plan.HmacSecretKey = types.StringValue("")
		}
	}
	if protected {
		err := validateProtected(protected, id, key, contents)
		if err != nil {
			resp.Diagnostics.AddError("Error creating file: ", err.Error())
			return
		} // at this point we have an id, key, contents, protected is true, and our calculated id matches what was provided
	} else {
		id, err = calculateId(contents, "this-is-the-hmac-secret-key-that-will-be-used-to-calculate-the-hash-of-unprotected-files")
		if err != nil {
			resp.Diagnostics.AddError("Error creating file: ", "Problem calculating id from hard coded key: "+err.Error())
			return
		}
		plan.Id = types.StringValue(id)
		// the file isn't protected so we want the key to be an empty string in state
		plan.HmacSecretKey = types.StringValue("")
	}

	localFilePath := filepath.Join(directory, name)
	modeInt, err := strconv.ParseUint(modeString, 8, 32)
	if err != nil {
		resp.Diagnostics.AddError("Error reading file mode from config: ", err.Error())
		return
	}
	if err = os.WriteFile(localFilePath, []byte(contents), os.FileMode(modeInt)); err != nil {
		resp.Diagnostics.AddError("Error writing file: ", err.Error())
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
	tflog.Debug(ctx, fmt.Sprintf("Response Object: %v", *resp))
}

// Read runs at refresh time, which happens before all other functions and every time a function would be called.
// Read also runs when no other functions would be called.
// After Read, if the contents of the state don't match the contents of the plan, then the resource will be reconciled.
// We want to update the state to match reality so that differences can be detected.
func (r *LocalResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Request Object: %v", req))

	var state LocalResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	sName := state.Name.ValueString()
	sDirectory := state.Directory.ValueString()
	sContents := state.Contents.ValueString()
	sMode := state.Mode.ValueString()
	sHmacSecretKey := state.HmacSecretKey.ValueString()

	sFilePath := filepath.Join(sDirectory, sName)

	// If Possible, we should avoid reading the file into memory

	// The "real" (non-calculated) parts of the file are the path, the contents, and the mode

	// If the file doesn't exist at the path, then we need to (re)create it
	if _, err := os.Stat(sFilePath); os.IsNotExist(err) {
		resp.State.RemoveResource(ctx)
		return
	}

	// If the file's contents have changed, then we need to update the state
	c, err := os.ReadFile(sFilePath)
	if err != nil {
		resp.Diagnostics.AddError("Error reading file: ", err.Error())
		return
	}
	contents := string(c)
	if contents != sContents {
		// update state with actual contents
		state.Contents = types.StringValue(contents)
		// if we are updating the state contents, should we also update the state id?
		// state should reflect reality, but we want to make sure that protected files don't change without the correct id
		// we can't error here because then the user won't have the chance to update to the proper id?
		if sHmacSecretKey == "" {
			sHmacSecretKey = os.Getenv("TF_FILE_HMAC_SECRET_KEY")
		}

		id, err := calculateId(contents, sHmacSecretKey)
		if err != nil {
			resp.Diagnostics.AddError("Error reading file: ", "Problem calculating id from key: "+err.Error())
			return
		}
		state.Id = types.StringValue(id)
	}

	// If the file's mode has changed, then we need to update the state
	inf, err := os.Stat(sFilePath)
	if err != nil {
		resp.Diagnostics.AddError("Error reading file stat: ", err.Error())
		return
	}
	mode := fmt.Sprintf("%#o", inf.Mode().Perm())
	if mode != sMode {
		// update the state with the actual mode
		state.Mode = types.StringValue(mode)
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	tflog.Debug(ctx, fmt.Sprintf("Response Object: %v", *resp))
}

// For now, we are assuming Terraform has complete control over the file
// This means we don't need know anything about the actual file for updates, we just change the file if the plan doesn't match the state.
// The plan has the authority here, state and reality needs to match the plan.
func (r *LocalResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Request Object: %v", req))

	var config LocalResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	cId := config.Id.ValueString()
	cName := config.Name.ValueString()
	cContents := config.Contents.ValueString()
	cDirectory := config.Directory.ValueString()
	cMode := config.Mode.ValueString()
	cHmacSecretKey := config.HmacSecretKey.ValueString()
	cProtected := config.Protected.ValueBool()

	cFilePath := filepath.Join(cDirectory, cName)

	cKey := cHmacSecretKey
	if cKey == "" {
		cKey = os.Getenv("TF_FILE_HMAC_SECRET_KEY")
	}
	if cProtected {
		err := validateProtected(cProtected, cId, cKey, cContents)
		if err != nil {
			resp.Diagnostics.AddError("Error updating file: ", err.Error())
			return
		}
	} else {
		id, err := calculateId(cContents, "this-is-the-hmac-secret-key-that-will-be-used-to-calculate-the-hash-of-unprotected-files")
		if err != nil {
			resp.Diagnostics.AddError("Error updating file: ", "Problem calculating id from hard coded key: "+err.Error())
			return
		}
		config.Id = types.StringValue(id)
		config.HmacSecretKey = types.StringValue("")
	}

	var reality LocalResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &reality)...)
	if resp.Diagnostics.HasError() {
		return
	}

	rName := reality.Name.ValueString()
	rContents := reality.Contents.ValueString()
	rDirectory := reality.Directory.ValueString()
	rMode := reality.Mode.ValueString()

	rFilePath := filepath.Join(rDirectory, rName)

	if rFilePath != cFilePath {
		// config is changing the file path, we need to move the file
		err := os.Rename(rFilePath, cFilePath)
		if err != nil {
			resp.Diagnostics.AddError("Error moving file: ", err.Error())
			return
		}
	} // the config's file path (cFilePath) is now accurate

	if rMode != cMode {
		// the config is changing the mode
		modeInt, err := strconv.ParseUint(cMode, 8, 32)
		if err != nil {
			resp.Diagnostics.AddError("Error reading file mode from config: ", err.Error())
			return
		}
		err = os.Chmod(cFilePath, os.FileMode(modeInt))
		if err != nil {
			resp.Diagnostics.AddError("Error changing file mode: ", err.Error())
			return
		}
	} // the config's mode (cMode) is now accurate

	if cContents != rContents {
		// config is changing the contents
		modeInt, err := strconv.ParseUint(cMode, 8, 32)
		if err != nil {
			resp.Diagnostics.AddError("Error reading file mode from config: ", err.Error())
			return
		}
		if err = os.WriteFile(cFilePath, []byte(cContents), os.FileMode(modeInt)); err != nil {
			resp.Diagnostics.AddError("Error writing file: ", err.Error())
			return
		}
	} // the config's contents (cContents) are now accurate

	// the path, mode, and contents are all of the "real" parts of the file
	// the id is calculated from the secret key and contents,
	//   so if the config's id is correct, then its key is correct
	//   and there isn't anything to change in reality

	resp.Diagnostics.Append(resp.State.Set(ctx, &config)...)
	tflog.Debug(ctx, fmt.Sprintf("Response Object: %v", *resp))
}

func (r *LocalResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, fmt.Sprintf("Request Object: %v", req))

	var state LocalResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	name := state.Name.ValueString()
	directory := state.Directory.ValueString()

	protected := state.Protected.ValueBool()
	id := state.Id.ValueString()
	key := state.HmacSecretKey.ValueString()
	if key == "" {
		key = os.Getenv("TF_FILE_HMAC_SECRET_KEY")
	}
	contents := state.Contents.ValueString()

	localFilePath := filepath.Join(directory, name)

	// we need to validate the id before we can delete a protected file
	if protected {
		err := validateProtected(protected, id, key, contents)
		if err != nil {
			resp.Diagnostics.AddError("Error deleting file: ", err.Error())
			return
		}
	}

	if err := os.Remove(localFilePath); err != nil {
		tflog.Error(ctx, "Failed to delete file: "+err.Error())
		return
	}

	tflog.Debug(ctx, fmt.Sprintf("Response Object: %v", *resp))
}

func (r *LocalResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}

// **** Internal Functions **** //

// generates an HMAC-SHA256 hash of a file or a string using a secret key.
func calculateId(contents string, hmacSecretKey string) (string, error) {
	// If possible, we should avoid reading the file into memory

	reader := strings.NewReader(contents)
	hasher := hmac.New(sha256.New, []byte(hmacSecretKey))
	// Copy the contents to the hasher without reading it into memory.
	if _, err := io.Copy(hasher, reader); err != nil {
		return "", fmt.Errorf("failed to copy file content to hmac hasher: %w", err)
	}
	hmacHash := hex.EncodeToString(hasher.Sum(nil))
	return hmacHash, nil
}

func validateProtected(protected bool, id string, hmacSecretKey string, contents string) error {
	if !protected && id != "" {
		return fmt.Errorf("protected is false, but an id was provided. Either set 'protected' to 'true', or remove 'id' from configuration")
	}
	if protected && id == "" {
		return fmt.Errorf("protected is true, but no id was provided, please provide an 'id' when setting file to protected")
	}
	key := hmacSecretKey
	if protected && key == "" {
		return fmt.Errorf(
			"protected is true, but no hmac secret key was provided, " +
				"please provide 'hmac_secret_key' argument or set the TF_FILE_HMAC_SECRET_KEY environment variable when setting file to protected",
		)
	}
	if !protected && hmacSecretKey != "" {
		// This error is because we will be ignoring the key if the file isn't protected
		// It would be pretty confusing to the user to see a hmac_secret_key that isn't being used to calculate the id.
		// We use hmacSecretKey here rather than 'key' because it is less confusing to the user for us to ignore the environment variable.
		return fmt.Errorf(
			"protected is false, but a hmac_secret_key was provided, " +
				"either set 'protected' to true or don't provide an hmac secret",
		)
	}
	// if 'protected' is true, then we have an hmac secret 'key' and the user provided an 'id'
	if protected {
		calculatedId, err := calculateId(contents, key)
		if err != nil {
			return fmt.Errorf("problem calculating id from configuration: %s", err.Error())
		}
		if id != calculatedId {
			return fmt.Errorf(
				"protected is true and a key and id were provided, but the id provided doesn't match our calculations. " +
					"Please try recalculating your id using a sha256 bit algorithm with the hmac secret key you provided. " +
					"Here is a bash line that should be equivalent: `openssl dgst -sha256 -hmac \"$TF_FILE_HMAC_SECRET_KEY\" \"$FILE_PATH\" | awk '{print $2}'`. " +
					"Please make sure your `TF_FILE_HMAC_SECRET_KEY` environment variable is correct if that is how you configured the key",
			)
		} // at this point we have an id, key, contents, protected is true, and our calculated id matches what was provided
	}
	return nil
}
