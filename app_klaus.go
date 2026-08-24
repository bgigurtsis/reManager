package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const klausPairingCommand = "/home/root/.vellum/bin/klaus-remarkable-pairing"

type klausPairingDetails struct {
	Address  string `json:"address"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type klausPairingResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

func parseKlausPairingDetails(output string) (klausPairingDetails, error) {
	return parseKlausPairingDetailsForHost(output, "")
}

func parseKlausPairingDetailsForHost(output, preferredHost string) (klausPairingDetails, error) {
	var details klausPairingDetails
	var wifiAddress string
	var matchedAddress string
	preferredHost = strings.TrimSpace(strings.Split(preferredHost, ":")[0])
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "USB address:"):
			details.Address = strings.TrimSpace(strings.TrimPrefix(line, "USB address:"))
		case strings.HasPrefix(line, "Wi-Fi address:") && wifiAddress == "":
			wifiAddress = strings.TrimSpace(strings.TrimPrefix(line, "Wi-Fi address:"))
		case strings.HasPrefix(line, "Username:"):
			details.Username = strings.TrimSpace(strings.TrimPrefix(line, "Username:"))
		case strings.HasPrefix(line, "Pairing password:"):
			details.Password = strings.TrimSpace(strings.TrimPrefix(line, "Pairing password:"))
		}
		if preferredHost != "" && strings.Contains(line, "://"+preferredHost+":") {
			parts := strings.SplitN(line, ": ", 2)
			if len(parts) == 2 {
				matchedAddress = strings.TrimSpace(parts[1])
			}
		}
	}
	if matchedAddress != "" {
		details.Address = matchedAddress
	} else if details.Address == "" {
		details.Address = wifiAddress
	}
	if details.Address == "" || details.Username == "" || details.Password == "" {
		return klausPairingDetails{}, fmt.Errorf("the installed package did not return complete Klaus pairing details")
	}
	return details, nil
}

func klausSocketPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".klaus", "remanager-pairing.sock"), nil
}

func launchKlaus() error {
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("one-click Klaus pairing currently requires macOS")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	installedApp := filepath.Join(home, "Applications", "Klaus.app")
	command := exec.Command("open", "-a", "Klaus")
	if info, statErr := os.Stat(installedApp); statErr == nil && info.IsDir() {
		command = exec.Command("open", installedApp)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("could not open Klaus: %w", err)
	}
	return nil
}

func connectToKlaus(socketPath string) (net.Conn, error) {
	if connection, err := net.DialTimeout("unix", socketPath, 300*time.Millisecond); err == nil {
		return connection, nil
	}
	if err := launchKlaus(); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("unix", socketPath, 300*time.Millisecond)
		if err == nil {
			return connection, nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return nil, fmt.Errorf("Klaus did not start its pairing service")
}

func sendKlausPairing(socketPath string, details klausPairingDetails) (string, error) {
	connection, err := connectToKlaus(socketPath)
	if err != nil {
		return "", err
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(35 * time.Second)); err != nil {
		return "", err
	}
	if err := json.NewEncoder(connection).Encode(details); err != nil {
		return "", fmt.Errorf("could not send pairing details to Klaus: %w", err)
	}
	line, err := bufio.NewReader(connection).ReadBytes('\n')
	if err != nil {
		return "", fmt.Errorf("Klaus closed the pairing request: %w", err)
	}
	if len(line) > 16*1024 {
		return "", fmt.Errorf("Klaus returned an invalid pairing response")
	}
	var response klausPairingResponse
	if err := json.Unmarshal(line, &response); err != nil {
		return "", fmt.Errorf("Klaus returned an invalid pairing response")
	}
	if !response.OK {
		if response.Message == "" {
			response.Message = "Klaus could not pair the tablet"
		}
		return "", fmt.Errorf("%s", response.Message)
	}
	return response.Message, nil
}

// PairKlausRemarkable securely transfers the installed service credentials to Klaus.
func (a *App) PairKlausRemarkable() (string, error) {
	a.mu.Lock()
	preferredHost := ""
	if a.currentConn != nil {
		preferredHost = a.currentConn.host
	}
	output, err := a.runCommand(klausPairingCommand)
	a.mu.Unlock()
	if err != nil {
		return "", fmt.Errorf("could not read Klaus pairing details from the tablet")
	}
	details, err := parseKlausPairingDetailsForHost(output, preferredHost)
	if err != nil {
		return "", err
	}
	socketPath, err := klausSocketPath()
	if err != nil {
		return "", err
	}
	return sendKlausPairing(socketPath, details)
}
