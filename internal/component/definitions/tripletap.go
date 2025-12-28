package definitions

import (
	"reManager/internal/commands"
	"reManager/internal/component"
)

var TripletapComponent = &component.ComponentDefinition{
	ID:          "tripletap",
	Name:        "Tripletap",
	Description: "Start xovi by triple-pressing the power button",
	Version:     "main",
	Author:      "rmitchellscott",

	Dependencies: []string{"xovi"},

	CheckInstalled: func(ctx component.CommandContext) component.CommandResult {
		return commands.TestExists("/home/root/xovi-tripletap/uninstall.sh", commands.PathFile)
	},

	Install: func(ctx component.CommandContext) []component.CommandResult {
		return []component.CommandResult{
			{
				Script:      "cd /home/root && wget -qO- https://raw.githubusercontent.com/rmitchellscott/xovi-tripletap/main/install.sh | bash",
				Description: "Download and run tripletap installer",
			},
		}
	},

	Uninstall: func(ctx component.CommandContext) []component.CommandResult {
		return []component.CommandResult{
			{
				Script:      "/home/root/xovi-tripletap/uninstall.sh",
				Description: "Run tripletap uninstaller",
			},
		}
	},

	MaintenanceCommands: []component.MaintenanceCommand{
		{
			ID:          "enable",
			Label:       "Re-enable After Updates",
			Description: "Re-enable tripletap service (run after software updates)",
			Command: func(ctx component.CommandContext) []component.CommandResult {
				return []component.CommandResult{
					{
						Script:      "/home/root/xovi-tripletap/enable.sh",
						Description: "Enable tripletap service",
					},
				}
			},
		},
		{
			ID:          "disable",
			Label:       "Disable Service",
			Description: "Stop and disable the tripletap systemd service",
			Command: func(ctx component.CommandContext) []component.CommandResult {
				return []component.CommandResult{
					{
						Script:      "systemctl disable xovi-tripletap --now",
						Description: "Disable tripletap service",
					},
				}
			},
		},
	},

	Category:       "enhancement",
	Tags:           []string{"activation", "convenience"},
	RequiresReboot: false,
}
