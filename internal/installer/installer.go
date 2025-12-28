package installer

import (
	"fmt"

	"reManager/internal/component"
	"reManager/internal/executor"
)

type InstallResult struct {
	Success bool
	Errors  []string
}

type EnableResult struct {
	Success bool
	Error   string
}

type HookCallback func(result *component.HookExecutionResult) error

type Installer struct {
	registry *component.Registry
	executor executor.CommandExecutor
}

func NewInstaller(registry *component.Registry, exec executor.CommandExecutor) *Installer {
	return &Installer{
		registry: registry,
		executor: exec,
	}
}

func (i *Installer) Install(
	componentIDs []string,
	ctx component.CommandContext,
	onProgress executor.ProgressCallback,
	onHook HookCallback,
) InstallResult {
	var errors []string

	resolver := component.NewDependencyResolver(i.registry.GetAllAsMap())
	resolved, err := resolver.Resolve(componentIDs)
	if err != nil {
		return InstallResult{
			Success: false,
			Errors:  []string{err.Error()},
		}
	}

	for idx, componentID := range resolved {
		comp := i.registry.Get(componentID)
		if comp == nil {
			errors = append(errors, fmt.Sprintf("Component not found: %s", componentID))
			continue
		}

		componentCtx := ctx
		componentCtx.IsInstalled = ctx.ComponentsStatus[componentID]

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: comp.Name,
				TotalComponents:  len(resolved),
				CurrentIndex:     idx,
				Status:           executor.StatusInstalling,
				Message:          fmt.Sprintf("Installing %s...", comp.Name),
			})
		}

		if comp.PreInstall != nil {
			hookResult, err := comp.PreInstall.Execute(componentCtx)
			if err != nil {
				errors = append(errors, fmt.Sprintf("Pre-install hook failed for %s: %v", comp.Name, err))
				reportError(onProgress, comp.Name, len(resolved), idx, errors[len(errors)-1])
				continue
			}
			if hookResult != nil && onHook != nil {
				if err := onHook(hookResult); err != nil {
					errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", comp.Name, err))
					reportError(onProgress, comp.Name, len(resolved), idx, errors[len(errors)-1])
					continue
				}
			}
		}

		commands := comp.Install(componentCtx)
		if err := i.executor.Execute(commands); err != nil {
			errMsg := fmt.Sprintf("Installation command failed for %s: %v", comp.Name, err)
			errors = append(errors, errMsg)
			reportError(onProgress, comp.Name, len(resolved), idx, errMsg)
			continue
		}

		if comp.PostInstall != nil {
			hookResult, err := comp.PostInstall.Execute(componentCtx)
			if err != nil {
				errors = append(errors, fmt.Sprintf("Post-install hook failed for %s: %v", comp.Name, err))
				reportError(onProgress, comp.Name, len(resolved), idx, errors[len(errors)-1])
				continue
			}
			if hookResult != nil && onHook != nil {
				if err := onHook(hookResult); err != nil {
					errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", comp.Name, err))
					reportError(onProgress, comp.Name, len(resolved), idx, errors[len(errors)-1])
					continue
				}
			}
		}

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: comp.Name,
				TotalComponents:  len(resolved),
				CurrentIndex:     idx,
				Status:           executor.StatusCompleted,
				Message:          fmt.Sprintf("%s installed successfully", comp.Name),
			})
		}
	}

	return InstallResult{
		Success: len(errors) == 0,
		Errors:  errors,
	}
}

func (i *Installer) Uninstall(
	componentIDs []string,
	ctx component.CommandContext,
	onProgress executor.ProgressCallback,
) InstallResult {
	var errors []string

	for idx, componentID := range componentIDs {
		comp := i.registry.Get(componentID)
		if comp == nil {
			errors = append(errors, fmt.Sprintf("Component not found: %s", componentID))
			continue
		}

		if comp.Uninstall == nil {
			errors = append(errors, fmt.Sprintf("%s does not support uninstall", comp.Name))
			continue
		}

		componentCtx := ctx
		componentCtx.IsInstalled = ctx.ComponentsStatus[componentID]

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: comp.Name,
				TotalComponents:  len(componentIDs),
				CurrentIndex:     idx,
				Status:           executor.StatusInstalling,
				Message:          fmt.Sprintf("Uninstalling %s...", comp.Name),
			})
		}

		if comp.PreUninstall != nil {
			hookResult, err := comp.PreUninstall.Execute(componentCtx)
			if err != nil {
				errors = append(errors, fmt.Sprintf("Pre-uninstall hook failed for %s: %v", comp.Name, err))
				reportError(onProgress, comp.Name, len(componentIDs), idx, errors[len(errors)-1])
				continue
			}
			if hookResult != nil && hookResult.Command != nil {
				if err := i.executor.Execute([]component.CommandResult{*hookResult.Command}); err != nil {
					errors = append(errors, fmt.Sprintf("Pre-uninstall command failed for %s: %v", comp.Name, err))
					reportError(onProgress, comp.Name, len(componentIDs), idx, errors[len(errors)-1])
					continue
				}
			}
		}

		commands := comp.Uninstall(componentCtx)
		if err := i.executor.Execute(commands); err != nil {
			errMsg := fmt.Sprintf("Uninstall command failed for %s: %v", comp.Name, err)
			errors = append(errors, errMsg)
			reportError(onProgress, comp.Name, len(componentIDs), idx, errMsg)
			continue
		}

		if comp.PostUninstall != nil {
			if _, err := comp.PostUninstall.Execute(componentCtx); err != nil {
				errors = append(errors, fmt.Sprintf("Post-uninstall hook failed for %s: %v", comp.Name, err))
			}
		}

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: comp.Name,
				TotalComponents:  len(componentIDs),
				CurrentIndex:     idx,
				Status:           executor.StatusCompleted,
				Message:          fmt.Sprintf("%s uninstalled successfully", comp.Name),
			})
		}
	}

	return InstallResult{
		Success: len(errors) == 0,
		Errors:  errors,
	}
}

func (i *Installer) Enable(componentID string, ctx component.CommandContext) EnableResult {
	comp := i.registry.Get(componentID)
	if comp == nil {
		return EnableResult{Success: false, Error: fmt.Sprintf("Component not found: %s", componentID)}
	}

	if comp.Enable == nil {
		return EnableResult{Success: false, Error: fmt.Sprintf("%s does not support enable", comp.Name)}
	}

	componentCtx := ctx
	componentCtx.IsInstalled = ctx.ComponentsStatus[componentID]

	cmd := comp.Enable(componentCtx)
	if cmd == nil {
		return EnableResult{Success: true}
	}

	if err := i.executor.Execute([]component.CommandResult{*cmd}); err != nil {
		return EnableResult{Success: false, Error: fmt.Sprintf("Failed to enable %s: %v", comp.Name, err)}
	}

	return EnableResult{Success: true}
}

func (i *Installer) Disable(componentID string, ctx component.CommandContext) EnableResult {
	comp := i.registry.Get(componentID)
	if comp == nil {
		return EnableResult{Success: false, Error: fmt.Sprintf("Component not found: %s", componentID)}
	}

	if comp.Disable == nil {
		return EnableResult{Success: false, Error: fmt.Sprintf("%s does not support disable", comp.Name)}
	}

	componentCtx := ctx
	componentCtx.IsInstalled = ctx.ComponentsStatus[componentID]

	cmd := comp.Disable(componentCtx)
	if cmd == nil {
		return EnableResult{Success: true}
	}

	if err := i.executor.Execute([]component.CommandResult{*cmd}); err != nil {
		return EnableResult{Success: false, Error: fmt.Sprintf("Failed to disable %s: %v", comp.Name, err)}
	}

	return EnableResult{Success: true}
}

func reportError(onProgress executor.ProgressCallback, name string, total, idx int, msg string) {
	if onProgress != nil {
		onProgress(executor.ProgressInfo{
			CurrentComponent: name,
			TotalComponents:  total,
			CurrentIndex:     idx,
			Status:           executor.StatusError,
			Message:          msg,
		})
	}
}
