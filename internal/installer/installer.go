package installer

import (
	"fmt"
	"strings"

	"reManager/internal/component"
	"reManager/internal/executor"
	"reManager/internal/vellum"
)

type InstallResult struct {
	Success  bool
	Errors   []string
	DNSError bool
}

type HookCallback func(result *component.HookExecutionResult) error

type Installer struct {
	vellum   *vellum.Client
	metadata *vellum.MetadataStore
	executor executor.CommandExecutor
}

func NewInstaller(v *vellum.Client, meta *vellum.MetadataStore, exec executor.CommandExecutor) *Installer {
	return &Installer{
		vellum:   v,
		metadata: meta,
		executor: exec,
	}
}

func (i *Installer) Install(
	packageNames []string,
	ctx component.CommandContext,
	onProgress executor.ProgressCallback,
	onHook HookCallback,
) InstallResult {
	var errors []string
	var dnsError bool

	fmt.Printf("[DEBUG] Install starting for packages: %v\n", packageNames)

	for idx, pkgName := range packageNames {
		pkg := i.metadata.GetPackage(pkgName)
		displayName := pkgName
		if pkg != nil {
			displayName = pkg.Name
		}

		fmt.Printf("[DEBUG] Installing package %d/%d: %s\n", idx+1, len(packageNames), pkgName)

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: displayName,
				TotalComponents:  len(packageNames),
				CurrentIndex:     idx,
				Status:           executor.StatusInstalling,
				Message:          fmt.Sprintf("Installing %s...", displayName),
			})
		}

		var lastOutput string
		err := i.vellum.AddStreaming(func(line string) {
			lastOutput = line
			fmt.Printf("[DEBUG] vellum output: %s\n", line)
			if strings.Contains(line, "DNS:") {
				dnsError = true
			}
			if onProgress != nil {
				onProgress(executor.ProgressInfo{
					CurrentComponent: displayName,
					TotalComponents:  len(packageNames),
					CurrentIndex:     idx,
					Status:           executor.StatusInstalling,
					Message:          line,
				})
			}
		}, pkgName)

		if err != nil {
			errMsg := fmt.Sprintf("Installation failed for %s: %v (output: %s)", displayName, err, lastOutput)
			fmt.Printf("[DEBUG] Install error: %s\n", errMsg)
			errors = append(errors, errMsg)
			reportError(onProgress, displayName, len(packageNames), idx, errMsg)
			continue
		}
		fmt.Printf("[DEBUG] Package %s installed successfully\n", pkgName)

		hooks := i.metadata.GetHooks(pkgName)
		if hooks != nil && hooks.PostInstall != "" {
			hookFunc := vellum.GetHook(hooks.PostInstall)
			if hookFunc != nil {
				hookResult, err := hookFunc(ctx)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Post-install hook failed for %s: %v", displayName, err))
					reportError(onProgress, displayName, len(packageNames), idx, errors[len(errors)-1])
					continue
				}
				if hookResult != nil && onHook != nil {
					if err := onHook(hookResult); err != nil {
						errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", displayName, err))
						reportError(onProgress, displayName, len(packageNames), idx, errors[len(errors)-1])
						continue
					}
				}
			}
		}

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: displayName,
				TotalComponents:  len(packageNames),
				CurrentIndex:     idx,
				Status:           executor.StatusCompleted,
				Message:          fmt.Sprintf("%s installed successfully", displayName),
			})
		}
	}

	return InstallResult{
		Success:  len(errors) == 0,
		Errors:   errors,
		DNSError: dnsError,
	}
}

func (i *Installer) Uninstall(
	packageNames []string,
	ctx component.CommandContext,
	onProgress executor.ProgressCallback,
	onHook HookCallback,
) InstallResult {
	var errors []string

	for idx, pkgName := range packageNames {
		pkg := i.metadata.GetPackage(pkgName)
		displayName := pkgName
		if pkg != nil {
			displayName = pkg.Name
		}

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: displayName,
				TotalComponents:  len(packageNames),
				CurrentIndex:     idx,
				Status:           executor.StatusInstalling,
				Message:          fmt.Sprintf("Uninstalling %s...", displayName),
			})
		}

		hooks := i.metadata.GetHooks(pkgName)
		if hooks != nil && hooks.PreUninstall != "" {
			hookFunc := vellum.GetHook(hooks.PreUninstall)
			if hookFunc != nil {
				hookResult, err := hookFunc(ctx)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Pre-uninstall hook failed for %s: %v", displayName, err))
					reportError(onProgress, displayName, len(packageNames), idx, errors[len(errors)-1])
					continue
				}
				if hookResult != nil && onHook != nil {
					if err := onHook(hookResult); err != nil {
						errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", displayName, err))
						reportError(onProgress, displayName, len(packageNames), idx, errors[len(errors)-1])
						continue
					}
				}
			}
		}

		err := i.vellum.DelStreaming(func(line string) {
			if onProgress != nil {
				onProgress(executor.ProgressInfo{
					CurrentComponent: displayName,
					TotalComponents:  len(packageNames),
					CurrentIndex:     idx,
					Status:           executor.StatusInstalling,
					Message:          line,
				})
			}
		}, pkgName)

		if err != nil {
			errMsg := fmt.Sprintf("Uninstall failed for %s: %v", displayName, err)
			errors = append(errors, errMsg)
			reportError(onProgress, displayName, len(packageNames), idx, errMsg)
			continue
		}

		if hooks != nil && hooks.PostUninstall != "" {
			hookFunc := vellum.GetHook(hooks.PostUninstall)
			if hookFunc != nil {
				hookResult, err := hookFunc(ctx)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Post-uninstall hook failed for %s: %v", displayName, err))
				}
				if hookResult != nil && onHook != nil {
					if err := onHook(hookResult); err != nil {
						errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", displayName, err))
					}
				}
			}
		}

		if onProgress != nil {
			onProgress(executor.ProgressInfo{
				CurrentComponent: displayName,
				TotalComponents:  len(packageNames),
				CurrentIndex:     idx,
				Status:           executor.StatusCompleted,
				Message:          fmt.Sprintf("%s uninstalled successfully", displayName),
			})
		}
	}

	return InstallResult{
		Success: len(errors) == 0,
		Errors:  errors,
	}
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
