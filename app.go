package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

type App struct {
	ctx           context.Context
	client        *ssh.Client
	session       *ssh.Session
	mu            sync.Mutex
	connectCancel context.CancelFunc
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

	client, err := a.dialWithContext(ctx, addr, config)
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
		return "paperpro", nil
	case strings.Contains(machine, "Chiappa"):
		return "move", nil
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

func (a *App) RunCommandWithOutput(cmd string) {
	fmt.Println("[DEBUG] RunCommandWithOutput called:", cmd[:min(50, len(cmd))])
	go func() {
		a.mu.Lock()
		defer a.mu.Unlock()

		if a.client == nil {
			fmt.Println("[DEBUG] Not connected, emitting error")
			runtime.EventsEmit(a.ctx, "command:output", "Error: not connected\n")
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}

		session, err := a.client.NewSession()
		if err != nil {
			fmt.Println("[DEBUG] Session error:", err)
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error: %v\n", err))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
		}
		defer session.Close()

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

		fmt.Println("[DEBUG] Starting command")
		if err := session.Start(cmd); err != nil {
			fmt.Println("[DEBUG] Start error:", err)
			runtime.EventsEmit(a.ctx, "command:output", fmt.Sprintf("Error: %v\n", err))
			runtime.EventsEmit(a.ctx, "command:done", false)
			return
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
