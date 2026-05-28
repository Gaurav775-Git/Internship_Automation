import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";

const serverScriptPath = fileURLToPath(new URL("./server.js", import.meta.url));

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverScriptPath],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  const tools = await client.listTools();
  console.log("Available tools:", tools);

  const result = await client.callTool({
    name: "ping",
    arguments: {},
  });
  console.log("Result:", result);

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
