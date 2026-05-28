import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline/promises";
import { stdin, stdout } from "process";
import { readFile } from "fs/promises";
import dotenv from "dotenv";

// Load .env from parent directory
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.join(__dirname, "server.js");

// System prompt that tells AI about available tools
const SYSTEM_PROMPT = `You are an internship automation assistant with access to these tools:

1. send_application(to, jobTitle, company, resumePath, gmailUser, gmailPassword) - SENDS REAL EMAILS
2. mistral_analyze_job(jobTitle, company, jobDescription, yourResume) - Analyzes job fit
3. search_linkedin(keyword, location) - Searches for jobs
4. filter_jobs(jobs, resumeText) - Filters jobs by skills
5. log_application(jobTitle, company, matchScore) - Logs to CSV
6. llm_chat(message) - Regular chat

IMPORTANT: When a user asks you to SEND or DRAFT an email TO THEIR ACCOUNT, you MUST use the send_application tool.`;

async function main() {
  console.log("\n🤖 INTERNSHIP AUTOMATION CLIENT\n");
  console.log("═".repeat(50));
  console.log("Commands:");
  console.log("  /search <keyword>     - Search LinkedIn jobs");
  console.log("  /filter               - Filter jobs against your resume");
  console.log("  /analyze <job #>      - LLM analyze a specific job");
  console.log("  /send <job #> <email> - Send application for a job");
  console.log("  /testemail            - Send a test email to yourself");
  console.log("  /list                 - List current jobs");
  console.log("  /chat <message>       - Chat with LLM");
  console.log("  /exit                 - Quit\n");

  // Check for Gmail credentials
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASSWORD;
  
  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    console.log("⚠️  Gmail credentials not found in .env");
    console.log("   Create .env file with:");
    console.log("   GMAIL_USER=your-email@gmail.com");
    console.log("   GMAIL_APP_PASSWORD=your-app-password\n");
  } else {
    console.log("✅ Gmail credentials loaded\n");
  }

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

  let currentJobs = [];
  let resumeText = "";

  try {
    resumeText = await readFile(path.join(__dirname, "..", "data", "resume.txt"), "utf-8");
    console.log("✅ Resume loaded\n");
  } catch (err) {
    console.log("⚠️ No resume found at data/resume.txt - create one for filtering\n");
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  while (true) {
    const userInput = await rl.question("\n> ");
    const trimmed = userInput.trim();

    if (!trimmed) continue;
    if (trimmed === "/exit") {
      console.log("Goodbye!");
      break;
    }

    // Handle /testemail command - Send test email to yourself
    if (trimmed === "/testemail") {
      const yourEmail = GMAIL_USER;
      if (!yourEmail) {
        console.log("❌ GMAIL_USER not set in .env");
        console.log("   Create .env file with: GMAIL_USER=your-email@gmail.com");
        continue;
      }
      
      console.log(`\n📧 Sending test email to ${yourEmail}...\n`);
      
      try {
        const result = await client.callTool({
          name: "send_application",
          arguments: {
            to: yourEmail,
            jobTitle: "Test Email from Internship Bot",
            company: "Automation System",
            resumePath: path.join(__dirname, "..", "data", "resume.pdf"),
            gmailUser: GMAIL_USER,
            gmailPassword: GMAIL_PASSWORD
          }
        });
        
        const data = JSON.parse(result.content[0].text);
        
        if (data.success) {
          console.log(`✅ Test email sent to ${yourEmail}!`);
          console.log(`   Check your inbox (or spam folder)`);
        } else {
          console.log(`❌ Failed: ${data.error}`);
        }
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // Handle /search command
    if (trimmed.startsWith("/search")) {
      const keyword = trimmed.replace("/search", "").trim() || "software";
      console.log(`🔍 Searching for "${keyword}" internships...\n`);
      
      try {
        const result = await client.callTool({
          name: "search_linkedin",
          arguments: { keyword, limit: 20 }
        });
        
        const data = JSON.parse(result.content[0].text);
        
        if (data.error) {
          console.log(`❌ ${data.error}`);
        } else {
          currentJobs = data.jobs || [];
          console.log(`✅ Found ${currentJobs.length} jobs:\n`);
          currentJobs.forEach((job, i) => {
            console.log(`   ${i + 1}. ${job.title} at ${job.company} (${job.location || "Location N/A"})`);
          });
        }
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // Handle /list command
    if (trimmed === "/list") {
      if (currentJobs.length === 0) {
        console.log("No jobs loaded. Use /search first.");
      } else {
        console.log(`\n📋 Current jobs (${currentJobs.length}):\n`);
        currentJobs.forEach((job, i) => {
          console.log(`   ${i + 1}. ${job.title} at ${job.company}`);
        });
      }
      continue;
    }

    // Handle /filter command
    if (trimmed === "/filter") {
      if (currentJobs.length === 0) {
        console.log("No jobs loaded. Use /search first.");
        continue;
      }
      
      if (!resumeText) {
        console.log("⚠️ No resume found. Create data/resume.txt");
        continue;
      }
      
      console.log("🎯 Filtering jobs against your resume...\n");
      
      try {
        const result = await client.callTool({
          name: "filter_jobs",
          arguments: {
            jobs: JSON.stringify(currentJobs),
            resumeText: resumeText,
            minScore: 3
          }
        });
        
        const data = JSON.parse(result.content[0].text);
        currentJobs = data.jobs || [];
        
        console.log(`✅ ${data.matches} matching jobs (score >= 3):\n`);
        currentJobs.forEach((job, i) => {
          console.log(`   ${i + 1}. ${job.title} at ${job.company} (Score: ${job.matchScore})`);
        });
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // Handle /analyze command
    if (trimmed.startsWith("/analyze")) {
      const parts = trimmed.split(" ");
      const jobNum = parseInt(parts[1]);
      
      if (isNaN(jobNum) || jobNum < 1 || jobNum > currentJobs.length) {
        console.log(`Invalid job number. Use /list to see jobs (1-${currentJobs.length})`);
        continue;
      }
      
      if (!resumeText) {
        console.log("⚠️ No resume found. Create data/resume.txt");
        continue;
      }
      
      const job = currentJobs[jobNum - 1];
      console.log(`\n🤖 Analyzing: ${job.title} at ${job.company}\n`);
      
      try {
        const result = await client.callTool({
          name: "mistral_analyze_job",
          arguments: {
            jobTitle: job.title,
            company: job.company,
            jobDescription: job.description || "",
            requirements: "",
            yourResume: resumeText
          }
        });
        
        const data = JSON.parse(result.content[0].text);
        
        if (data.success) {
          console.log(`📊 Match Score: ${data.analysis.match_score}/100`);
          console.log(`✅ Should apply: ${data.analysis.should_apply}`);
          console.log(`\n💡 Reasons to apply:`);
          data.analysis.reasons_to_apply.forEach(reason => {
            console.log(`   - ${reason}`);
          });
          console.log(`\n📝 Generated Email:\n`);
          console.log(data.analysis.email_body);
        } else {
          console.log(`❌ Analysis failed: ${data.error}`);
        }
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // Handle /send command
    if (trimmed.startsWith("/send")) {
      const parts = trimmed.split(" ");
      const jobNum = parseInt(parts[1]);
      const customEmail = parts[2];
      
      if (isNaN(jobNum) || jobNum < 1 || jobNum > currentJobs.length) {
        console.log(`Invalid job number. Use /list to see jobs (1-${currentJobs.length})`);
        continue;
      }
      
      if (!GMAIL_USER || !GMAIL_PASSWORD) {
        console.log("❌ Gmail credentials not set in .env");
        continue;
      }
      
      const job = currentJobs[jobNum - 1];
      const recipientEmail = customEmail || `careers@${job.company.toLowerCase().replace(/\s/g, '')}.com`;
      
      console.log(`\n📧 Sending application for ${job.title} at ${job.company}`);
      console.log(`   To: ${recipientEmail}\n`);
      
      try {
        const result = await client.callTool({
          name: "send_application",
          arguments: {
            to: recipientEmail,
            jobTitle: job.title,
            company: job.company,
            resumePath: path.join(__dirname, "..", "data", "resume.pdf"),
            gmailUser: GMAIL_USER,
            gmailPassword: GMAIL_PASSWORD
          }
        });
        
        const data = JSON.parse(result.content[0].text);
        
        if (data.success) {
          console.log(`✅ Email sent successfully!`);
        } else {
          console.log(`❌ Failed: ${data.error}`);
        }
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // Handle /chat command
    if (trimmed.startsWith("/chat")) {
      const message = trimmed.replace("/chat", "").trim();
      if (!message) {
        console.log("Usage: /chat <your message>");
        continue;
      }
      
      console.log("🤔 AI is thinking...\n");
      
      try {
        const result = await client.callTool({
          name: "llm_chat",
          arguments: { message }
        });
        
        const data = JSON.parse(result.content[0].text);
        
        if (data.success) {
          console.log(`🤖 AI: ${data.response}\n`);
        } else {
          console.log(`❌ Error: ${data.error}`);
        }
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // If no command, treat as chat
    console.log("🤔 AI is thinking...\n");
    
    try {
      const result = await client.callTool({
        name: "llm_chat",
        arguments: { message: trimmed }
      });
      
      const data = JSON.parse(result.content[0].text);
      
      if (data.success) {
        console.log(`🤖 AI: ${data.response}\n`);
      } else {
        console.log(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  }

  rl.close();
  await client.close();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});