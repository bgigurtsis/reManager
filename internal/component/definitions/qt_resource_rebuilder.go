package definitions

import (
	"reManager/internal/commands"
	"reManager/internal/component"
	"reManager/internal/installer"
)

var QtResourceRebuilderComponent = &component.ComponentDefinition{
	ID:          "qt-resource-rebuilder",
	Name:        "Qt Resource Rebuilder",
	Description: "Enables UI modifications like rM Hacks",
	Version:     "v16-14112025",

	Dependencies: []string{"xovi"},

	CheckInstalled: func(ctx component.CommandContext) component.CommandResult {
		return commands.TestExists("/home/root/xovi/extensions.d/qt-resource-rebuilder.so", commands.PathFile)
	},

	Install: func(ctx component.CommandContext) []component.CommandResult {
		return []component.CommandResult{
			commands.CopyFile(
				"/home/root/extensions/qt-resource-rebuilder.so",
				"/home/root/xovi/extensions.d/qt-resource-rebuilder.so",
			),
		}
	},

	PostInstall: installer.RebuildHashtableDialog(),

	Uninstall: func(ctx component.CommandContext) []component.CommandResult {
		return []component.CommandResult{
			commands.RemoveFile("/home/root/xovi/extensions.d/qt-resource-rebuilder.so"),
		}
	},

	Category:                 "core",
	Tags:                     []string{"framework", "ui-modification"},
	RequiresUserConfirmation: true,
}
