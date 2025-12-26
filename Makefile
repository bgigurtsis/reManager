.PHONY: dev build build-all clean

# Development mode with hot reload
dev:
	wails dev

# Build for current platform
build:
	wails build

# Build for all platforms
build-all:
	wails build -platform darwin/amd64 -o xovi-installer-darwin-amd64
	wails build -platform darwin/arm64 -o xovi-installer-darwin-arm64
	wails build -platform linux/amd64 -o xovi-installer-linux-amd64
	wails build -platform windows/amd64 -o xovi-installer-windows-amd64.exe

# Build for macOS universal binary
build-darwin-universal:
	wails build -platform darwin/universal

# Clean build artifacts
clean:
	rm -rf build/bin
	rm -rf frontend/dist
