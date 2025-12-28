package definitions

import (
	"fmt"

	"reManager/internal/commands"
	"reManager/internal/component"
)

var XoviComponent = &component.ComponentDefinition{
	ID:          "xovi",
	Name:        "Xovi",
	Description: "Base framework for reMarkable modifications",
	Version:     "v16-14112025",
	Author:      "asivery",

	Dependencies: []string{},

	CheckInstalled: func(ctx component.CommandContext) component.CommandResult {
		return commands.TestExists("/home/root/xovi", commands.PathDirectory)
	},

	Install: func(ctx component.CommandContext) []component.CommandResult {
		archTesting := commands.GetArchiveArch(ctx.Arch)
		baseUrl := "https://github.com/asivery/rm-xovi-extensions/releases/download/v16-14112025"

		return []component.CommandResult{
			commands.ChangeDirectory("/home/root"),
			commands.Conditional(
				"test -f curl",
				"echo \"curl already exists\"",
				"wget -q https://github.com/moparisern/remarkable-curl/releases/download/v0.1/curl-reMarkable2 -O curl && chmod +x curl",
			),
			{
				Script:      fmt.Sprintf("./curl -Lo extensions.zip %s/extensions-%s.zip", baseUrl, archTesting),
				Description: "Download xovi extensions",
			},
			{
				Script:      "unzip -o -d extensions extensions.zip && rm extensions.zip",
				Description: "Extract extensions",
			},
			{
				Script:      "bash extensions/install-xovi-for-rm",
				Description: "Run xovi installer",
			},
		}
	},

	PreUninstall: &component.LifecycleHook{
		Type: component.HookTypeCustom,
		Execute: func(ctx component.CommandContext) (*component.HookExecutionResult, error) {
			return &component.HookExecutionResult{
				Command: &component.CommandResult{
					Script:      "/home/root/xovi/stock",
					Description: "Restore device to stock state",
				},
			}, nil
		},
	},

	Uninstall: func(ctx component.CommandContext) []component.CommandResult {
		return []component.CommandResult{
			commands.RemoveDirectory("/home/root/xovi"),
			commands.RemoveDirectory("/home/root/extensions"),
		}
	},

	Enable: func(ctx component.CommandContext) *component.CommandResult {
		return &component.CommandResult{
			Script:      "/home/root/xovi/start",
			Description: "Start xovi",
		}
	},

	Disable: func(ctx component.CommandContext) *component.CommandResult {
		return &component.CommandResult{
			Script:      "/home/root/xovi/stop",
			Description: "Stop xovi",
		}
	},

	MaintenanceCommands: []component.MaintenanceCommand{
		{
			ID:          "start",
			Label:       "Xovi Start",
			Description: "Start the xovi framework",
			Command: func(ctx component.CommandContext) []component.CommandResult {
				return []component.CommandResult{{Script: "/home/root/xovi/start", Description: "Start xovi"}}
			},
		},
		{
			ID:               "debug",
			Label:            "Xovi Debug",
			Description:      "Run xovi in debug mode with live output",
			RequiresTerminal: true,
			AllowStop:        true,
			Command: func(ctx component.CommandContext) []component.CommandResult {
				return []component.CommandResult{{Script: "/home/root/xovi/debug", Description: "Run xovi debug", RequiresPTY: true}}
			},
		},
		{
			ID:               "stock",
			Label:            "Xovi Stock",
			Description:      "Restore device to stock remarkable software",
			RequiresTerminal: true,
			Command: func(ctx component.CommandContext) []component.CommandResult {
				return []component.CommandResult{{Script: "/home/root/xovi/stock", Description: "Restore stock"}}
			},
		},
	},

	Category:       "core",
	Tags:           []string{"framework", "required"},
	RequiresReboot: false,
}
