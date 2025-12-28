package component

type DeviceArchitecture string

const (
	ArchArm32   DeviceArchitecture = "arm32"
	ArchAarch64 DeviceArchitecture = "aarch64"
)

type DeviceType string

const (
	DeviceRM1   DeviceType = "rm1"
	DeviceRM2   DeviceType = "rm2"
	DeviceRMPP  DeviceType = "rmpp"
	DeviceRMPPM DeviceType = "rmppm"
)

type CommandContext struct {
	Arch             DeviceArchitecture
	Device           DeviceType
	IsInstalled      bool
	ComponentsStatus map[string]bool
}

type CommandResult struct {
	Script      string
	Description string
	RequiresPTY bool
}

type DialogConfig struct {
	Title             string
	Message           string
	Steps             []string
	ConfirmText       string
	InProgressMessage string
}

type HookExecutionResult struct {
	DialogConfig *DialogConfig
	Command      *CommandResult
}

type HookType string

const (
	HookTypeDialog       HookType = "dialog"
	HookTypeConfirmation HookType = "confirmation"
	HookTypeCustom       HookType = "custom"
)

type LifecycleHook struct {
	Type    HookType
	Execute func(ctx CommandContext) (*HookExecutionResult, error)
}

type MaintenanceCommand struct {
	ID                 string
	Label              string
	Description        string
	Command            func(ctx CommandContext) []CommandResult
	RequiresTerminal   bool
	AllowStop          bool
	NeedsWriteableRoot bool
	Icon               string
}

type ComponentDefinition struct {
	ID          string
	Name        string
	Description string
	Version     string
	Author      string

	Dependencies []string

	CheckInstalled func(ctx CommandContext) CommandResult
	Install        func(ctx CommandContext) []CommandResult
	Uninstall      func(ctx CommandContext) []CommandResult
	Enable         func(ctx CommandContext) *CommandResult
	Disable        func(ctx CommandContext) *CommandResult

	PreInstall    *LifecycleHook
	PostInstall   *LifecycleHook
	PreUninstall  *LifecycleHook
	PostUninstall *LifecycleHook

	MaintenanceCommands []MaintenanceCommand

	Tags                     []string
	Category                 string
	Icon                     string
	RequiresReboot           bool
	RequiresUserConfirmation bool
}
