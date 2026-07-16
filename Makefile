.PHONY: install compile watch start dist-mac

install:
	pnpm install

compile:
	pnpm run compile

watch:
	pnpm run watch

start:
	pnpm start

dist-mac:
	pnpm run dist:mac
