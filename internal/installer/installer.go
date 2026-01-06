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
	allPackages []string,
	ctx component.CommandContext,
	onProgress executor.ProgressCallback,
	onHook HookCallback,
) InstallResult {
	var errors []string
	var dnsError bool

	fmt.Printf("[DEBUG] Install starting for packages: %v (all: %v)\n", packageNames, allPackages)

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

	// Run postInstall hooks for ALL packages (including dependencies)
	for _, pkgName := range allPackages {
		hooks := i.metadata.GetHooks(pkgName)
		if hooks != nil && hooks.PostInstall != "" {
			hookFunc := vellum.GetHook(hooks.PostInstall)
			if hookFunc != nil {
				fmt.Printf("[DEBUG] Running postInstall hook for %s\n", pkgName)
				hookResult, err := hookFunc(ctx)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Post-install hook failed for %s: %v", pkgName, err))
					continue
				}
				if hookResult != nil && onHook != nil {
					if err := onHook(hookResult); err != nil {
						errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", pkgName, err))
						continue
					}
				}
			}
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
	allPackages []string,
	useRecursive bool,
	ctx component.CommandContext,
	onProgress executor.ProgressCallback,
	onHook HookCallback,
) InstallResult {
	var errors []string

	fmt.Printf("[DEBUG] Uninstall starting for packages: %v (all: %v, recursive: %v)\n", packageNames, allPackages, useRecursive)

	// Run preUninstall hooks for ALL packages first (before any actual uninstall)
	for _, pkgName := range allPackages {
		hooks := i.metadata.GetHooks(pkgName)
		if hooks != nil && hooks.PreUninstall != "" {
			hookFunc := vellum.GetHook(hooks.PreUninstall)
			if hookFunc != nil {
				fmt.Printf("[DEBUG] Running preUninstall hook for %s\n", pkgName)
				hookResult, err := hookFunc(ctx)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Pre-uninstall hook failed for %s: %v", pkgName, err))
					continue
				}
				if hookResult != nil && onHook != nil {
					if err := onHook(hookResult); err != nil {
						errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", pkgName, err))
						continue
					}
				}
			}
		}
	}

	// Perform actual uninstall for requested packages
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

		var err error
		if useRecursive {
			err = i.vellum.DelRecursiveStreaming(func(line string) {
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
		} else {
			err = i.vellum.DelStreaming(func(line string) {
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
		}

		if err != nil {
			errMsg := fmt.Sprintf("Uninstall failed for %s: %v", displayName, err)
			errors = append(errors, errMsg)
			reportError(onProgress, displayName, len(packageNames), idx, errMsg)
			continue
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

	// Run postUninstall hooks for ALL packages (including orphaned deps)
	for _, pkgName := range allPackages {
		hooks := i.metadata.GetHooks(pkgName)
		if hooks != nil && hooks.PostUninstall != "" {
			hookFunc := vellum.GetHook(hooks.PostUninstall)
			if hookFunc != nil {
				fmt.Printf("[DEBUG] Running postUninstall hook for %s\n", pkgName)
				hookResult, err := hookFunc(ctx)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Post-uninstall hook failed for %s: %v", pkgName, err))
					continue
				}
				if hookResult != nil && onHook != nil {
					if err := onHook(hookResult); err != nil {
						errors = append(errors, fmt.Sprintf("Hook callback failed for %s: %v", pkgName, err))
						continue
					}
				}
			}
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
