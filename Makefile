ESBUILD_VERSION = $(shell cat version.txt)
GO_VERSION = $(shell cat go.version)

# Strip debug info
GO_FLAGS += "-ldflags=-s -w"

# Avoid embedding the build path in the executable for more reproducible builds
GO_FLAGS += -trimpath

dashica: version-go cmd/dashica-server/*.go pkg/*/*.go internal/*/*.go go.mod
	CGO_ENABLED=0 go build $(GO_FLAGS) ./server/cmd/dashica-server


check-go-version:
	@go version | grep -F " go$(GO_VERSION) " || (echo 'Please install Go version $(GO_VERSION)' && false)

# Note: Don't add "-race" here by default. The Go race detector is currently
# only supported on the following configurations:
#
#   darwin/amd64
#   darwin/arm64
#   freebsd/amd64,
#   linux/amd64
#   linux/arm64
#   linux/ppc64le
#   netbsd/amd64
#   windows/amd64
#
# Also, it isn't necessarily supported on older OS versions even if the OS/CPU
# combination is supported, such as on macOS 10.9. If you want to test using
# the race detector, you can manually add it using the ESBUILD_RACE environment
# variable like this: "ESBUILD_RACE=-race make test". Or you can permanently
# enable it by adding "export ESBUILD_RACE=-race" to your shell profile.
test-go:
	go test $(ESBUILD_RACE) ./internal/... ./pkg/...

vet-go:
	go vet ./cmd/... ./internal/... ./pkg/...

fmt-go:
	test -z "$(shell go fmt ./cmd/... ./internal/... ./pkg/... )"

# Note: This used to only be rebuilt when "version.txt" was newer than
# "cmd/dashica-server/version.go", but that caused the publishing script to publish
# invalid builds in the case when the publishing script failed once, the change
# to "cmd/dashica-server/version.go" was reverted, and then the publishing script was
# run again, since in that case "cmd/dashica-server/version.go" has a later mtime than
# "version.txt" but is still outdated.
#
# To avoid this problem, we now always run this step regardless of mtime status.
# This step still avoids writing to "cmd/dashica-server/version.go" if it already has
# the correct contents, so it won't unnecessarily invalidate anything that uses
# "cmd/dashica-server/version.go" as a dependency.
version-go:
	node scripts/dashica-build-helper.js --update-version-go

platform-all:
	@$(MAKE) --no-print-directory -j4 \
		platform-darwin-arm64 \
		platform-darwin-x64 \
		platform-linux-arm \
		platform-linux-arm64 \
		platform-linux-ia32 \
		platform-linux-x64 \
		platform-win32-arm64 \
		platform-win32-ia32 \
		platform-win32-x64 \
		platform-neutral

platform-win32-x64: version-go
	node scripts/dashica-build-helper.js npm/@dashica/win32-x64/package.json --version
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -C ./server/ $(GO_FLAGS) -o ../npm/@dashica/win32-x64/dashica-server.exe ./cmd/dashica-server

platform-win32-ia32: version-go
	node scripts/dashica-build-helper.js npm/@dashica/win32-ia32/package.json --version
	CGO_ENABLED=0 GOOS=windows GOARCH=386 go build -C ./server/ $(GO_FLAGS) -o ../npm/@dashica/win32-ia32/dashica-server.exe ./cmd/dashica-server

platform-win32-arm64: version-go
	node scripts/dashica-build-helper.js npm/@dashica/win32-arm64/package.json --version
	CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -C ./server/ $(GO_FLAGS) -o ../npm/@dashica/win32-arm64/dashica-server.exe ./cmd/dashica-server

platform-unixlike: version-go
	@test -n "$(GOOS)" || (echo "The environment variable GOOS must be provided" && false)
	@test -n "$(GOARCH)" || (echo "The environment variable GOARCH must be provided" && false)
	@test -n "$(NPMDIR)" || (echo "The environment variable NPMDIR must be provided" && false)
	node scripts/dashica-build-helper.js "$(NPMDIR)/package.json" --version
	CGO_ENABLED=0 GOOS="$(GOOS)" GOARCH="$(GOARCH)" go build -C ./server/ $(GO_FLAGS) -o "../$(NPMDIR)/bin/dashica-server" ./cmd/dashica-server

platform-darwin-x64:
	@$(MAKE) --no-print-directory GOOS=darwin GOARCH=amd64 NPMDIR=npm/@dashica/darwin-x64 platform-unixlike

platform-darwin-arm64:
	@$(MAKE) --no-print-directory GOOS=darwin GOARCH=arm64 NPMDIR=npm/@dashica/darwin-arm64 platform-unixlike

platform-linux-x64:
	@$(MAKE) --no-print-directory GOOS=linux GOARCH=amd64 NPMDIR=npm/@dashica/linux-x64 platform-unixlike

platform-linux-ia32:
	@$(MAKE) --no-print-directory GOOS=linux GOARCH=386 NPMDIR=npm/@dashica/linux-ia32 platform-unixlike

platform-linux-arm:
	@$(MAKE) --no-print-directory GOOS=linux GOARCH=arm NPMDIR=npm/@dashica/linux-arm platform-unixlike

platform-linux-arm64:
	@$(MAKE) --no-print-directory GOOS=linux GOARCH=arm64 NPMDIR=npm/@dashica/linux-arm64 platform-unixlike

platform-neutral:
	node scripts/dashica-build-helper.js npm/dashica/package.json --version

publish-all: check-go-version
	@grep "## $(ESBUILD_VERSION)" CHANGELOG.md || (echo "Missing '## $(ESBUILD_VERSION)' in CHANGELOG.md (required for automatic release notes)" && false)
	@npm --version > /dev/null || (echo "The 'npm' command must be in your path to publish" && false)
	@echo "Checking for uncommitted/untracked changes..." && test -z "`git status --porcelain | grep -vE 'M (CHANGELOG\.md|version\.txt)'`" || \
		(echo "Refusing to publish with these uncommitted/untracked changes:" && \
		git status --porcelain | grep -vE 'M (CHANGELOG\.md|version\.txt)' && false)
	@echo "Checking for main branch..." && test main = "`git rev-parse --abbrev-ref HEAD`" || \
		(echo "Refusing to publish from non-main branch `git rev-parse --abbrev-ref HEAD`" && false)
	@echo "Checking for unpushed commits..." && git fetch
	@test "" = "`git cherry`" || (echo "Refusing to publish with unpushed commits" && false)

	# Prebuild now to prime go's compile cache and avoid timing issues later
	@$(MAKE) --no-print-directory platform-all

	# Commit now before publishing so git is clean for this: https://github.com/golang/go/issues/37475
	# Note: If this fails, then the version number was likely not incremented before running this command
	git commit -am "publish $(ESBUILD_VERSION) to npm"
	git tag "v$(ESBUILD_VERSION)"
	@test -z "`git status --porcelain`" || (echo "Aborting because git is somehow unclean after a commit" && false)

	# Make sure the npm directory is pristine (including .gitignored files) since it will be published
	rm -fr npm && git checkout npm

	@echo Enter one-time password:
	@read OTP && OTP="$$OTP" $(MAKE) --no-print-directory -j4 \
		publish-win32-x64 \
		publish-win32-ia32 \
		publish-win32-arm64

	@echo Enter one-time password:
	@read OTP && OTP="$$OTP" $(MAKE) --no-print-directory -j4 \
		publish-darwin-arm64 \
		publish-darwin-x64

	@echo Enter one-time password:
	@read OTP && OTP="$$OTP" $(MAKE) --no-print-directory -j4 \
		publish-linux-x64 \
		publish-linux-ia32 \
		publish-linux-arm \
		publish-linux-arm64

	git push origin main "v$(ESBUILD_VERSION)"

publish-win32-x64: platform-win32-x64
	test -n "$(OTP)" && cd npm/@dashica/win32-x64 && npm publish --otp="$(OTP)"

publish-win32-ia32: platform-win32-ia32
	test -n "$(OTP)" && cd npm/@dashica/win32-ia32 && npm publish --otp="$(OTP)"

publish-win32-arm64: platform-win32-arm64
	test -n "$(OTP)" && cd npm/@dashica/win32-arm64 && npm publish --otp="$(OTP)"

publish-darwin-x64: platform-darwin-x64
	test -n "$(OTP)" && cd npm/@dashica/darwin-x64 && npm publish --otp="$(OTP)"

publish-darwin-arm64: platform-darwin-arm64
	test -n "$(OTP)" && cd npm/@dashica/darwin-arm64 && npm publish --otp="$(OTP)"

publish-linux-x64: platform-linux-x64
	test -n "$(OTP)" && cd npm/@dashica/linux-x64 && npm publish --otp="$(OTP)"

publish-linux-ia32: platform-linux-ia32
	test -n "$(OTP)" && cd npm/@dashica/linux-ia32 && npm publish --otp="$(OTP)"

publish-linux-arm: platform-linux-arm
	test -n "$(OTP)" && cd npm/@dashica/linux-arm && npm publish --otp="$(OTP)"

publish-linux-arm64: platform-linux-arm64
	test -n "$(OTP)" && cd npm/@dashica/linux-arm64 && npm publish --otp="$(OTP)"

validate-build:
	@test -n "$(TARGET)" || (echo "The environment variable TARGET must be provided" && false)
	@test -n "$(PACKAGE)" || (echo "The environment variable PACKAGE must be provided" && false)
	@test -n "$(SUBPATH)" || (echo "The environment variable SUBPATH must be provided" && false)
	@echo && echo "🔷 Checking $(SCOPE)$(PACKAGE)"
	@rm -fr validate && mkdir validate
	@$(MAKE) --no-print-directory "$(TARGET)"
	@curl -s "https://registry.npmjs.org/$(SCOPE)$(PACKAGE)/-/$(PACKAGE)-$(ESBUILD_VERSION).tgz" > validate/dashica.tgz
	@cd validate && tar xf dashica.tgz
	@ls -l "npm/$(SCOPE)$(PACKAGE)/$(SUBPATH)" "validate/package/$(SUBPATH)" && \
		shasum "npm/$(SCOPE)$(PACKAGE)/$(SUBPATH)" "validate/package/$(SUBPATH)" && \
		cmp "npm/$(SCOPE)$(PACKAGE)/$(SUBPATH)" "validate/package/$(SUBPATH)"
	@rm -fr validate

# This checks that the published binaries are bitwise-identical to the locally-build binaries
validate-builds:
	git fetch --all --tags && git checkout "v$(ESBUILD_VERSION)"
	@$(MAKE) --no-print-directory TARGET=platform-darwin-arm64      SCOPE=@dashica/ PACKAGE=darwin-arm64        SUBPATH=bin/dashica-server  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-darwin-x64        SCOPE=@dashica/ PACKAGE=darwin-x64          SUBPATH=bin/dashica-server  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-linux-arm         SCOPE=@dashica/ PACKAGE=linux-arm           SUBPATH=bin/dashica-server  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-linux-arm64       SCOPE=@dashica/ PACKAGE=linux-arm64         SUBPATH=bin/dashica-server  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-linux-ia32        SCOPE=@dashica/ PACKAGE=linux-ia32          SUBPATH=bin/dashica-server  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-linux-x64         SCOPE=@dashica/ PACKAGE=linux-x64           SUBPATH=bin/dashica-server  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-win32-arm64       SCOPE=@dashica/ PACKAGE=win32-arm64         SUBPATH=dashica-server.exe  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-win32-ia32        SCOPE=@dashica/ PACKAGE=win32-ia32          SUBPATH=dashica-server.exe  validate-build
	@$(MAKE) --no-print-directory TARGET=platform-win32-x64         SCOPE=@dashica/ PACKAGE=win32-x64           SUBPATH=dashica-server.exe  validate-build

clean:
	go clean -cache
	go clean -testcache
	rm -f dashica
	rm -f npm/@dashica/win32-arm64/dashica-server.exe
	rm -f npm/@dashica/win32-ia32/dashica-server.exe
	rm -f npm/@dashica/win32-x64/dashica-server.exe
	rm -rf npm/@dashica/darwin-arm64/bin
	rm -rf npm/@dashica/darwin-x64/bin
	rm -rf npm/@dashica/linux-arm/bin
	rm -rf npm/@dashica/linux-arm64/bin
	rm -rf npm/@dashica/linux-ia32/bin
	rm -rf npm/@dashica/linux-x64/bin
	rm -rf npm/dashica/bin npm/dashica/lib npm/dashica/install.js
	rm -rf require/*/bench/
	rm -rf require/*/demo/
	rm -rf require/*/node_modules/
	rm -rf require/yarnpnp/.pnp* require/yarnpnp/.yarn* require/yarnpnp/out*.js
	rm -rf validate

# This also cleans directories containing cached code from other projects
clean-all: clean
	rm -fr github demo bench
