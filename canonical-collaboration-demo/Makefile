.PHONY: dev install profile profile-chart clean

dev: install
	@node scripts/dev.mjs $(if $(LOG),--log $(LOG),)

install: client/node_modules/.installed server/node_modules/.installed

profile: install
	@test -n "$(DOC)" || (echo "Usage: make profile DOC=/path/to/document.docx [TRIALS=10]" && exit 1)
	@node profiling/document-worker/profile.mjs "$(DOC)" profiling/document-worker/results/memory-trials.csv $(if $(TRIALS),$(TRIALS),)
	@$(MAKE) profile-chart

profile-chart:
	@node profiling/document-worker/generate-breakdown-chart.mjs

client/node_modules/.installed: client/package.json client/package-lock.json
	@cd client && npm install
	@touch $@

server/node_modules/.installed: server/package.json server/package-lock.json
	@cd server && npm install
	@touch $@

clean:
	@rm -rf client/node_modules server/node_modules client/dist
