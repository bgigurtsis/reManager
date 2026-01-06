package vellum

import (
	"fmt"

	"reManager/internal/executor"
)

const (
	BootstrapURL = "https://raw.githubusercontent.com/vellum-dev/vellum-cli/main/bootstrap.sh"
)

func (c *Client) Bootstrap(onOutput func(line string)) error {
	cmd := fmt.Sprintf("curl -fSL %s | sh", BootstrapURL)
	return c.executor.ExecuteStreaming(cmd, onOutput)
}

func (c *Client) BootstrapWithExecutor(exec executor.CommandExecutor, onOutput func(line string)) error {
	cmd := fmt.Sprintf("curl -fSL %s | sh", BootstrapURL)
	return exec.ExecuteStreaming(cmd, onOutput)
}
