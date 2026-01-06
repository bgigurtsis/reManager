package vellum

import (
	"fmt"
	"regexp"
	"strings"

	"reManager/internal/executor"
)

const (
	VellumRoot = "/home/root/.vellum"
	VellumBin  = "/home/root/.vellum/bin/vellum"
)

type Client struct {
	executor executor.CommandExecutor
}

func NewClient(exec executor.CommandExecutor) *Client {
	return &Client{executor: exec}
}

func (c *Client) IsInstalled() (bool, error) {
	cmd := fmt.Sprintf("test -x %s && echo yes || echo no", VellumBin)
	fmt.Printf("[DEBUG] IsInstalled running: %s\n", cmd)
	output, err := c.executor.ExecuteWithOutput(cmd)
	fmt.Printf("[DEBUG] IsInstalled output: %q, err: %v\n", output, err)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(output) == "yes", nil
}

func (c *Client) Add(packages ...string) error {
	if len(packages) == 0 {
		return nil
	}
	cmd := fmt.Sprintf("%s add %s", VellumBin, strings.Join(packages, " "))
	_, err := c.executor.ExecuteWithOutput(cmd)
	return err
}

func (c *Client) AddStreaming(onOutput func(line string), packages ...string) error {
	if len(packages) == 0 {
		return nil
	}
	cmd := fmt.Sprintf("%s add %s", VellumBin, strings.Join(packages, " "))
	fmt.Printf("[DEBUG] AddStreaming running: %s\n", cmd)
	err := c.executor.ExecuteStreaming(cmd, onOutput)
	fmt.Printf("[DEBUG] AddStreaming result: err=%v\n", err)
	return err
}

func (c *Client) Del(packages ...string) error {
	if len(packages) == 0 {
		return nil
	}
	cmd := fmt.Sprintf("%s del %s", VellumBin, strings.Join(packages, " "))
	_, err := c.executor.ExecuteWithOutput(cmd)
	return err
}

func (c *Client) DelStreaming(onOutput func(line string), packages ...string) error {
	if len(packages) == 0 {
		return nil
	}
	cmd := fmt.Sprintf("%s del %s", VellumBin, strings.Join(packages, " "))
	return c.executor.ExecuteStreaming(cmd, onOutput)
}

func (c *Client) Update() error {
	cmd := fmt.Sprintf("%s update", VellumBin)
	_, err := c.executor.ExecuteWithOutput(cmd)
	return err
}

func (c *Client) List() ([]string, error) {
	cmd := fmt.Sprintf("%s info -q", VellumBin)
	output, err := c.executor.ExecuteWithOutput(cmd)
	if err != nil {
		return nil, err
	}

	var packages []string
	for _, line := range strings.Split(output, "\n") {
		pkg := strings.TrimSpace(line)
		if pkg != "" {
			packages = append(packages, pkg)
		}
	}
	return packages, nil
}

func (c *Client) IsPackageInstalled(pkg string) (bool, error) {
	installed, err := c.List()
	if err != nil {
		return false, err
	}
	for _, p := range installed {
		if p == pkg {
			return true, nil
		}
	}
	return false, nil
}

// FetchURLs returns the download URLs for packages and their dependencies
func (c *Client) FetchURLs(packages ...string) ([]string, error) {
	if len(packages) == 0 {
		return nil, nil
	}
	args := strings.Join(packages, " ")
	cmd := fmt.Sprintf("%s fetch --url --simulate -R %s", VellumBin, args)
	output, err := c.executor.ExecuteWithOutput(cmd)
	if err != nil {
		return nil, err
	}

	var urls []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "https://") {
			urls = append(urls, line)
		}
	}
	return urls, nil
}

// SimulateAdd returns the list of packages that would actually be installed
// (excludes packages that are already installed)
func (c *Client) SimulateAdd(packages ...string) ([]string, error) {
	if len(packages) == 0 {
		return nil, nil
	}
	cmd := fmt.Sprintf("%s add --simulate %s", VellumBin, strings.Join(packages, " "))
	output, err := c.executor.ExecuteWithOutput(cmd)
	if err != nil {
		return nil, err
	}
	return parseSimulationOutput(output), nil
}

// SimulateDelResult contains the result of simulating a package deletion
type SimulateDelResult struct {
	Packages []string            // packages that would be removed
	Blocked  map[string][]string // pkg -> list of blocking packages (e.g. "xovi" -> ["hide-dev-mode-icon"])
}

// SimulateDel simulates package deletion and returns packages to remove and any blockers
func (c *Client) SimulateDel(packages ...string) (*SimulateDelResult, error) {
	if len(packages) == 0 {
		return &SimulateDelResult{}, nil
	}
	cmd := fmt.Sprintf("%s del -s %s", VellumBin, strings.Join(packages, " "))
	output, err := c.executor.ExecuteWithOutput(cmd)
	if err != nil {
		return nil, err
	}

	result := &SimulateDelResult{
		Packages: parseSimulationOutput(output),
		Blocked:  parseBlockedPackages(output),
	}
	return result, nil
}

// SimulateDelRecursive simulates recursive package deletion (includes dependents)
func (c *Client) SimulateDelRecursive(packages ...string) ([]string, error) {
	if len(packages) == 0 {
		return nil, nil
	}
	cmd := fmt.Sprintf("%s del -rs %s", VellumBin, strings.Join(packages, " "))
	output, err := c.executor.ExecuteWithOutput(cmd)
	if err != nil {
		return nil, err
	}
	return parseSimulationOutput(output), nil
}

// DelRecursiveStreaming removes packages and their dependents with streaming output
func (c *Client) DelRecursiveStreaming(onOutput func(line string), packages ...string) error {
	if len(packages) == 0 {
		return nil
	}
	cmd := fmt.Sprintf("%s del -r %s", VellumBin, strings.Join(packages, " "))
	return c.executor.ExecuteStreaming(cmd, onOutput)
}

// parseSimulationOutput extracts package names from vellum simulation output
// Example lines: "(1/3) Purging hide-dev-mode-icon (1.0.0-r0)"
//
//	"(2/3) Installing qt-resource-rebuilder (16.0.0-r0)"
var simulationLineRegex = regexp.MustCompile(`\(\d+/\d+\)\s+(?:Installing|Purging)\s+([^\s]+)\s+\(`)

func parseSimulationOutput(output string) []string {
	var packages []string
	for _, line := range strings.Split(output, "\n") {
		matches := simulationLineRegex.FindStringSubmatch(line)
		if len(matches) >= 2 {
			packages = append(packages, matches[1])
		}
	}
	return packages
}

// parseBlockedPackages extracts blocked package info from vellum simulation output
// Example output (can wrap to multiple lines):
//
//	World updated, but the following packages are not removed due to:
//	  xovi: quicksettings-screenshot bettertoc hide-dev-mode-icon
//	        disable-selection-autoscroll gesture-toolbar-show
func parseBlockedPackages(output string) map[string][]string {
	blocked := make(map[string][]string)
	inBlockedSection := false
	var currentPkg string

	for _, line := range strings.Split(output, "\n") {
		if strings.Contains(line, "not removed due to:") {
			inBlockedSection = true
			continue
		}
		if inBlockedSection {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				inBlockedSection = false
				currentPkg = ""
				continue
			}

			// Check for "pkg: blockers" format (line starts with 2 spaces and has colon)
			if idx := strings.Index(line, ":"); idx > 0 && strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "        ") {
				parts := strings.SplitN(trimmed, ":", 2)
				if len(parts) == 2 {
					currentPkg = strings.TrimSpace(parts[0])
					blockers := strings.Fields(parts[1])
					blocked[currentPkg] = append(blocked[currentPkg], blockers...)
				}
			} else if currentPkg != "" {
				// Continuation line - just indented blockers
				blockers := strings.Fields(trimmed)
				blocked[currentPkg] = append(blocked[currentPkg], blockers...)
			}
		}
	}
	return blocked
}
