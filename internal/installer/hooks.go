package installer

import "reManager/internal/component"

func RebuildHashtableDialog() *component.LifecycleHook {
	return &component.LifecycleHook{
		Type: component.HookTypeDialog,
		Execute: func(ctx component.CommandContext) (*component.HookExecutionResult, error) {
			return &component.HookExecutionResult{
				DialogConfig: &component.DialogConfig{
					Title:   "Rebuild Hashtable",
					Message: "This process will restart the tablet interface twice and may take up to 2 minutes.",
					Steps: []string{
						"Restart the tablet interface",
						"Ask for your passcode (if you have one set)",
						"Generate hashtable (~1 minute)",
						"Restart the tablet interface again",
					},
					ConfirmText:       "Proceed",
					InProgressMessage: "Please enter your passcode on the tablet if prompted",
				},
				Command: &component.CommandResult{
					Script:      "/home/root/xovi/rebuild_hashtable",
					Description: "Rebuild Qt resource hashtable",
				},
			}, nil
		},
	}
}

func ConfirmOverwrite(componentName string) *component.LifecycleHook {
	return &component.LifecycleHook{
		Type: component.HookTypeConfirmation,
		Execute: func(ctx component.CommandContext) (*component.HookExecutionResult, error) {
			if ctx.IsInstalled {
				return nil, nil
			}
			return nil, nil
		},
	}
}
