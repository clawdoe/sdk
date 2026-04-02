const { createPublicClient, createWalletClient, http, getAddress, formatUnits, parseUnits, toHex, encodeFunctionData } = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { base, baseSepolia } = require("viem/chains");
const { randomBytes } = require("crypto");

const BASE_URL = "https://api.clawdoe.com";

const NETWORK_CONFIG = {
	mainnet: { chain: base, rpc: "https://mainnet.base.org", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chainId: 8453, chains: ["eip155:8453", "base", "base-mainnet"] },
	testnet: { chain: baseSepolia, rpc: "https://sepolia.base.org", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", chainId: 84532, chains: ["eip155:84532", "base-sepolia"] },
};

const USDC_ABI = [
	{
		name: "balanceOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "transfer",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "to", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
];

// EIP-3009 TransferWithAuthorization types for EIP-712 signing
const EIP3009_TYPES = {
	TransferWithAuthorization: [
		{ name: "from", type: "address" },
		{ name: "to", type: "address" },
		{ name: "value", type: "uint256" },
		{ name: "validAfter", type: "uint256" },
		{ name: "validBefore", type: "uint256" },
		{ name: "nonce", type: "bytes32" },
	],
};

/**
 * Parse a 402 response to extract PaymentRequired.
 * Supports v2 (PAYMENT-REQUIRED header) and v1 (JSON body).
 */
async function parsePaymentRequired(res) {
	// v2: base64-encoded header
	const header = res.headers.get("payment-required");
	if (header) {
		return JSON.parse(Buffer.from(header, "base64").toString());
	}

	// v1: JSON body
	const body = await res.json();
	if (body && body.x402Version === 1) {
		return body;
	}

	throw new Error("Invalid 402 response: no payment requirements found");
}

/**
 * Create an EIP-3009 signed authorization for USDC transfer.
 */
async function signEIP3009(account, requirement, net) {
	const now = Math.floor(Date.now() / 1000);
	const nonce = toHex(randomBytes(32));

	// derive chain ID from network string, fall back to configured network
	let chainId = net.chainId;
	if (requirement.network && requirement.network.startsWith("eip155:")) {
		chainId = parseInt(requirement.network.split(":")[1], 10);
	}

	const domain = {
		name: requirement.extra?.name || "USD Coin",
		version: requirement.extra?.version || "2",
		chainId,
		verifyingContract: getAddress(requirement.asset || net.usdc),
	};

	const authorization = {
		from: getAddress(account.address),
		to: getAddress(requirement.payTo),
		value: BigInt(requirement.maxAmountRequired || requirement.amount),
		validAfter: BigInt(now - 600),
		validBefore: BigInt(now + (requirement.maxTimeoutSeconds || 600)),
		nonce,
	};

	const signature = await account.signTypedData({
		domain,
		types: EIP3009_TYPES,
		primaryType: "TransferWithAuthorization",
		message: authorization,
	});

	return { authorization, signature };
}

/**
 * Build a payment payload from a signed authorization.
 */
function buildPaymentPayload(requirement, authorization, signature, x402Version) {
	if (x402Version === 1) {
		return {
			x402Version: 1,
			scheme: requirement.scheme,
			network: requirement.network,
			payload: { authorization, signature },
		};
	}

	return {
		x402Version,
		resource: requirement.resource,
		accepted: requirement,
		payload: { authorization, signature },
	};
}

/**
 * Encode a payment payload as a header value.
 */
function encodePaymentHeader(payload) {
	return Buffer.from(JSON.stringify(payload, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toString("base64");
}

/**
 * Get the header name for the payment signature based on version.
 */
function getPaymentHeaderName(x402Version) {
	return x402Version === 1 ? "X-PAYMENT" : "PAYMENT-SIGNATURE";
}

class ClawdoeError extends Error {
	constructor(message, status, body) {
		super(message);
		this.name = "ClawdoeError";
		this.status = status;
		this.body = body;
	}
}

async function request(path, apiKey, body) {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const data = await res.json();

	if (!res.ok) {
		throw new ClawdoeError(data.error || `Request failed (${res.status})`, res.status, data);
	}

	return data;
}

/**
 * Create a Clawdoe client.
 * @param {Object} opts
 * @param {string} [opts.apiKey] - API key (clw_...). Required for register.
 * @param {Object} opts.account - A viem Account (from privateKeyToAccount, CDP toAccount, etc.). Required.
 * @param {string} [opts.rpc] - Custom RPC endpoint. Defaults to Base public RPC.
 * @param {string} [opts.network] - "mainnet" or "testnet". Defaults to "mainnet".
 */
function clawdoe({ apiKey, account, network, rpc } = {}) {
	if (!account) throw new Error("account is required");
	const net = NETWORK_CONFIG[network] || NETWORK_CONFIG.mainnet;
	if (!rpc) rpc = net.rpc;
	if (apiKey && !apiKey.startsWith("clw_")) {
		throw new Error("Invalid API key format. Keys start with clw_");
	}

	const derivedAddress = account ? account.address : null;

	function getPublicClient() {
		return createPublicClient({ chain: net.chain, transport: http(rpc) });
	}

	return {
		address: derivedAddress,

		async register({ name } = {}) {
			if (!apiKey) throw new Error("apiKey is required to register");
			if (!name) throw new Error("name is required");
			const data = await request("/register", apiKey, { name, address: derivedAddress });
			return data.agent;
		},

		async balance() {
			const publicClient = getPublicClient();

			const [ethBal, usdcBal] = await Promise.all([
				publicClient.getBalance({ address: getAddress(derivedAddress) }),
				publicClient.readContract({
					address: getAddress(net.usdc),
					abi: USDC_ABI,
					functionName: "balanceOf",
					args: [getAddress(derivedAddress)],
				}),
			]);

			return {
				address: derivedAddress,
				eth: formatUnits(ethBal, 18),
				usdc: formatUnits(usdcBal, 6),
			};
		},

		/**
		 * Fetch a URL with integrated x402 orchestration. If the server
		 * responds with 402, signs a USDC payment and retries.
		 * @param {string} url - URL to fetch
		 * @param {Object} [opts]
		 * @param {number} [opts.x402max] - Max USDC to pay per request (0 = disabled, omit = no limit)
		 * @returns {Promise<Response>} - The fetch Response object
		 */
		async fetch(url, { x402max } = {}) {
			// first request — normal fetch
			const res = await fetch(url);

			// not a 402, or x402 disabled — return as-is
			if (res.status !== 402 || x402max === 0) {
				return res;
			}

			// x402 flow
			const paymentRequired = await parsePaymentRequired(res);
			const x402Version = paymentRequired.x402Version || 1;

			// find a requirement matching our configured network
			const requirement = paymentRequired.accepts.find((r) => net.chains.includes(r.network));

			if (!requirement) {
				throw new Error("Base network payment not available");
			}

			// check amount against x402max
			const amountRaw = requirement.maxAmountRequired || requirement.amount;
			const decimals = 6; // USDC
			const amountUsd = Number(amountRaw) / 10 ** decimals;
			if (x402max != null && amountUsd > x402max) {
				throw new Error(
					`x402 payment of $${amountUsd.toFixed(2)} exceeds x402max of $${x402max}`,
				);
			}

			// sign the authorization
			const { authorization, signature } = await signEIP3009(account, requirement, net);

			// build and encode payload
			const payload = buildPaymentPayload(requirement, authorization, signature, x402Version);
			const headerName = getPaymentHeaderName(x402Version);
			const headerValue = encodePaymentHeader(payload);

			// retry with payment header
			const paidRes = await fetch(url, {
				headers: { [headerName]: headerValue },
			});

			// log to dashboard if apiKey is available
			if (apiKey && paidRes.ok) {
				const txHash = paidRes.headers.get("payment-response") || paidRes.headers.get("x-payment-response");
				let settledTx = null;
				if (txHash) {
					try {
						const settled = JSON.parse(Buffer.from(txHash, "base64").toString());
						settledTx = settled.transaction || null;
					} catch {}
				}

				request("/log", apiKey, {
					tx_hash: settledTx || "0x" + "0".repeat(64),
					agent_address: derivedAddress,
					target_address: requirement.payTo,
					service_url: url,
					amount: (Number(amountRaw) / 10 ** decimals).toString(),
					protocol: "x402",
					network: network || "mainnet",
				}).catch((err) => console.error("[clawdoe log error]", err.message));
			}

			return paidRes;
		},

		async send({ amount, to } = {}) {
			if (!amount) throw new Error("amount is required");
			if (!to) throw new Error("to is required");

			const publicClient = getPublicClient();
			const walletClient = createWalletClient({
				account,
				chain: net.chain,
				transport: http(rpc),
			});

			const hash = await walletClient.writeContract({
				address: getAddress(net.usdc),
				abi: USDC_ABI,
				functionName: "transfer",
				args: [getAddress(to), parseUnits(amount.toString(), 6)],
			});

			const receipt = await publicClient.waitForTransactionReceipt({ hash });

			return {
				amount,
				to,
				tx_hash: receipt.transactionHash,
			};
		},
	};
}

/**
 * Generate a new Ethereum wallet.
 * @returns {{privateKey: string, address: string}}
 */
clawdoe.wallet = function () {
	const privateKey = generatePrivateKey();
	const account = privateKeyToAccount(privateKey);
	return {
		privateKey,
		address: account.address,
	};
};

clawdoe.ClawdoeError = ClawdoeError;

module.exports = clawdoe;
