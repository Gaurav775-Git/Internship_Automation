import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline/promises";
import { stdin, stdout } from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.join(__dirname, "server.js");

async function main() {
  console.log("\n🤖 INTERNSHIP AUTOMATION CLIENT\n");
  console.log("═".repeat(50));
  console.log("Type a message and press Enter. Type 'exit' or 'quit' to stop.\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath]
  });

  const client = new Client(
    { name: "llm-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("✅ Connected to MCP server\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  while (true) {
    const userInput = await rl.question("You: ");
    const prompt = userInput.trim();

    if (!prompt) {
      continue;
    }

    if (["exit", "quit", "bye"].includes(prompt.toLowerCase())) {
      console.log("Goodbye!");
      break;
    }

    console.log("AI is thinking...\n");

    try {
      const toolResponse = await client.callTool({
        name: "llm_chat",
        arguments: { message: prompt }
      });

      const text = toolResponse.content?.[0]?.text;
      if (!text) {
        throw new Error("No response from server");
      }

      const result = JSON.parse(text);
      if (result.success) {
        console.log(`AI: ${result.response}\n`);
      } else {
        console.error(`Error: ${result.error}\n`);
      }
    } catch (error) {
      console.error(`Error: ${error.message}\n`);
    }
  }

  rl.close();
  await client.close();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
