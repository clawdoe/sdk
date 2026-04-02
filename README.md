# Clawdoe

Payments infrastructure for the agentic economy. SDK, CLI, and MCP server for AI agents on Base and x402.

Your agent calls an API. It gets an x402, handles payment with USDC on Base, returns the payload, and more... with one line of code.

## Install

```bash
npm install clawdoe
```

## Quick Start

```js
const clawdoe = require("clawdoe");
const { privateKeyToAccount } = require("viem/accounts");

// generate local wallet
const { privateKey, address } = clawdoe.wallet();

// initialize viem account
const account = privateKeyToAccount(privateKey);

// initialize client
const client = clawdoe({ apiKey: "clw_...", account });

// register agent with human dashboard
await client.register({ name: "weather-agent" });

// check balance
const { eth, usdc } = await client.balance();

// send USDC
await client.send({ amount: 4.2, to: "0x..." });

// fetch with integrated x402 orchestration
const res = await client.fetch("https://api.weather.com/forecast");
```

## How `client.fetch()` Works

1. Makes a normal GET request
2. If the server responds with `402 Payment Required`, decodes the x402 payment details
3. Signs a USDC payment via EIP-3009 (gasless, no tx from the agent)
4. Retries the request with the payment signature
5. Returns the data

The agent just writes `client.fetch(url)`. Everything else is handled.

## Client Initialization

The client accepts any viem-compatible Account — local private keys, CDP wallets, Privy, or any custom signer. The `account` is required. The `apiKey` is optional and enables connection with your Clawdoe dashboard.

```js
const { privateKeyToAccount } = require("viem/accounts");

// local private key
const account = privateKeyToAccount("0x...");
const client = clawdoe({ apiKey: "clw_...", account });
```

```js
// Coinbase CDP wallet
const { CdpClient } = require("@coinbase/cdp-sdk");
const { toAccount } = require("viem/accounts");

const cdp = new CdpClient();
const account = toAccount(await cdp.evm.createAccount());
const client = clawdoe({ apiKey: "clw_...", account });
```

| Parameter | Type    | Description                                    |
| --------- | ------- | ---------------------------------------------- |
| `account` | Account | A viem Account object. Required.               |
| `apiKey`  | string  | Clawdoe API key (clw\_...).                    |
| `network` | string  | "mainnet" or "testnet". Defaults to "mainnet". |
| `rpc`     | string  | Custom RPC endpoint. Defaults to base.org.     |

## Methods

### `clawdoe.wallet()`

Generate a new Ethereum wallet. Static method — no client needed.

```js
const { privateKey, address } = clawdoe.wallet();
```

### `client.register({ name })`

Register an agent on the Clawdoe dashboard. Requires `apiKey`. Idempotent — safe to call on every startup.

```js
await client.register({ name: "weather-agent" });
```

### `client.balance()`

Check ETH and USDC balance on Base.

```js
const { address, eth, usdc } = await client.balance();
```

### `client.send({ amount, to })`

Send USDC on Base. Amount is in dollars.

```js
const { amount, to, tx_hash } = await client.send({ amount: 4.2, to: "0x..." });
```

### `client.fetch(url, { x402max? })`

Fetch a URL with integrated x402 orchestration.

```js
// default — pays whatever the server requires
const res = await client.fetch("https://api.weather.com/forecast");

// capped at $0.69
const res = await client.fetch("https://api.weather.com/forecast", { x402max: 0.69 });

// disabled — just a normal fetch
const res = await client.fetch("https://api.weather.com/forecast", { x402max: 0 });

// standard response
const data = await res.json();
```

## CLI

```bash
# save credentials
clawdoe config --apiKey clw_... --privateKey 0x... --network mainnet

# generate wallet
clawdoe wallet

# register agent
clawdoe register --name "weather-agent"

# check balance
clawdoe balance

# send USDC
clawdoe send --amount 4.20 --to 0x...

# fetch with integrated x402 orchestration
clawdoe fetch https://api.weather.com/forecast
clawdoe fetch https://api.weather.com/forecast --x402max 0.69
clawdoe fetch https://api.weather.com/forecast --x402max 0
```

## MCP Server

Any MCP-compatible AI agent (Claude, ChatGPT, etc.) can use Clawdoe tools natively and locally. Add this to your config:

```json
{
	"mcpServers": {
		"clawdoe": {
			"command": "npx",
			"args": ["clawdoe", "mcp"],
			"env": {
				"CLAWDOE_API_KEY": "clw_...",
				"CLAWDOE_WALLET_PRIVATE_KEY": "0x...",
				"CLAWDOE_NETWORK": "mainnet"
			}
		}
	}
}
```

Skills: `wallet`, `register`, `balance`, `send`, `fetch`

## Environment Variables

| Variable                     | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `CLAWDOE_API_KEY`            | API key. Required to connect with dashboard.   |
| `CLAWDOE_WALLET_PRIVATE_KEY` | Private key. Used by CLI and MCP.              |
| `CLAWDOE_NETWORK`            | "mainnet" or "testnet". Defaults to "mainnet". |
| `CLAWDOE_RPC`                | Custom RPC endpoint. Defaults to base.org.     |

## Links

- [Dashboard](https://clawdoe.com)
- [Documentation](https://clawdoe.com/docs)

## License

MIT
