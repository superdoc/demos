.PHONY: dev install clean

dev: install
	@.venv/bin/python scripts/dev.py

install: .venv/.installed client/node_modules/.installed collaboration/node_modules/.installed

.venv/.installed: server/requirements.txt
	@python3 -m venv .venv
	@.venv/bin/pip install -r server/requirements.txt
	@touch $@

client/node_modules/.installed: client/package.json client/package-lock.json
	@cd client && npm install
	@touch $@

collaboration/node_modules/.installed: collaboration/package.json collaboration/package-lock.json
	@cd collaboration && npm install
	@touch $@

clean:
	@rm -rf .venv client/node_modules collaboration/node_modules client/dist

