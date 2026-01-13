package vellum

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const (
	VellumRepoBaseURL = "https://packages.vellum.delivery"
	VellumCacheDir    = "/home/root/.vellum/etc/apk/cache"
	ProxyTimeout      = 60 * time.Second
)

type Proxy struct {
	client    *Client
	sshClient *ssh.Client
	arch      string
}

func NewProxy(client *Client, sshClient *ssh.Client, arch string) *Proxy {
	// Map architecture names to vellum repo format
	repoArch := arch
	if arch == "arm32" {
		repoArch = "armv7"
	}

	return &Proxy{
		client:    client,
		sshClient: sshClient,
		arch:      repoArch,
	}
}

// ProxyDownload downloads APKINDEX and packages, uploads them to device cache.
// Returns the list of all package names that will be installed (including dependencies).
func (p *Proxy) ProxyDownload(packages []string, onProgress func(string)) ([]string, error) {
	onProgress("Downloading package index...")

	// 1. Download and parse APKINDEX
	apkindexURL := fmt.Sprintf("%s/%s/APKINDEX.tar.gz", VellumRepoBaseURL, p.arch)
	apkindexData, err := downloadFile(apkindexURL)
	if err != nil {
		return nil, fmt.Errorf("failed to download APKINDEX: %w", err)
	}

	// Parse APKINDEX to get C: fields
	checksums, err := parseAPKINDEX(apkindexData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse APKINDEX: %w", err)
	}

	// 2. Upload APKINDEX to device cache
	apkindexCacheName := computeAPKINDEXCacheName(apkindexURL)
	remotePath := fmt.Sprintf("%s/%s", VellumCacheDir, apkindexCacheName)
	onProgress(fmt.Sprintf("Transferring %s...", apkindexCacheName))

	if err := p.uploadToDevice(apkindexData, remotePath); err != nil {
		return nil, fmt.Errorf("failed to upload APKINDEX: %w", err)
	}

	// 3. Simulate to get only packages that will actually be installed
	onProgress("Resolving dependencies...")
	toInstall, err := p.client.SimulateAdd(packages...)
	if err != nil {
		return nil, fmt.Errorf("failed to simulate install: %w", err)
	}

	// If nothing to install, return early
	if len(toInstall) == 0 {
		onProgress("All packages already installed")
		return nil, nil
	}

	// 4. Get download URLs only for packages that need to be installed
	urls, err := p.client.FetchURLs(toInstall...)
	if err != nil {
		return nil, fmt.Errorf("failed to get package URLs: %w", err)
	}

	// 5. Download and upload each package
	for _, url := range urls {
		// Skip local paths (not https://)
		if !strings.HasPrefix(url, "https://") {
			continue
		}

		pkgName, pkgVersion := parsePackageURL(url)
		if pkgName == "" {
			continue
		}

		onProgress(fmt.Sprintf("Downloading %s-%s...", pkgName, pkgVersion))

		// Download the package
		pkgData, err := downloadFile(url)
		if err != nil {
			return nil, fmt.Errorf("failed to download %s: %w", pkgName, err)
		}

		// Compute cache filename
		cField, ok := checksums[pkgName]
		if !ok {
			return nil, fmt.Errorf("checksum not found for package: %s", pkgName)
		}
		hash8 := computePackageHash(cField)
		cacheFilename := fmt.Sprintf("%s-%s.%s.apk", pkgName, pkgVersion, hash8)

		// Upload to device cache
		remotePath := fmt.Sprintf("%s/%s", VellumCacheDir, cacheFilename)
		onProgress(fmt.Sprintf("Transferring %s...", cacheFilename))

		if err := p.uploadToDevice(pkgData, remotePath); err != nil {
			return nil, fmt.Errorf("failed to upload %s: %w", pkgName, err)
		}
	}

	onProgress("All packages downloaded and cached")
	return toInstall, nil
}

func (p *Proxy) uploadToDevice(data []byte, remotePath string) error {
	sftpClient, err := sftp.NewClient(p.sshClient)
	if err != nil {
		return fmt.Errorf("failed to create SFTP client: %w", err)
	}
	defer sftpClient.Close()

	f, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote file %s: %w", remotePath, err)
	}
	defer f.Close()

	_, err = f.Write(data)
	return err
}

func downloadFile(url string) ([]byte, error) {
	client := &http.Client{Timeout: ProxyTimeout}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

// parseAPKINDEX extracts package name → C: field mapping from APKINDEX.tar.gz
func parseAPKINDEX(data []byte) (map[string]string, error) {
	checksums := make(map[string]string)

	gzr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		if hdr.Name != "APKINDEX" {
			continue
		}

		// Parse the APKINDEX file
		scanner := bufio.NewScanner(tr)
		var currentC string
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "C:") {
				currentC = strings.TrimPrefix(line, "C:")
			} else if strings.HasPrefix(line, "P:") {
				pkgName := strings.TrimPrefix(line, "P:")
				if currentC != "" {
					checksums[pkgName] = currentC
				}
			} else if line == "" {
				currentC = ""
			}
		}

		if err := scanner.Err(); err != nil {
			return nil, err
		}
	}

	return checksums, nil
}

// UploadAPKINDEX downloads the APKINDEX and uploads it to device cache.
// This should be called before vellum update to ensure the index is available.
func (p *Proxy) UploadAPKINDEX(onProgress func(string)) error {
	onProgress("Downloading package index...")

	apkindexURL := fmt.Sprintf("%s/%s/APKINDEX.tar.gz", VellumRepoBaseURL, p.arch)
	apkindexData, err := downloadFile(apkindexURL)
	if err != nil {
		return fmt.Errorf("failed to download APKINDEX: %w", err)
	}

	apkindexCacheName := computeAPKINDEXCacheName(apkindexURL)
	remotePath := fmt.Sprintf("%s/%s", VellumCacheDir, apkindexCacheName)
	onProgress(fmt.Sprintf("Transferring %s...", apkindexCacheName))

	if err := p.uploadToDevice(apkindexData, remotePath); err != nil {
		return fmt.Errorf("failed to upload APKINDEX: %w", err)
	}

	return nil
}

// computeAPKINDEXCacheName returns the cache filename for APKINDEX
// Format: APKINDEX.{sha256(url)[:8]}.tar.gz
func computeAPKINDEXCacheName(url string) string {
	hash := sha256.Sum256([]byte(url))
	hash8 := hex.EncodeToString(hash[:])[:8]
	return fmt.Sprintf("APKINDEX.%s.tar.gz", hash8)
}

// computePackageHash computes the 8-char hash from C: field
// C: field format: Q1{base64} where base64 is SHA1 of package content
func computePackageHash(cField string) string {
	// Strip Q1 prefix
	if strings.HasPrefix(cField, "Q1") {
		cField = cField[2:]
	}

	// Base64 decode
	decoded, err := base64.StdEncoding.DecodeString(cField)
	if err != nil {
		return ""
	}

	// Hex encode and take first 8 chars
	return hex.EncodeToString(decoded)[:8]
}

// parsePackageURL extracts package name and version from URL
// URL format: https://packages.vellum.delivery/aarch64/pkg-name-1.0.0-r0.apk
func parsePackageURL(url string) (name, version string) {
	// Get filename from URL
	filename := path.Base(url)

	// Remove .apk extension
	if !strings.HasSuffix(filename, ".apk") {
		return "", ""
	}
	filename = strings.TrimSuffix(filename, ".apk")

	// Parse name-version format
	// Version typically ends with -rN (e.g., 1.0.0-r0)
	// Find the last occurrence of version pattern
	parts := strings.Split(filename, "-")
	if len(parts) < 3 {
		return "", ""
	}

	// Find where version starts (usually contains digits and dots)
	versionStart := -1
	for i := len(parts) - 1; i >= 0; i-- {
		part := parts[i]
		// Check if this looks like a revision (r0, r1, etc.)
		if strings.HasPrefix(part, "r") && len(part) >= 2 {
			continue
		}
		// Check if this looks like a version number
		if len(part) > 0 && (part[0] >= '0' && part[0] <= '9') {
			versionStart = i
			break
		}
	}

	if versionStart < 1 {
		return "", ""
	}

	name = strings.Join(parts[:versionStart], "-")
	version = strings.Join(parts[versionStart:], "-")

	return name, version
}
