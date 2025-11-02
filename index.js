// ──────────────────────────────────────────────────────────────
// index.js – Discord bot that reports pNode version stats
// Uses the local RPC endpoint exactly as you invoke it with curl:
//   curl -X POST http://127.0.0.1:6000/rpc \
//        -H "Content-Type: application/json" \
//        -d '{"jsonrpc":"2.0","method":"get-pods","id":1}'
// ──────────────────────────────────────────────────────────────

const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
} = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ---------------------------------------------------------------
// JSON‑RPC helper (POST) – points at the local endpoint
// ---------------------------------------------------------------
const fetch = require('node-fetch');               // npm i node-fetch@2
const RPC_URL = 'http://127.0.0.1:6000/rpc';       // <-- local RPC daemon

/**
 * Sends a JSON‑RPC request.
 * @param {string} method   RPC method name (e.g. "get-pods")
 * @param {any[]}  params   Parameters for the method (empty array for get-pods)
 * @returns {Promise<any>}  The `result` field from the RPC response.
 */
async function rpcCall(method, params = []) {
  const payload = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  };

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`RPC error (${data.error.code}): ${data.error.message}`);
  }
  return data.result;   // <-- this is the object that contains `pods` and `total_count`
}

// ---------------------------------------------------------------
// Small utility to safely pull the pod array out of the RPC result
// ---------------------------------------------------------------
function extractPods(rpcResult) {
  // Defensive: if the shape ever changes we fall back to an empty array
  if (rpcResult && Array.isArray(rpcResult.pods)) {
    return rpcResult.pods;
  }
  console.warn('extractPods: unexpected RPC shape', JSON.stringify(rpcResult));
  return [];
}

// ---------------------------------------------------------------
// Functions that replace the old curl/jq pipeline
// ---------------------------------------------------------------

/**
 * Returns the number of pods whose version string contains the supplied fragment.
 * Example: getPodsByVersion('0.4.0') → 12
 */
async function getPodsByVersion(versionFragment) {
  const rpcResult = await rpcCall('get-pods');   // POST request
  const podsArray = extractPods(rpcResult);
  return podsArray.filter(pod =>
    String(pod.version).includes(versionFragment)
  ).length;
}

/**
 * Returns the total number of pods reported by the network.
 * The RPC response already includes `total_count`; we prefer that.
 */
async function getTotalPods() {
  const rpcResult = await rpcCall('get-pods');
  if (rpcResult && typeof rpcResult.total_count === 'number') {
    return rpcResult.total_count;
  }
  // Fallback – count the array we extracted
  const podsArray = extractPods(rpcResult);
  return podsArray.length;
}

/**
 * Gather all the stats we want to display.
 */
async function getPNodesInfo() {
  try {
    const [count040, count041, count042, total] = await Promise.all([
      getPodsByVersion('0.4.0'),
      getPodsByVersion('0.4.1'),
      getPodsByVersion('0.4.2'),
      getTotalPods(),
    ]);

    // Preserve the original markdown block so Discord renders it nicely.
    return (
      '```ml\n' +
      `pNodes Version: Counts\n` +
      `       \`0.4.0\`:      ${count040}\n` +
      `       \`0.4.1\`:      ${count041}\n` +
      `       \`0.4.2\`:    ${count042}\n` +
      `         Total:    ${total}\n` +
      '```'
    );
  } catch (err) {
    return `Error retrieving data: ${err.message}`;
  }
}

// ---------------------------------------------------------------
// Discord client lifecycle
// ---------------------------------------------------------------
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Register slash command on startup
client.on(Events.ClientReady, async () => {
  try {
    await client.application.commands.set([
      new SlashCommandBuilder()
        .setName('pnodes')
        .setDescription('Show pNodes stats (versions & total)'),
    ]);
    console.log('Slash command registered.');
  } catch (error) {
    console.error('Failed to register slash command:', error);
  }
});

// Handle slash command
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'pnodes') {
    await interaction.deferReply(); // give us time for the RPC calls
    const info = await getPNodesInfo();
    await interaction.editReply(info);
  }
});

client.login(process.env.DISCORD_TOKEN);
