import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline/promises";
import { stdin, stdout } from "process";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.join(__dirname, "server.js");
const ROOT_DIR = path.join(__dirname, "..");

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASSWORD;

async function main() {
  console.log("\n🤖 INTERNSHIP AUTOMATION CLIENT\n");
  console.log("═".repeat(50));
  console.log("Commands:");
  console.log("  /search <keyword>     - Search LinkedIn jobs");
  console.log("  /filter               - Filter jobs against your resume");
  console.log("  /analyze <job #>      - LLM analyze a specific job");
  console.log("  /send <job #> <email> - Send application for a job");
  console.log("  /testemail            - Send a test email to yourself");
  console.log("  /auto                 - FULL AUTOMATION: Read CSV → Analyze → Send all");
  console.log("  /list                 - List current jobs");
  console.log("  /exit                 - Quit\n");

  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    console.log("⚠️  Gmail credentials not found in .env");
    console.log("   /testemail and /send will not work\n");
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

  // Load resume
  try {
    resumeText = await readFile(path.join(ROOT_DIR, "data", "resume.txt"), "utf-8");
    console.log("✅ Resume loaded\n");
  } catch (err) {
    console.log("⚠️ No resume found at data/resume.txt\n");
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

    // ============================================
    // /auto - FULL AUTOMATION CHAIN (FIXED)
    // ============================================
    if (trimmed === "/auto") {
      console.log("\n" + "═".repeat(60));
      console.log("🚀 STARTING FULL AUTOMATION CHAIN");
      console.log("═".repeat(60) + "\n");

      // Step 1: Read CSV
      console.log("📂 STEP 1: Reading internships from CSV...");
      const csvPath = path.join(ROOT_DIR, "data", "internships.csv");
      
      if (!existsSync(csvPath)) {
        console.log("❌ No CSV found at data/internships.csv");
        console.log("\n📝 Create CSV with format:");
        console.log('   Title,Company,Description,Requirements,Email');
        console.log('   "Software Intern","Google","Description","Python","hr@google.com"');
        continue;
      }

      const csvContent = await readFile(csvPath, "utf-8");
      const lines = csvContent.split("\n").filter(line => line.trim());
      
      if (lines.length < 2) {
        console.log("❌ CSV file is empty");
        continue;
      }
      
      // Parse CSV properly (handling quoted fields)
      const internships = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Simple CSV parsing (handles quoted fields)
        const matches = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
        if (matches && matches.length >= 5) {
          internships.push({
            title: matches[0].replace(/"/g, '').trim(),
            company: matches[1].replace(/"/g, '').trim(),
            description: matches[2].replace(/"/g, '').trim(),
            requirements: matches[3].replace(/"/g, '').trim(),
            email: matches[4].replace(/"/g, '').trim()
          });
        }
      }

      console.log(`✅ Loaded ${internships.length} internships from CSV\n`);
      
      // Display loaded internships for verification
      console.log("📋 Loaded internships:");
      internships.forEach((job, i) => {
        console.log(`   ${i+1}. ${job.title} at ${job.company} → Email: ${job.email || "MISSING"}`);
      });
      console.log("");

      if (internships.length === 0) {
        console.log("❌ No internships found in CSV");
        continue;
      }

      // Step 2: Check resume
      if (!resumeText) {
        console.log("❌ No resume found. Create data/resume.txt first");
        continue;
      }

      // Step 3: Check Gmail credentials
      if (!GMAIL_USER || !GMAIL_PASSWORD) {
        console.log("❌ Gmail credentials not set in .env");
        console.log("   Add: GMAIL_USER=your@email.com");
        console.log("   Add: GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx");
        continue;
      }

      // Step 4: Process each internship
      console.log("🎯 STEP 2: Analyzing and sending applications...\n");
      console.log("═".repeat(60));

      let applied = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < internships.length; i++) {
        const job = internships[i];
        console.log(`\n📋 [${i + 1}/${internships.length}] Processing: ${job.title} at ${job.company}`);
        console.log("─".repeat(40));

        // Check if email exists
        if (!job.email) {
          console.log(`   ❌ No email address for this internship - skipping`);
          failed++;
          continue;
        }
        
        console.log(`   📧 Recipient email: ${job.email}`);

        // Analyze with LLM
        console.log("   🤖 LLM analyzing job fit...");
        
        try {
          const analyzeResult = await client.callTool({
            name: "mistral_analyze_job",
            arguments: {
              jobTitle: job.title,
              company: job.company,
              jobDescription: job.description,
              requirements: job.requirements,
              yourResume: resumeText
            }
          });

          const analysis = JSON.parse(analyzeResult.content[0].text);
          
          if (!analysis.success) {
            console.log(`   ❌ Analysis failed: ${analysis.error}`);
            failed++;
            continue;
          }

          console.log(`   📊 Match Score: ${analysis.analysis.match_score}/100`);
          console.log(`   💡 Should apply: ${analysis.analysis.should_apply}`);
          
          if (!analysis.analysis.should_apply) {
            console.log(`   ⏭️ Skipping - LLM determined not a good fit`);
            skipped++;
            continue;
          }

          // Display generated email preview
          const emailPreview = analysis.analysis.email_body.substring(0, 100);
          console.log(`   📝 Email generated: "${emailPreview}..."`);

          // Send email
          console.log(`   📧 Sending to: ${job.email}`);
          
          const sendResult = await client.callTool({
            name: "send_application",
            arguments: {
              to: job.email,
              jobTitle: job.title,
              company: job.company,
              resumePath: path.join(ROOT_DIR, "data", "resume.pdf"),
              gmailUser: GMAIL_USER,
              gmailPassword: GMAIL_PASSWORD
            }
          });

          const sendStatus = JSON.parse(sendResult.content[0].text);
          
          if (sendStatus.success) {
            console.log(`   ✅ Email sent successfully!`);
            applied++;
            
            // Log to CSV
            const logDir = path.join(ROOT_DIR, "logs");
            if (!existsSync(logDir)) await mkdir(logDir, { recursive: true });
            const logPath = path.join(logDir, "applications.csv");
            const logLine = `${new Date().toISOString()},${job.company},${job.title},${analysis.analysis.match_score},Applied,${job.email}\n`;
            
            if (!existsSync(logPath)) {
              await writeFile(logPath, "Timestamp,Company,Job Title,Match Score,Status,Email Sent To\n" + logLine);
            } else {
              await writeFile(logPath, logLine, { flag: "a" });
            }
            
          } else {
            console.log(`   ❌ Failed: ${sendStatus.error}`);
            failed++;
          }

          // Wait between emails to avoid spam
          if (i < internships.length - 1) {
            console.log(`   ⏳ Waiting 45 seconds before next...`);
            await new Promise(resolve => setTimeout(resolve, 45000));
          }
          
        } catch (err) {
          console.log(`   ❌ Error: ${err.message}`);
          failed++;
        }
      }

      // Final summary
      console.log("\n" + "═".repeat(60));
      console.log("📊 AUTOMATION SUMMARY");
      console.log("═".repeat(60));
      console.log(`   ✅ Successfully applied: ${applied}`);
      console.log(`   ⏭️  Skipped (low match): ${skipped}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📋 Total processed: ${internships.length}`);
      console.log("\n📁 Check logs/applications.csv for details");
      continue;
    }

    // ============================================
    // /testemail - Send test email
    // ============================================
    if (trimmed === "/testemail") {
      if (!GMAIL_USER) {
        console.log("❌ GMAIL_USER not set in .env");
        continue;
      }
      
      console.log(`\n📧 Sending test email to ${GMAIL_USER}...\n`);
      
      try {
        const result = await client.callTool({
          name: "send_application",
          arguments: {
            to: GMAIL_USER,
            jobTitle: "Test Email",
            company: "Internship Automation System",
            resumePath: path.join(ROOT_DIR, "data", "resume.pdf"),
            gmailUser: GMAIL_USER,
            gmailPassword: GMAIL_PASSWORD
          }
        });
        
        const data = JSON.parse(result.content[0].text);
        
        if (data.success) {
          console.log(`✅ Test email sent to ${GMAIL_USER}!`);
        } else {
          console.log(`❌ Failed: ${data.error}`);
        }
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // ============================================
    // /search - Search LinkedIn jobs
    // ============================================
    if (trimmed.startsWith("/search")) {
      const keyword = trimmed.replace("/search", "").trim() || "software";
      console.log(`🔍 Searching for "${keyword}" internship...\n`);
      
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
            console.log(`   ${i + 1}. ${job.title} at ${job.company}`);
          });
        }
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      continue;
    }

    // ============================================
    // /list - List current jobs
    // ============================================
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

    // ============================================
    // /filter - Filter jobs against resume
    // ============================================
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

    // ============================================
    // /analyze - LLM analyze specific job
    // ============================================
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

    // ============================================
    // /send - Send application for a job
    // ============================================
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
            resumePath: path.join(ROOT_DIR, "data", "resume.pdf"),
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

    // Default: Unknown command
    console.log(`Unknown command: ${trimmed}`);
    console.log("Available commands: /search, /filter, /analyze, /send, /testemail, /auto, /list, /exit");
  }

  rl.close();
  await client.close();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});