.PHONY: dev install clean

dev: install
	@node scripts/dev.mjs $(if $(LOG),--log $(LOG),)

install: client/node_modules/.installed server/node_modules/.installed

client/node_modules/.installed: client/package.json client/package-lock.json
	@cd client && npm install
	@touch $@

server/node_modules/.installed: server/package.json server/package-lock.json
	@cd server && npm install
	@touch $@

clean:
	@rm -rf client/node_modules server/node_modules client/dist
