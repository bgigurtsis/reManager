package definitions

import (
	"fmt"

	"reManager/internal/commands"
	"reManager/internal/component"
)

var ApploadComponent = &component.ComponentDefinition{
	ID:          "appload",
	Name:        "AppLoad",
	Description: "Run third-party apps like KOReader",
	Version:     "v0.4.1",
	Author:      "asivery",

	Dependencies: []string{"xovi", "qt-resource-rebuilder"},

	CheckInstalled: func(ctx component.CommandContext) component.CommandResult {
		return commands.TestExists("/home/root/xovi/extensions.d/appload.so", commands.PathFile)
	},

	Install: func(ctx component.CommandContext) []component.CommandResult {
		arch := commands.GetDownloadArch(ctx.Arch)
		baseUrl := fmt.Sprintf("https://github.com/asivery/rm-appload/releases/download/v0.4.1/appload-%s.zip", arch)

		return []component.CommandResult{
			commands.ChangeDirectory("/home/root"),
			{
				Script:      fmt.Sprintf("./curl -Lo appload.zip %s", baseUrl),
				Description: "Download AppLoad",
			},
			{
				Script:      "unzip -o -d /home/root/shims appload.zip && rm appload.zip",
				Description: "Extract AppLoad to shims",
			},
			{
				Script:      "mv /home/root/shims/appload.so /home/root/xovi/extensions.d/appload.so",
				Description: "Move AppLoad extension",
			},
		}
	},

	Uninstall: func(ctx component.CommandContext) []component.CommandResult {
		return []component.CommandResult{
			commands.RemoveFile("/home/root/xovi/extensions.d/appload.so"),
		}
	},

	Category:       "enhancement",
	Tags:           []string{"apps", "third-party"},
	RequiresReboot: false,
}
