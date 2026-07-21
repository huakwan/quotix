.PHONY: install compile watch start dist-mac dist-mac-x64 dist-mac-arm64 dist-mac-universal clean-packages

install:
	pnpm install

compile:
	pnpm run compile

watch:
	pnpm run watch

start:
	pnpm start

dist-mac: dist-mac-arm64

# --x64 selects the binary; defaultArch only forces electron-builder's -x64 folder suffix.
dist-mac-x64:
	pnpm run compile
	pnpm exec electron-builder --mac --x64 --dir --config.mac.defaultArch=arm64

dist-mac-arm64:
	pnpm run compile
	pnpm exec electron-builder --mac --arm64 --dir

dist-mac-universal:
	pnpm run dist:mac

clean-packages:
	rm -rf -- release
