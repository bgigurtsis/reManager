package main

import (
	"fmt"
	"os"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
	"golang.org/x/crypto/ssh"
	"golang.org/x/term"

	"reManager/internal/commands"
	"reManager/internal/component"
	"reManager/internal/component/definitions"
	"reManager/internal/device"
	"reManager/internal/executor"
	"reManager/internal/installer"
)

var (
	host     string
	keyPath  string
	password string
)

func init() {
	definitions.RegisterAll(component.DefaultRegistry)
}

func main() {
	rootCmd := &cobra.Command{
		Use:   "remanager",
		Short: "Manage xovi and extensions on reMarkable devices",
		Long:  `reManager is a CLI tool for installing and managing xovi and its extensions on reMarkable tablets.`,
	}

	rootCmd.PersistentFlags().StringVarP(&host, "host", "H", "10.11.99.1", "Device hostname or IP address")
	rootCmd.PersistentFlags().StringVarP(&keyPath, "key", "k", "", "Path to SSH private key")
	rootCmd.PersistentFlags().StringVarP(&password, "password", "p", "", "SSH password (will prompt if not provided)")

	rootCmd.AddCommand(listCmd())
	rootCmd.AddCommand(statusCmd())
	rootCmd.AddCommand(installCmd())
	rootCmd.AddCommand(uninstallCmd())
	rootCmd.AddCommand(maintenanceCmd())

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func listCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List available components",
		Run: func(cmd *cobra.Command, args []string) {
			components := component.DefaultRegistry.GetAll()

			fmt.Println("Available components:")
			fmt.Println()
			for _, comp := range components {
				deps := ""
				if len(comp.Dependencies) > 0 {
					deps = fmt.Sprintf(" (requires: %s)", strings.Join(comp.Dependencies, ", "))
				}
				fmt.Printf("  %s - %s%s\n", comp.ID, comp.Description, deps)
			}
		},
	}
}

func statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show installed components on connected device",
		RunE: func(cmd *cobra.Command, args []string) error {
			client, deviceType, err := connect()
			if err != nil {
				return err
			}
			defer client.Close()

			exec := executor.NewSSHExecutor(client)
			components := component.DefaultRegistry.GetAll()

			fmt.Printf("Connected to %s (%s)\n\n", host, device.GetDisplayName(deviceType))
			fmt.Println("Component Status:")
			fmt.Println()

			for _, comp := range components {
				checkCmd := getCheckCommand(comp.ID)
				if checkCmd == "" {
					continue
				}

				installed, _ := exec.CheckInstalled(component.CommandResult{Script: checkCmd})
				status := "not installed"
				if installed {
					status = "installed"
				}
				fmt.Printf("  %-25s %s\n", comp.ID, status)
			}

			return nil
		},
	}
}

func installCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "install [components...]",
		Short: "Install components on the device",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, deviceType, err := connect()
			if err != nil {
				return err
			}
			defer client.Close()

			exec := executor.NewSSHExecutor(client)
			arch := device.GetArchitecture(component.DeviceType(deviceType))

			componentsStatus := make(map[string]bool)
			for _, comp := range component.DefaultRegistry.GetAll() {
				checkCmd := getCheckCommand(comp.ID)
				if checkCmd != "" {
					installed, _ := exec.CheckInstalled(component.CommandResult{Script: checkCmd})
					componentsStatus[comp.ID] = installed
				}
			}

			ctx := component.CommandContext{
				Arch:             arch,
				Device:           component.DeviceType(deviceType),
				IsInstalled:      false,
				ComponentsStatus: componentsStatus,
			}

			inst := installer.NewInstaller(component.DefaultRegistry, exec)

			result := inst.Install(
				args,
				ctx,
				func(progress executor.ProgressInfo) {
					fmt.Printf("[%d/%d] %s: %s\n", progress.CurrentIndex+1, progress.TotalComponents, progress.CurrentComponent, progress.Message)
				},
				func(hookResult *component.HookExecutionResult) error {
					if hookResult.DialogConfig != nil {
						fmt.Printf("\n%s\n", hookResult.DialogConfig.Title)
						fmt.Println(hookResult.DialogConfig.Message)
						for _, step := range hookResult.DialogConfig.Steps {
							fmt.Printf("  - %s\n", step)
						}
						fmt.Print("\nProceed? [y/N]: ")

						var response string
						fmt.Scanln(&response)
						if strings.ToLower(response) != "y" {
							return fmt.Errorf("user cancelled")
						}

						if hookResult.Command != nil {
							fmt.Printf("$ %s\n", hookResult.Command.Script)
							if err := exec.Execute([]component.CommandResult{*hookResult.Command}); err != nil {
								return err
							}
						}
					}
					return nil
				},
			)

			if result.Success {
				fmt.Println("\nInstallation complete!")
			} else {
				fmt.Println("\nInstallation failed:")
				for _, err := range result.Errors {
					fmt.Printf("  - %s\n", err)
				}
				return fmt.Errorf("installation failed")
			}

			return nil
		},
	}
}

func uninstallCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "uninstall [components...]",
		Short: "Uninstall components from the device",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, deviceType, err := connect()
			if err != nil {
				return err
			}
			defer client.Close()

			exec := executor.NewSSHExecutor(client)
			arch := device.GetArchitecture(component.DeviceType(deviceType))

			componentsStatus := make(map[string]bool)
			for _, comp := range component.DefaultRegistry.GetAll() {
				checkCmd := getCheckCommand(comp.ID)
				if checkCmd != "" {
					installed, _ := exec.CheckInstalled(component.CommandResult{Script: checkCmd})
					componentsStatus[comp.ID] = installed
				}
			}

			ctx := component.CommandContext{
				Arch:             arch,
				Device:           component.DeviceType(deviceType),
				IsInstalled:      true,
				ComponentsStatus: componentsStatus,
			}

			inst := installer.NewInstaller(component.DefaultRegistry, exec)

			result := inst.Uninstall(
				args,
				ctx,
				func(progress executor.ProgressInfo) {
					fmt.Printf("[%d/%d] %s: %s\n", progress.CurrentIndex+1, progress.TotalComponents, progress.CurrentComponent, progress.Message)
				},
			)

			if result.Success {
				fmt.Println("\nUninstall complete!")
			} else {
				fmt.Println("\nUninstall failed:")
				for _, err := range result.Errors {
					fmt.Printf("  - %s\n", err)
				}
				return fmt.Errorf("uninstall failed")
			}

			return nil
		},
	}
}

func maintenanceCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "maintenance <component> <command>",
		Short: "Run maintenance command for a component",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			componentID := args[0]
			commandID := args[1]

			comp := component.DefaultRegistry.Get(componentID)
			if comp == nil {
				return fmt.Errorf("component not found: %s", componentID)
			}

			var maintCmd *component.MaintenanceCommand
			for i := range comp.MaintenanceCommands {
				if comp.MaintenanceCommands[i].ID == commandID {
					maintCmd = &comp.MaintenanceCommands[i]
					break
				}
			}
			if maintCmd == nil {
				fmt.Printf("Available maintenance commands for %s:\n", componentID)
				for _, c := range comp.MaintenanceCommands {
					fmt.Printf("  %s - %s\n", c.ID, c.Description)
				}
				return fmt.Errorf("command not found: %s", commandID)
			}

			client, deviceType, err := connect()
			if err != nil {
				return err
			}
			defer client.Close()

			exec := executor.NewSSHExecutor(client)
			arch := device.GetArchitecture(component.DeviceType(deviceType))

			ctx := component.CommandContext{
				Arch:             arch,
				Device:           component.DeviceType(deviceType),
				IsInstalled:      true,
				ComponentsStatus: make(map[string]bool),
			}

			cmdResults := maintCmd.Command(ctx)

			if maintCmd.NeedsWriteableRoot {
				cmdResults = commands.WrapWithWriteableRoot(cmdResults, component.DeviceType(deviceType))
			}

			fmt.Printf("Running %s %s...\n", componentID, commandID)

			if maintCmd.RequiresTerminal {
				for _, c := range cmdResults {
					fmt.Printf("$ %s\n", c.Script)
					if err := exec.ExecuteStreaming(c.Script, func(line string) {
						fmt.Print(line)
					}); err != nil {
						return fmt.Errorf("command failed: %w", err)
					}
				}
			} else {
				for _, c := range cmdResults {
					fmt.Printf("$ %s\n", c.Script)
					output, err := exec.ExecuteWithOutput(c.Script)
					if err != nil {
						return fmt.Errorf("command failed: %w", err)
					}
					if output != "" {
						fmt.Print(output)
					}
				}
			}

			fmt.Println("\nDone!")
			return nil
		},
	}
}

func connect() (*ssh.Client, string, error) {
	var authMethods []ssh.AuthMethod

	if keyPath != "" {
		keyData, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, "", fmt.Errorf("failed to read key file: %w", err)
		}

		signer, err := ssh.ParsePrivateKey(keyData)
		if err != nil {
			if strings.Contains(err.Error(), "passphrase") {
				fmt.Print("Enter key passphrase: ")
				passphrase, err := term.ReadPassword(int(syscall.Stdin))
				fmt.Println()
				if err != nil {
					return nil, "", fmt.Errorf("failed to read passphrase: %w", err)
				}
				signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, passphrase)
				if err != nil {
					return nil, "", fmt.Errorf("failed to parse key: %w", err)
				}
			} else {
				return nil, "", fmt.Errorf("failed to parse key: %w", err)
			}
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else {
		if password == "" {
			fmt.Print("Enter SSH password: ")
			pwBytes, err := term.ReadPassword(int(syscall.Stdin))
			fmt.Println()
			if err != nil {
				return nil, "", fmt.Errorf("failed to read password: %w", err)
			}
			password = string(pwBytes)
		}
		authMethods = append(authMethods, ssh.Password(password))
	}

	config := &ssh.ClientConfig{
		User:            "root",
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	addr := host
	if !strings.Contains(host, ":") {
		addr = host + ":22"
	}

	fmt.Printf("Connecting to %s...\n", addr)

	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, "", fmt.Errorf("failed to connect: %w", err)
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, "", fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput("cat /sys/devices/soc0/machine")
	if err != nil {
		return client, "unknown", nil
	}

	machine := strings.TrimSpace(string(output))
	var deviceType string
	switch {
	case strings.Contains(machine, "reMarkable 1"):
		deviceType = "rm1"
	case strings.Contains(machine, "reMarkable 2"):
		deviceType = "rm2"
	case strings.Contains(machine, "Ferrari"):
		deviceType = "rmpp"
	case strings.Contains(machine, "Chiappa"):
		deviceType = "rmppm"
	default:
		deviceType = machine
	}

	return client, deviceType, nil
}

func getCheckCommand(componentID string) string {
	switch componentID {
	case "xovi":
		return "test -d /home/root/xovi && echo 'yes' || echo 'no'"
	case "qt-resource-rebuilder":
		return "test -f /home/root/xovi/extensions.d/qt-resource-rebuilder.so && echo 'yes' || echo 'no'"
	case "tripletap":
		return "test -f /home/root/xovi-tripletap/uninstall.sh && echo 'yes' || echo 'no'"
	case "rm-hacks":
		return "test -f /home/root/xovi/exthome/qt-resource-rebuilder/zz_rmhacks.qmd && test -d /home/root/xovi/exthome/qt-resource-rebuilder/rmhacks && echo 'yes' || echo 'no'"
	case "appload":
		return "test -f /home/root/xovi/extensions.d/appload.so && echo 'yes' || echo 'no'"
	default:
		return ""
	}
}
