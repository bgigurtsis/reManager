package vellum

import (
	"fmt"
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
