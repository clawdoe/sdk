#!/usr/bin/env node

const { Command } = require("commander");
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");
const { homedir } = require("os");
const clawdoe = require("../lib/index.js");
const { privateKeyToAccount } = require("viem/accounts");

const CONFIG_PATH = join(homedir(), ".clawdoerc");
const pkg = require("../package.json");

function loadConfig() {
	if (existsSync(CONFIG_PATH)) {
		try {
			return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		} catch {
			return {};
		}
	}
	return {};
}

function getClient(opts) {
	const config = loadConfig();
	const network = config.network || "mainnet";
	const apiKey = opts.apiKey || process.env.CLAWDOE_API_KEY || config.api_key;
	const privateKey = process.env.CLAWDOE_WALLET_PRIVATE_KEY || config.private_key;
	const rpc = opts.rpc || process.env.CLAWDOE_RPC || config.rpc;
	const account = privateKey ? privateKeyToAccount(privateKey) : undefined;

	return clawdoe({ apiKey, account, rpc, network });
}

const program = new Command();

program
	.name("clawdoe")
	.description("CLI for Clawdoe — Payments infrastructure for the agentic economy")
	.version(pkg.version);

// ── config ──────────────────────────────────────────────

program
	.command("config")
	.description("Save settings locally (~/.clawdoerc)")
	.option("--apiKey <key>", "Your clw_ API key")
	.option("--privateKey <privateKey>", "Your wallet private key (0x...)")
	.option("--network <network>", "Network: mainnet or testnet (default: mainnet)")
	.option("--rpc <url>", "Custom RPC endpoint")
	.action((opts) => {
		if (!opts.apiKey && !opts.rpc && !opts.privateKey && !opts.network) {
			console.error("Error: Provide --apiKey, --privateKey, --network, --rpc");
			process.exit(1);
		}

		if (opts.network && !["mainnet", "testnet"].includes(opts.network)) {
			console.error("Error: --network must be mainnet or testnet");
			process.exit(1);
		}

		if (opts.apiKey && !opts.apiKey.startsWith("clw_")) {
			console.error("Error: Invalid key format. Keys start with clw_");
			process.exit(1);
		}

		if (opts.privateKey && !opts.privateKey.startsWith("0x")) {
			console.error("Error: Private key must start with 0x");
			process.exit(1);
		}

		const config = loadConfig();
		if (opts.apiKey) config.api_key = opts.apiKey;
		if (opts.privateKey) config.private_key = opts.privateKey;
		if (opts.rpc) config.rpc = opts.rpc;
		if (opts.network) {
			config.network = opts.network;
			delete config.rpc;
		}

		writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
		if (opts.apiKey) console.log("API key saved.");
		if (opts.privateKey) console.log("Private key saved.");
		if (opts.rpc) console.log(`RPC set to ${opts.rpc}`);
		if (opts.network) console.log(`Network: ${opts.network}`);
	});

// ── wallet ──────────────────────────────────────────────

program
	.command("wallet")
	.description("Generate and save a new Ethereum wallet for Base")
	.action(() => {
		const { privateKey, address } = clawdoe.wallet();

		const config = loadConfig();
		config.private_key = privateKey;
		writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");

		console.log(`\tAddress:     ${address}`);
		console.log(`\tPrivate Key: ${privateKey}`);
		console.log(`\tSaved to ~/.clawdoerc`);
	});

// ── register ────────────────────────────────────────────

program
	.command("register")
	.description("Connect an agent to Clawdoe human dashboard")
	.requiredOption("--name <name>", "Agent name")
	.option("--apiKey <key>", "API key (overrides saved key)")
	.action(async (opts) => {
		try {
			const client = getClient(opts);
			const result = await client.register({ name: opts.name });
			console.log(`\tName:    ${result.agent_name}`);
			console.log(`\tAddress: ${result.agent_address}`);
		} catch (err) {
			console.error(`Error: ${err.message}`);
			process.exit(1);
		}
	});

// ── balance ─────────────────────────────────────────────

program
	.command("balance")
	.description("Check ETH and USDC balances on Base")
	.option("--rpc <url>", "Custom RPC endpoint")
	.action(async (opts) => {
		try {
			const client = getClient(opts);
			const result = await client.balance();
			console.log(`\tAddress: ${result.address}`);
			console.log(`\tETH:     ${result.eth}`);
			console.log(`\tUSDC:    ${result.usdc}`);
		} catch (err) {
			console.error(`Error: ${err.message}`);
			process.exit(1);
		}
	});

// ── send ────────────────────────────────────────────────

program
	.command("send")
	.description("Send USDC to an address on Base")
	.requiredOption("--amount <amount>", "USDC amount (e.g. 2.50)")
	.requiredOption("--to <address>", "Recipient address (0x...)")
	.option("--rpc <url>", "Custom RPC endpoint")
	.action(async (opts) => {
		try {
			const client = getClient(opts);
			const result = await client.send({ amount: parseFloat(opts.amount), to: opts.to });
			console.log(`\tAmount:  ${result.amount} USDC`);
			console.log(`\tTo:      ${result.to}`);
			console.log(`\tTx Hash: ${result.tx_hash}`);
		} catch (err) {
			console.error(`Error: ${err.message}`);
			process.exit(1);
		}
	});

// ── fetch ───────────────────────────────────────────────

program
	.command("fetch")
	.description("Fetch a URL (integrated x402 orchestration)")
	.argument("<url>", "URL to fetch")
	.option("--x402max <amount>", "Max USDC to pay per request (0 = disabled, omit = no limit)")
	.option("--rpc <url>", "Custom RPC endpoint")
	.action(async (url, opts) => {
		try {
			const client = getClient(opts);
			const x402max = opts.x402max != null ? parseFloat(opts.x402max) : undefined;
			const res = await client.fetch(url, { x402max });
			const contentType = res.headers.get("content-type") || "";
			if (contentType.includes("application/json")) {
				const data = await res.json();
				console.log(JSON.stringify(data, null, 2));
			} else {
				const text = await res.text();
				console.log(text);
			}
		} catch (err) {
			console.error(`Error: ${err.message}`);
			process.exit(1);
		}
	});

// ── mcp ─────────────────────────────────────────────────

program
	.command("mcp")
	.description("Start the MCP server (for Claude, ChatGPT, etc.)")
	.action(() => {
		const { startMcpServer } = require("../lib/mcp.js");
		startMcpServer();
	});

program.parse();
