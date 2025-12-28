package commands

import (
	"fmt"
	"strings"

	"reManager/internal/component"
)

type ArchiveType string

const (
	ArchiveZip   ArchiveType = "zip"
	ArchiveTarGz ArchiveType = "tar.gz"
)

func DownloadAndExtract(url, dest string, archiveType ArchiveType) component.CommandResult {
	var script string
	if archiveType == ArchiveZip {
		script = fmt.Sprintf("./curl -Lo temp.zip %s && unzip -o -d %s temp.zip && rm temp.zip", url, dest)
	} else {
		script = fmt.Sprintf("./curl -Lo temp.tar.gz %s && tar -xzf temp.tar.gz -C %s && rm temp.tar.gz", url, dest)
	}
	return component.CommandResult{
		Script:      script,
		Description: fmt.Sprintf("Download and extract from %s", url),
	}
}

func CopyFile(src, dest string) component.CommandResult {
	return component.CommandResult{
		Script:      fmt.Sprintf("cp %s %s", src, dest),
		Description: fmt.Sprintf("Copy %s to %s", src, dest),
	}
}

type PathType string

const (
	PathFile      PathType = "file"
	PathDirectory PathType = "directory"
)

func TestExists(path string, pathType PathType) component.CommandResult {
	var script string
	if pathType == PathFile {
		script = fmt.Sprintf("test -f %s && echo 'yes' || echo 'no'", path)
	} else {
		script = fmt.Sprintf("test -d %s && echo 'yes' || echo 'no'", path)
	}
	return component.CommandResult{
		Script:      script,
		Description: fmt.Sprintf("Check if %s exists: %s", pathType, path),
	}
}

func Chain(commands ...component.CommandResult) component.CommandResult {
	scripts := make([]string, len(commands))
	descriptions := make([]string, 0, len(commands))

	for i, cmd := range commands {
		scripts[i] = cmd.Script
		if cmd.Description != "" {
			descriptions = append(descriptions, cmd.Description)
		}
	}

	return component.CommandResult{
		Script:      strings.Join(scripts, " && "),
		Description: strings.Join(descriptions, "; "),
	}
}

func Conditional(condition, thenCmd string, elseCmd string) component.CommandResult {
	var script string
	if elseCmd != "" {
		script = fmt.Sprintf("%s && { %s; } || { %s; }", condition, thenCmd, elseCmd)
	} else {
		script = fmt.Sprintf("%s && { %s; }", condition, thenCmd)
	}
	return component.CommandResult{
		Script:      script,
		Description: "Conditional execution",
	}
}

func RemoveFile(path string) component.CommandResult {
	return component.CommandResult{
		Script:      fmt.Sprintf("rm -f %s", path),
		Description: fmt.Sprintf("Remove file %s", path),
	}
}

func RemoveDirectory(path string) component.CommandResult {
	return component.CommandResult{
		Script:      fmt.Sprintf("rm -rf %s", path),
		Description: fmt.Sprintf("Remove directory %s", path),
	}
}

func ChangeDirectory(path string) component.CommandResult {
	return component.CommandResult{
		Script:      fmt.Sprintf("cd %s", path),
		Description: fmt.Sprintf("Change to directory %s", path),
	}
}

func RunCommand(cmd string, description string) component.CommandResult {
	if description == "" {
		description = cmd
	}
	return component.CommandResult{
		Script:      cmd,
		Description: description,
	}
}

func GetArchiveArch(arch component.DeviceArchitecture) string {
	if arch == component.ArchArm32 {
		return "arm32-testing"
	}
	return "aarch64"
}

func GetDownloadArch(arch component.DeviceArchitecture) string {
	return string(arch)
}

func CheckWriteable() component.CommandResult {
	return component.CommandResult{
		Script:      `awk '$2 == "/" {print $4}' /proc/mounts | grep -q "\brw\b" && echo "rw" || echo "ro"`,
		Description: "Check if root filesystem is writeable",
	}
}

func MakeWriteable() []component.CommandResult {
	return []component.CommandResult{
		{Script: "mount -o remount,rw /", Description: "Remount root as read-write"},
		{Script: "umount -R /etc", Description: "Unmount /etc overlay"},
	}
}

func WrapWithWriteableRoot(commands []component.CommandResult, device component.DeviceType) []component.CommandResult {
	if device == component.DeviceRMPP || device == component.DeviceRMPPM {
		ensureWriteable := component.CommandResult{
			Script:      `if ! awk '$2 == "/" {print $4}' /proc/mounts | grep -q "\brw\b"; then mount -o remount,rw / && umount -R /etc; fi`,
			Description: "Ensure root filesystem is writeable",
		}
		return append([]component.CommandResult{ensureWriteable}, commands...)
	}
	return commands
}
