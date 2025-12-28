package definitions

import (
	"reManager/internal/commands"
	"reManager/internal/component"
)

var RmHacksComponent = &component.ComponentDefinition{
	ID:          "rm-hacks",
	Name:        "rM Hacks",
	Description: "Split screen, custom pen sizes, and more",
	Version:     "0.0.11-pre3",
	Author:      "asivery",

	Dependencies: []string{"xovi", "qt-resource-rebuilder"},

	CheckInstalled: func(ctx component.CommandContext) component.CommandResult {
		return commands.Chain(
			commands.TestExists("/home/root/xovi/exthome/qt-resource-rebuilder/zz_rmhacks.qmd", commands.PathFile),
			commands.TestExists("/home/root/xovi/exthome/qt-resource-rebuilder/rmhacks", commands.PathDirectory),
		)
	},

	Install: func(ctx component.CommandContext) []component.CommandResult {
		baseUrl := "https://github.com/asivery/rm-hacks-qmd/archive/refs/heads/master.zip"

		return []component.CommandResult{
			commands.ChangeDirectory("/home/root"),
			{
				Script:      "./curl -Lo rm-hacks.zip " + baseUrl,
				Description: "Download rM Hacks",
			},
			{
				Script:      `unzip -o -d rm-hacks rm-hacks.zip "rm-hacks-qmd-master/0.0.11-pre3/*"`,
				Description: "Extract rM Hacks",
			},
			{
				Script:      "cp -r rm-hacks/rm-hacks-qmd-master/0.0.11-pre3/* /home/root/xovi/exthome/qt-resource-rebuilder/",
				Description: "Install rM Hacks to xovi",
			},
			{
				Script:      "rm -rf rm-hacks rm-hacks.zip",
				Description: "Clean up temporary files",
			},
		}
	},

	Uninstall: func(ctx component.CommandContext) []component.CommandResult {
		return []component.CommandResult{
			commands.RemoveFile("/home/root/xovi/exthome/qt-resource-rebuilder/zz_rmhacks.qmd"),
			commands.RemoveDirectory("/home/root/xovi/exthome/qt-resource-rebuilder/rmhacks"),
		}
	},

	Category:       "enhancement",
	Tags:           []string{"ui", "productivity"},
	RequiresReboot: false,
}
