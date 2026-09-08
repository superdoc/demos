import { defineConfig } from "@playwright/test";

const allDemos = [
	{ name: "superdoc-inline-revisions", cwd: "../superdoc-inline-revisions", port: 4173, command: "pnpm exec vite preview" },
	{ name: "template-builder-document-api-v2-demo", cwd: "../template-builder-document-api-v2-demo", port: 4174, command: "pnpm exec vite preview" },
	{ name: "docrag", cwd: "../rag/apps/web", port: 4175, command: "bunx vite preview" },
];

const filter = process.env.DEMO;
const demos = filter
	? allDemos.filter((d) => d.name === filter)
	: allDemos;

export default defineConfig({
	testDir: ".",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: "list",
	use: {
		trace: "retain-on-failure",
	},
	webServer: demos.map((d) => ({
		command: `${d.command} --port ${d.port} --strictPort`,
		cwd: d.cwd,
		url: `http://localhost:${d.port}`,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	})),
	projects: demos.map((d) => ({
		name: d.name,
		use: { baseURL: `http://localhost:${d.port}` },
	})),
});
