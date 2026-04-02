const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const clawdoe = require("./index.js");
const { privateKeyToAccount } = require("viem/accounts");

function startMcpServer() {
	const apiKey = process.env.CLAWDOE_API_KEY || undefined;
	let currentPrivateKey = process.env.CLAWDOE_WALLET_PRIVATE_KEY || undefined;
	const rpc = process.env.CLAWDOE_RPC || undefined;
	const network = process.env.CLAWDOE_NETWORK || "mainnet";

	let client = clawdoe({ apiKey, account: currentPrivateKey ? privateKeyToAccount(currentPrivateKey) : undefined, rpc, network });

	function reinitClient(newPrivateKey) {
		currentPrivateKey = newPrivateKey;
		client = clawdoe({ apiKey, account: privateKeyToAccount(currentPrivateKey), rpc, network });
	}

	const server = new McpServer({
		name: "clawdoe",
		version: require("../package.json").version,
	});

	// ── wallet ──────────────────────────────────────────

	server.tool(
		"wallet",
		"Generate a new Ethereum wallet on Base. If no private key was configured, the generated wallet becomes the active wallet for this session.",
		{},
		async () => {
			const { privateKey, address } = clawdoe.wallet();

			// if no wallet was configured, use the generated one
			if (!currentPrivateKey) {
				reinitClient(privateKey);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ privateKey, address }, null, 2),
					},
				],
			};
		},
	);

	// ── register ────────────────────────────────────────

	server.tool(
		"register",
		"Register an agent wallet on the Clawdoe dashboard. Uses the address from the configured wallet.",
		{
			name: z.string().describe("Agent name"),
		},
		async ({ name }) => {
			const result = await client.register({ name });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// ── balance ─────────────────────────────────────────

	server.tool(
		"balance",
		"Check ETH and USDC balance on Base. Uses the address from the configured wallet.",
		{},
		async () => {
			const result = await client.balance();
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// ── send ────────────────────────────────────────────

	server.tool(
		"send",
		"Send USDC on Base",
		{
			amount: z.number().describe("USDC amount in dollars (e.g. 4.20)"),
			to: z.string().describe("Recipient Ethereum address"),
		},
		async ({ amount, to }) => {
			const result = await client.send({ amount, to });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// ── fetch ───────────────────────────────────────────

	server.tool(
		"fetch",
		"Fetch a URL with integrated x402 orchestration. If the server responds with 402, handles USDC payment and returns the intended payload.",
		{
			url: z.string().describe("URL to fetch"),
			x402max: z.number().optional().describe("Max USDC to pay (omit for no limit, 0 to disable)"),
		},
		async ({ url, x402max }) => {
			const res = await client.fetch(url, { x402max });
			const contentType = res.headers.get("content-type") || "";
			let body;
			if (contentType.includes("application/json")) {
				body = JSON.stringify(await res.json(), null, 2);
			} else {
				body = await res.text();
			}
			return {
				content: [{ type: "text", text: body }],
			};
		},
	);

	// ── start ───────────────────────────────────────────

	const transport = new StdioServerTransport();
	server.connect(transport);
}

module.exports = { startMcpServer };
