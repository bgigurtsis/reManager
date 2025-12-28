package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"

	"reManager/internal/commands"
	"reManager/internal/component"
	"reManager/internal/component/definitions"
	"reManager/internal/device"
	"reManager/internal/executor"
	"reManager/internal/installer"
	"reManager/internal/storage"
)

func init() {
	definitions.RegisterAll(component.DefaultRegistry)
}

type App struct {
	ctx            context.Context
	client         *ssh.Client
	session        *ssh.Session
	mu             sync.Mutex
	connectCancel  context.CancelFunc
	commandCancel  context.CancelFunc
	commandSession *ssh.Session
	commandStdin   io.WriteCloser
	dialogResponse chan bool
	deviceStore    *storage.DeviceStore
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	store, err := storage.NewDeviceStore()
	if err != nil {
		fmt.Printf("Warning: could not initialize device store: %v\n", err)
	}
	a.deviceStore = store
}

func (a *App) shutdown(ctx context.Context) {
	a.Disconnect()
}

type ConnectionResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Device  string `json:"device,omitempty"`
}

type SSHKey struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

func (a *App) GetDefaultSSHKeys() []SSHKey {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	sshDir := filepath.Join(home, ".ssh")
	keyNames := []string{"id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"}
	var keys []SSHKey

	for _, name := range keyNames {
		keyPath := filepath.Join(sshDir, name)
		if _, err := os.Stat(keyPath); err == nil {
			keys = append(keys, SSHKey{
				Path: keyPath,
				Name: name,
			})
		}
	}

	return keys
}

func (a *App) SelectKeyFile() string {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select SSH Private Key",
	})
	if err != nil {
		return ""
	}
	return path
}

type SavedDeviceInfo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Host          string `json:"host"`
	AuthType      string `json:"authType"`
	KeyPath       string `json:"keyPath,omitempty"`
	LastConnected int64  `json:"lastConnected,omitempty"`
}

func (a *App) GetSavedDevices() []SavedDeviceInfo {
	if a.deviceStore == nil {
		return []SavedDeviceInfo{}
	}

	devices, err := a.deviceStore.GetAll()
	if err != nil {
		fmt.Printf("Error getting saved devices: %v\n", err)
		return []SavedDeviceInfo{}
	}

	result := make([]SavedDeviceInfo, len(devices))
	for i, d := range devices {
		result[i] = SavedDeviceInfo{
			ID:            d.ID,
			Name:          d.Name,
			Host:          d.Host,
			AuthType:      d.AuthType,
			KeyPath:       d.KeyPath,
			LastConnected: d.LastConnected,
		}
	}
	return result
}

func (a *App) SaveDevice(id, name, host, authType, password, keyPath, keyPassphrase string) (string, error) {
	if a.deviceStore == nil {
		return "", fmt.Errorf("device store not initialized")
	}

	device := storage.SavedDevice{
		ID:            id,
		Name:          name,
		Host:          host,
		AuthType:      authType,
		KeyPath:       keyPath,
		LastConnected: time.Now().Unix(),
	}

	return a.deviceStore.Save(device, password, keyPassphrase)
}

func (a *App) DeleteSavedDevice(id string) error {
	if a.deviceStore == nil {
		return fmt.Errorf("device store not initialized")
	}
	return a.deviceStore.Delete(id)
}

func (a *App) UpdateDeviceName(id string, name string) error {
	if a.deviceStore == nil {
		return fmt.Errorf("device store not initialized")
	}
	return a.deviceStore.UpdateName(id, name)
}

func (a *App) ConnectToSavedDevice(id string) ConnectionResult {
	if a.deviceStore == nil {
		return ConnectionResult{
			Success: false,
			Message: "Device store not initialized",
		}
	}

	device, err := a.deviceStore.Get(id)
	if err != nil {
		return ConnectionResult{
			Success: false,
			Message: fmt.Sprintf("Device not found: %v", err),
		}
	}

	var result ConnectionResult
	if device.AuthType == "key" {
		passphrase, _ := a.deviceStore.GetKeyPassphrase(id)
		result = a.ConnectWithAuth(device.Host, "key", passphrase, device.KeyPath)
	} else {
		password, err := a.deviceStore.GetPassword(id)
		if err != nil {
			return ConnectionResult{
				Success: false,
				Message: "Could not retrieve password. Please reconnect and save the device again.",
			}
		}
		result = a.ConnectWithAuth(device.Host, "password", password, "")
	}

	if result.Success {
		a.deviceStore.UpdateLastConnected(id, time.Now().Unix())
	}

	return result
}

func (a *App) CheckComponentStatus(componentID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.client == nil {
		return false
	}

	var checkCmd string
	switch componentID {
	case "xovi":
		checkCmd = "test -d /home/root/xovi && echo 'yes' || echo 'no'"
	case "qt-resource-rebuilder":
		checkCmd = "test -f /home/root/xovi/extensions.d/qt-resource-rebuilder.so && echo 'yes' || echo 'no'"
	case "tripletap":
		checkCmd = "test -f /home/root/xovi-tripletap/uninstall.sh && echo 'yes' || echo 'no'"
	case "rm-hacks":
		checkCmd = "test -f /home/root/xovi/exthome/qt-resource-rebuilder/zz_rmhacks.qmd && test -d /home/root/xovi/exthome/qt-resource-rebuilder/rmhacks && echo 'yes' || echo 'no'"
	case "appload":
		checkCmd = "test -f /home/root/xovi/extensions.d/appload.so && echo 'yes' || echo 'no'"
	default:
		return false
	}

	output, err := a.runCommand(checkCmd)
	if err != nil {
		return false
	}

	return strings.TrimSpace(output) == "yes"
}

func (a *App) Connect(host, password string) ConnectionResult {
	return a.ConnectWithAuth(host, "password", password, "")
}

func (a *App) ConnectWithKey(host, keyPath, passphrase string) ConnectionResult {
	return a.ConnectWithAuth(host, "key", passphrase, keyPath)
}

func (a *App) CancelConnect() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.connectCancel != nil {
		a.connectCancel()
		a.connectCancel = nil
	}
}

func (a *App) dialWithContext(ctx context.Context, addr string, config *ssh.ClientConfig) (*ssh.Client, error) {
	d := net.Dialer{}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	if err != nil {
		conn.Close()
		return nil, err
	}
	return ssh.NewClient(c, chans, reqs), nil
}

func isRetryableError(err error) bool {
	if err == nil {
		return false
	}

	errStr := strings.ToLower(err.Error())

	nonRetryableKeywords := []string{
		"passphrase",
		"permission denied",
		"unable to authenticate",
		"ssh: handshake failed",
		"no auth",
		"authentication failed",
	}

	for _, keyword := range nonRetryableKeywords {
		if strings.Contains(errStr, keyword) {
			return false
		}
	}

	retryableKeywords := []string{
		"no route to host",
		"connection refused",
		"i/o timeout",
		"connection reset by peer",
		"network is unreachable",
		"host is down",
		"connection timed out",
		"broken pipe",
	}

	for _, keyword := range retryableKeywords {
		if strings.Contains(errStr, keyword) {
			return true
		}
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() || netErr.Temporary() {
			return true
		}
	}

	return false
}

func (a *App) dialWithContextWithRetry(ctx context.Context, addr string, config *ssh.ClientConfig) (*ssh.Client, error) {
	const maxRetries = 3
	backoffDurations := []time.Duration{
		2 * time.Second,
		4 * time.Second,
		8 * time.Second,
	}

	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		client, err := a.dialWithContext(ctx, addr, config)
		if err == nil {
			return client, nil
		}

		lastErr = err

		if ctx.Err() == context.Canceled {
			return nil, context.Canceled
		}

		if !isRetryableError(err) {
			return nil, err
		}

		if attempt == maxRetries {
			break
		}

		backoffDuration := backoffDurations[attempt]

		select {
		case <-time.After(backoffDuration):
			continue
		case <-ctx.Done():
			return nil, context.Canceled
		}
	}

	return nil, lastErr
}

func (a *App) ConnectWithAuth(host, authType, secret, keyPath string) ConnectionResult {
	a.mu.Lock()

	// Cancel any existing connection attempt
	if a.connectCancel != nil {
		a.connectCancel()
	}

	if a.client != nil {
		a.client.Close()
		a.client = nil
	}

	// Create cancellable context for this connection attempt
	ctx, cancel := context.WithCancel(context.Background())
	a.connectCancel = cancel

	a.mu.Unlock()

	var authMethods []ssh.AuthMethod

	if authType == "key" {
		keyData, err := os.ReadFile(keyPath)
		if err != nil {
			return ConnectionResult{
				Success: false,
				Message: fmt.Sprintf("Failed to read key file: %v", err),
			}
		}

		var signer ssh.Signer
		if secret != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(secret))
		} else {
			signer, err = ssh.ParsePrivateKey(keyData)
		}
		if err != nil {
			if strings.Contains(err.Error(), "passphrase") {
				return ConnectionResult{
					Success: false,
					Message: "Key requires a passphrase",
				}
			}
			return ConnectionResult{
				Success: false,
				Message: fmt.Sprintf("Failed to parse key: %v", err),
			}
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else {
		authMethods = append(authMethods, ssh.Password(secret))
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

	client, err := a.dialWithContextWithRetry(ctx, addr, config)
	if err != nil {
		if ctx.Err() == context.Canceled {
			return ConnectionResult{
				Success: false,
				Message: "Connection cancelled",
			}
		}
		return ConnectionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to connect: %v", err),
		}
	}

	a.mu.Lock()
	a.client = client
	a.connectCancel = nil
	a.mu.Unlock()

	device, err := a.detectDevice()
	if err != nil {
		return ConnectionResult{
			Success: true,
			Message: "Connected (could not detect device type)",
			Device:  "unknown",
		}
	}

	return ConnectionResult{
		Success: true,
		Message: "Connected successfully",
		Device:  device,
	}
}

func (a *App) detectDevice() (string, error) {
	output, err := a.runCommand("cat /sys/devices/soc0/machine")
	if err != nil {
		return "", err
	}

	machine := strings.TrimSpace(output)
	switch {
	case strings.Contains(machine, "reMarkable 1"):
		return "rm1", nil
	case strings.Contains(machine, "reMarkable 2"):
		return "rm2", nil
	case strings.Contains(machine, "Ferrari"):
		return "rmpp", nil
	case strings.Contains(machine, "Chiappa"):
		return "rmppm", nil
	default:
		return machine, nil
	}
}

func (a *App) Disconnect() {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.client != nil {
		a.client.Close()
		a.client = nil
	}
}

func (a *App) IsConnected() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.client != nil
}

func (a *App) runCommand(cmd string) (string, error) {
	if a.client == nil {
		return "", fmt.Errorf("not connected")
	}

	session, err := a.client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (a *App) RunCommand(cmd string) string {
	a.mu.Lock()
	defer a.mu.Unlock()

	output, err := a.runCommand(cmd)
	if err != nil {
		return fmt.Sprintf("Error: %v\n%s", err, output)
	}
	return output
}

func (a *App) RunCommandWithOutput(cmd string, requiresPTY bool) {
	fmt.Println("[DEBUG] RunCommandWithOutput called:", cmd[:min(50, len(cmd))], "requiresPTY:", requiresPTY)
	go func() {
		a.mu.Lock()

		if a.client == nil {
			a.mu.Unlock()
			fmt.Println("[DEBUG] Not connected, emitting error")
			runtime.EventsEmit(a.ctx, "command:output", "Error: not connected\n")
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		session, err := a.client.NewSession()
		if err != nil {
			a.mu.Unlock()
			fmt.Println("[DEBUG] Session error:", err)
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error: %v\n", err))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		if requiresPTY {
			err = session.RequestPty("xterm-256color", 40, 120, ssh.TerminalModes{
				ssh.ECHO:          1,
				ssh.TTY_OP_ISPEED: 14400,
				ssh.TTY_OP_OSPEED: 14400,
			})
			if err != nil {
				a.mu.Unlock()
				fmt.Println("[DEBUG] PTY request error:", err)
				runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error requesting PTY: %v\n", err))
				runtime.EventsEmit(a.ctx, "command:done", false)
				return
			}
			fmt.Println("[DEBUG] PTY allocated successfully")
		}

		// Store session and release lock immediately
		a.commandSession = session
		a.mu.Unlock()

		defer func() {
			session.Close()
			a.mu.Lock()
			a.commandSession = nil
			a.commandStdin = nil
			a.mu.Unlock()
		}()

		stdout, err := session.StdoutPipe()
		if err != nil {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error: %v\n", err))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		stderr, err := session.StderrPipe()
		if err != nil {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error: %v\n", err))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		stdin, err := session.StdinPipe()
		if err != nil {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error: %v\n", err))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		// Store stdin reference
		a.mu.Lock()
		a.commandStdin = stdin
		a.mu.Unlock()

		fmt.Println("[DEBUG] Starting command")
		if err := session.Start(cmd); err != nil {
			fmt.Println("[DEBUG] Start error:", err)
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error: %v\n", err))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		if !requiresPTY {
			stdin.Close()
		}

		go func() {
			buf := make([]byte, 1024)
			for {
				n, err := stdout.Read(buf)
				if n > 0 {
					fmt.Printf("[DEBUG] stdout: %d bytes\n", n)
					runtime.EventsEmit(a.ctx, "command:output", string(buf[:n]))
				}
				if err == io.EOF {
					break
				}
				if err != nil {
					break
				}
			}
		}()

		go func() {
			buf := make([]byte, 1024)
			for {
				n, err := stderr.Read(buf)
				if n > 0 {
					fmt.Printf("[DEBUG] stderr: %d bytes\n", n)
					runtime.EventsEmit(a.ctx, "command:output", string(buf[:n]))
				}
				if err == io.EOF {
					break
				}
				if err != nil {
					break
				}
			}
		}()

		err = session.Wait()
		fmt.Println("[DEBUG] Command done, success:", err == nil)
		runtime.EventsEmit(a.ctx, "command:done", err == nil)
	}()
}

func (a *App) StopCommand() {
	a.mu.Lock()
	stdin := a.commandStdin
	a.mu.Unlock()

	if stdin != nil {
		fmt.Println("[DEBUG] Sending Ctrl+C (0x03) to stdin")
		_, err := stdin.Write([]byte{0x03})
		if err != nil {
			fmt.Printf("[DEBUG] Error writing Ctrl+C to stdin: %v\n", err)
		} else {
			fmt.Println("[DEBUG] Ctrl+C sent successfully")
		}
	} else {
		fmt.Println("[DEBUG] No stdin available to send Ctrl+C")
	}
}

func (a *App) GetDeviceInfo() map[string]string {
	a.mu.Lock()
	defer a.mu.Unlock()

	info := make(map[string]string)

	if a.client == nil {
		return info
	}

	if output, err := a.runCommand("cat /sys/devices/soc0/machine"); err == nil {
		info["machine"] = strings.TrimSpace(output)
	}

	if output, err := a.runCommand("grep REMARKABLE_RELEASE_VERSION /usr/share/remarkable/update.conf"); err == nil {
		if parts := strings.SplitN(output, "=", 2); len(parts) == 2 {
			info["firmware"] = strings.TrimSpace(parts[1])
		}
	} else if output, err := a.runCommand("grep IMG_VERSION /etc/os-release"); err == nil {
		if parts := strings.SplitN(output, "=", 2); len(parts) == 2 {
			info["firmware"] = strings.Trim(strings.TrimSpace(parts[1]), "\"")
		}
	}

	if output, err := a.runCommand("test -d /home/root/xovi && echo 'yes' || echo 'no'"); err == nil {
		info["xovi_installed"] = strings.TrimSpace(output)
	}

	return info
}

type UpdateServiceStatus struct {
	Enabled bool `json:"enabled"`
	Running bool `json:"running"`
}

func (a *App) GetUpdateServiceStatus() UpdateServiceStatus {
	a.mu.Lock()
	defer a.mu.Unlock()

	status := UpdateServiceStatus{
		Enabled: false,
		Running: false,
	}

	if a.client == nil {
		return status
	}

	if output, err := a.runCommand("systemctl is-enabled update-engine.service"); err == nil {
		status.Enabled = strings.TrimSpace(output) == "enabled"
	}

	if output, err := a.runCommand("systemctl is-active update-engine.service"); err == nil {
		status.Running = strings.TrimSpace(output) == "active"
	}

	return status
}

type ComponentInfo struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Version      string   `json:"version"`
	Author       string   `json:"author"`
	Dependencies []string `json:"dependencies"`
	Category     string   `json:"category"`
	Tags         []string `json:"tags"`
}

func (a *App) GetComponents() []ComponentInfo {
	components := component.DefaultRegistry.GetAll()
	result := make([]ComponentInfo, len(components))

	for i, comp := range components {
		result[i] = ComponentInfo{
			ID:           comp.ID,
			Name:         comp.Name,
			Description:  comp.Description,
			Version:      comp.Version,
			Author:       comp.Author,
			Dependencies: comp.Dependencies,
			Category:     comp.Category,
			Tags:         comp.Tags,
		}
	}

	return result
}

func (a *App) ResolveDependencies(componentIDs []string) ([]string, error) {
	resolver := component.NewDependencyResolver(component.DefaultRegistry.GetAllAsMap())
	return resolver.Resolve(componentIDs)
}

func (a *App) GetComponentDependents(componentID string) []string {
	resolver := component.NewDependencyResolver(component.DefaultRegistry.GetAllAsMap())
	return resolver.GetDependents(componentID)
}

type MaintenanceCommandInfo struct {
	ID               string `json:"id"`
	Label            string `json:"label"`
	Description      string `json:"description"`
	RequiresTerminal bool   `json:"requiresTerminal"`
	AllowStop        bool   `json:"allowStop"`
}

func (a *App) GetMaintenanceCommands(componentID string) []MaintenanceCommandInfo {
	comp := component.DefaultRegistry.Get(componentID)
	if comp == nil {
		return nil
	}

	result := make([]MaintenanceCommandInfo, len(comp.MaintenanceCommands))
	for i, cmd := range comp.MaintenanceCommands {
		result[i] = MaintenanceCommandInfo{
			ID:               cmd.ID,
			Label:            cmd.Label,
			Description:      cmd.Description,
			RequiresTerminal: cmd.RequiresTerminal,
			AllowStop:        cmd.AllowStop,
		}
	}

	return result
}

type SystemTaskInfo struct {
	ID                 string `json:"id"`
	Label              string `json:"label"`
	Description        string `json:"description"`
	RequiresTerminal   bool   `json:"requiresTerminal"`
	NeedsWriteableRoot bool   `json:"needsWriteableRoot"`
}

func (a *App) GetSystemTasksInfo() []SystemTaskInfo {
	result := make([]SystemTaskInfo, len(device.SystemTasks))
	for i, task := range device.SystemTasks {
		result[i] = SystemTaskInfo{
			ID:                 task.ID,
			Label:              task.Label,
			Description:        task.Description,
			RequiresTerminal:   task.RequiresTerminal,
			NeedsWriteableRoot: task.NeedsWriteableRoot,
		}
	}
	return result
}

func (a *App) GetDeviceDisplayName(machine string) string {
	return device.GetDisplayName(machine)
}

func (a *App) GetDeviceArchitecture(deviceType string) string {
	return string(device.GetArchitecture(component.DeviceType(deviceType)))
}

type InstallProgress struct {
	Component string `json:"component"`
	Index     int    `json:"index"`
	Total     int    `json:"total"`
	Status    string `json:"status"`
	Message   string `json:"message"`
}

type InstallResult struct {
	Success bool     `json:"success"`
	Errors  []string `json:"errors"`
}

type DialogRequest struct {
	Title             string   `json:"title"`
	Message           string   `json:"message"`
	Steps             []string `json:"steps"`
	ConfirmText       string   `json:"confirmText"`
	InProgressMessage string   `json:"inProgressMessage"`
}

func (a *App) RespondToDialog(confirmed bool) {
	if a.dialogResponse != nil {
		a.dialogResponse <- confirmed
	}
}

func (a *App) InstallComponents(componentIDs []string, deviceType string) {
	go func() {
		a.dialogResponse = make(chan bool, 1)
		defer func() {
			close(a.dialogResponse)
			a.dialogResponse = nil
		}()

		arch := device.GetArchitecture(component.DeviceType(deviceType))

		// Get current component status
		componentsStatus := make(map[string]bool)
		for _, comp := range component.DefaultRegistry.GetAll() {
			componentsStatus[comp.ID] = a.CheckComponentStatus(comp.ID)
		}

		ctx := component.CommandContext{
			Arch:             arch,
			Device:           component.DeviceType(deviceType),
			IsInstalled:      false,
			ComponentsStatus: componentsStatus,
		}

		// Create executor that emits events
		exec := &wailsExecutor{app: a}

		inst := installer.NewInstaller(component.DefaultRegistry, exec)

		result := inst.Install(
			componentIDs,
			ctx,
			func(progress executor.ProgressInfo) {
				runtime.EventsEmit(a.ctx, "install:progress", InstallProgress{
					Component: progress.CurrentComponent,
					Index:     progress.CurrentIndex,
					Total:     progress.TotalComponents,
					Status:    string(progress.Status),
					Message:   progress.Message,
				})
			},
			func(hookResult *component.HookExecutionResult) error {
				if hookResult.DialogConfig != nil {
					runtime.EventsEmit(a.ctx, "hook:dialog", DialogRequest{
						Title:             hookResult.DialogConfig.Title,
						Message:           hookResult.DialogConfig.Message,
						Steps:             hookResult.DialogConfig.Steps,
						ConfirmText:       hookResult.DialogConfig.ConfirmText,
						InProgressMessage: hookResult.DialogConfig.InProgressMessage,
					})

					confirmed := <-a.dialogResponse
					if !confirmed {
						return fmt.Errorf("user cancelled")
					}

					if hookResult.Command != nil {
						runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("$ %s\n", hookResult.Command.Script))
						if err := exec.Execute([]component.CommandResult{*hookResult.Command}); err != nil {
							return err
						}
					}
				}
				return nil
			},
		)

		runtime.EventsEmit(a.ctx, "install:complete", InstallResult{
			Success: result.Success,
			Errors:  result.Errors,
		})
	}()
}

func (a *App) UninstallComponents(componentIDs []string, deviceType string) {
	go func() {
		arch := device.GetArchitecture(component.DeviceType(deviceType))

		componentsStatus := make(map[string]bool)
		for _, comp := range component.DefaultRegistry.GetAll() {
			componentsStatus[comp.ID] = a.CheckComponentStatus(comp.ID)
		}

		ctx := component.CommandContext{
			Arch:             arch,
			Device:           component.DeviceType(deviceType),
			IsInstalled:      true,
			ComponentsStatus: componentsStatus,
		}

		exec := &wailsExecutor{app: a}
		inst := installer.NewInstaller(component.DefaultRegistry, exec)

		result := inst.Uninstall(
			componentIDs,
			ctx,
			func(progress executor.ProgressInfo) {
				runtime.EventsEmit(a.ctx, "install:progress", InstallProgress{
					Component: progress.CurrentComponent,
					Index:     progress.CurrentIndex,
					Total:     progress.TotalComponents,
					Status:    string(progress.Status),
					Message:   progress.Message,
				})
			},
		)

		runtime.EventsEmit(a.ctx, "install:complete", InstallResult{
			Success: result.Success,
			Errors:  result.Errors,
		})
	}()
}

func (a *App) RunMaintenanceCommand(componentID, commandID, deviceType string) {
	go func() {
		comp := component.DefaultRegistry.Get(componentID)
		if comp == nil {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Component not found: %s\n", componentID))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		var cmd *component.MaintenanceCommand
		for i := range comp.MaintenanceCommands {
			if comp.MaintenanceCommands[i].ID == commandID {
				cmd = &comp.MaintenanceCommands[i]
				break
			}
		}
		if cmd == nil {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Command not found: %s\n", commandID))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		arch := device.GetArchitecture(component.DeviceType(deviceType))
		ctx := component.CommandContext{
			Arch:             arch,
			Device:           component.DeviceType(deviceType),
			IsInstalled:      true,
			ComponentsStatus: make(map[string]bool),
		}

		cmdResults := cmd.Command(ctx)

		if cmd.NeedsWriteableRoot {
			cmdResults = commands.WrapWithWriteableRoot(cmdResults, component.DeviceType(deviceType))
		}

		for _, c := range cmdResults {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("$ %s\n", c.Script))
			a.RunCommandWithOutput(c.Script, c.RequiresPTY)
		}
	}()
}

func (a *App) RunSystemTask(taskID, deviceType string) {
	go func() {
		task := device.GetSystemTask(taskID)
		if task == nil {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Task not found: %s\n", taskID))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		arch := device.GetArchitecture(component.DeviceType(deviceType))
		ctx := component.CommandContext{
			Arch:             arch,
			Device:           component.DeviceType(deviceType),
			IsInstalled:      false,
			ComponentsStatus: make(map[string]bool),
		}

		cmdResults := task.Command(ctx)

		if task.NeedsWriteableRoot {
			cmdResults = commands.WrapWithWriteableRoot(cmdResults, component.DeviceType(deviceType))
		}

		for _, c := range cmdResults {
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("$ %s\n", c.Script))
			a.RunCommandWithOutput(c.Script, c.RequiresPTY)
		}
	}()
}

type wailsExecutor struct {
	app *App
}

func (e *wailsExecutor) Execute(cmds []component.CommandResult) error {
	for _, cmd := range cmds {
		runtime.EventsEmit(e.app.ctx, "command:output", fmt.Sprintf("$ %s\n", cmd.Script))

		done := make(chan bool, 1)
		unsub := runtime.EventsOn(e.app.ctx, "command:done", func(optionalData ...interface{}) {
			if len(optionalData) > 0 {
				if success, ok := optionalData[0].(bool); ok {
					done <- success
					return
				}
			}
			done <- false
		})

		e.app.RunCommandWithOutput(cmd.Script, cmd.RequiresPTY)
		success := <-done
		unsub()

		if !success {
			return fmt.Errorf("command failed: %s", cmd.Description)
		}
	}
	return nil
}

func (e *wailsExecutor) ExecuteWithOutput(cmd string) (string, error) {
	e.app.mu.Lock()
	defer e.app.mu.Unlock()
	return e.app.runCommand(cmd)
}

func (e *wailsExecutor) ExecuteStreaming(cmd string, onOutput func(line string)) error {
	return fmt.Errorf("streaming not implemented for wails executor")
}
