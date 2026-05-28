import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createTransport } from "nodemailer";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// Create MCP server instance
const server = new Server(
  {
    name: "internship-automation-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================
// TOOL HANDLERS
// ============================================

// Tool 1: Search LinkedIn Jobs (from CSV)
async function searchLinkedInJobs(args) {
  const { keyword, location, limit = 20 } = args;
  
  try {
    const csvPath = path.join(process.cwd(), "data", "linkedin_jobs.csv");
    
    if (!existsSync(csvPath)) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ 
            error: "No LinkedIn data found. Please export jobs to data/linkedin_jobs.csv",
            jobs: [] 
          })
        }]
      };
    }
    
    const csvContent = await readFile(csvPath, "utf-8");
    const lines = csvContent.split("\n").slice(1); // Skip header
    
    const jobs = lines
      .filter(line => line.trim())
      .map(line => {
        const [title, company, location_text, url, postedDate, description] = line.split(",");
        return { title, company, location: location_text, url, postedDate, description };
      })
      .filter(job => {
        const titleMatch = job.title?.toLowerCase().includes(keyword?.toLowerCase() || "");
        const locMatch = !location || job.location?.toLowerCase().includes(location.toLowerCase());
        return titleMatch && locMatch;
      })
      .slice(0, limit);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ count: jobs.length, jobs })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: error.message })
      }]
    };
  }
}

// Tool 2: Filter jobs against your resume
async function filterJobs(args) {
  const { jobs, resumeText, minScore = 3 } = args;
  
  try {
    const jobList = typeof jobs === "string" ? JSON.parse(jobs) : jobs;
    
    // Extract skills from resume (simple keyword extraction)
    const skills = extractSkills(resumeText);
    
    const scoredJobs = jobList.map(job => {
      let score = 0;
      const jobText = `${job.title || ""} ${job.description || ""}`.toLowerCase();
      
      // Score based on skills match
      skills.forEach(skill => {
        if (jobText.includes(skill.toLowerCase())) score += 2;
      });
      
      // Bonus for internship/junior keywords
      if (job.title?.toLowerCase().includes("intern")) score += 3;
      if (job.title?.toLowerCase().includes("junior")) score += 2;
      if (job.title?.toLowerCase().includes("entry")) score += 2;
      
      return { ...job, matchScore: score };
    });
    
    const goodMatches = scoredJobs.filter(job => job.matchScore >= minScore);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ 
          total: jobList.length, 
          matches: goodMatches.length,
          jobs: goodMatches 
        })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: error.message })
      }]
    };
  }
}

// Tool 3: Send email with resume
async function sendApplication(args) {
  const { to, jobTitle, company, resumePath, gmailUser, gmailPassword } = args;
  
  try {
    // Setup Gmail transporter
    const transporter = createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPassword }
    });
    
    // Check if resume exists
    if (!existsSync(resumePath)) {
      throw new Error(`Resume not found at ${resumePath}`);
    }
    
    // Email template
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>Application for ${jobTitle}</h2>
        <p>Dear Hiring Team,</p>
        <p>I am writing to express my strong interest in the <strong>${jobTitle}</strong> position at <strong>${company}</strong>.</p>
        <p>My skills and enthusiasm for learning align perfectly with what you're looking for in an intern. I'm confident I can contribute to your team from day one.</p>
        <p>My resume is attached for your review. I would welcome the opportunity to discuss how I can add value to your organization.</p>
        <p>Best regards,<br>
        <strong>[Your Name]</strong><br>
        <a href="https://linkedin.com/in/yourprofile">LinkedIn</a> | 
        <a href="https://github.com/yourusername">GitHub</a> | 
        <a href="https://yourportfolio.com">Portfolio</a></p>
      </div>
    `;
    
    const info = await transporter.sendMail({
      from: gmailUser,
      to: to,
      subject: `Application for ${jobTitle} at ${company}`,
      html: emailHtml,
      attachments: [{ filename: "resume.pdf", path: resumePath }]
    });
    
    // Log sent email
    const logDir = path.join(process.cwd(), "logs");
    if (!existsSync(logDir)) await mkdir(logDir, { recursive: true });
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      to, jobTitle, company,
      messageId: info.messageId
    };
    
    const logPath = path.join(logDir, "sent-emails.json");
    let logs = [];
    if (existsSync(logPath)) {
      const existing = await readFile(logPath, "utf-8");
      logs = JSON.parse(existing);
    }
    logs.push(logEntry);
    await writeFile(logPath, JSON.stringify(logs, null, 2));
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ 
          success: true, 
          messageId: info.messageId,
          to: to,
          subject: `Application for ${jobTitle}`
        })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: false, error: error.message })
      }]
    };
  }
}

// Tool 4: Save to Google Sheets (simplified - saves to CSV for now)
async function logApplication(args) {
  const { jobTitle, company, matchScore, status = "Applied" } = args;
  
  try {
    const logDir = path.join(process.cwd(), "logs");
    if (!existsSync(logDir)) await mkdir(logDir, { recursive: true });
    
    const csvPath = path.join(logDir, "applications.csv");
    const csvLine = `${new Date().toISOString()},${company},${jobTitle},${matchScore},${status}\n`;
    
    if (!existsSync(csvPath)) {
      await writeFile(csvPath, "Timestamp,Company,Job Title,Match Score,Status\n" + csvLine);
    } else {
      await writeFile(csvPath, csvLine, { flag: "a" });
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, message: `Logged: ${jobTitle} at ${company}` })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: false, error: error.message })
      }]
    };
  }
}

// Helper: Extract skills from resume text
function extractSkills(text) {
  const commonSkills = [
    "python", "javascript", "react", "node.js", "java", "sql",
    "aws", "docker", "git", "typescript", "html", "css",
    "mongodb", "express", "django", "flask", "postgresql"
  ];
  
  return commonSkills.filter(skill => 
    text.toLowerCase().includes(skill.toLowerCase())
  );
}

// ============================================
// MCP HANDLERS
// ============================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_linkedin",
        description: "Search for internship jobs from LinkedIn CSV export",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "Job keyword (e.g., 'software')" },
            location: { type: "string", description: "Location filter" },
            limit: { type: "number", description: "Max results to return", default: 20 }
          },
          required: ["keyword"]
        }
      },
      {
        name: "filter_jobs",
        description: "Filter jobs against your resume skills",
        inputSchema: {
          type: "object",
          properties: {
            jobs: { type: "string", description: "JSON string of jobs from search_linkedin" },
            resumeText: { type: "string", description: "Your resume text" },
            minScore: { type: "number", description: "Minimum score to keep (default: 3)" }
          },
          required: ["jobs", "resumeText"]
        }
      },
      {
        name: "send_application",
        description: "Send application email with resume attached",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            jobTitle: { type: "string" },
            company: { type: "string" },
            resumePath: { type: "string", description: "Path to your resume PDF" },
            gmailUser: { type: "string" },
            gmailPassword: { type: "string" }
          },
          required: ["to", "jobTitle", "company", "resumePath", "gmailUser", "gmailPassword"]
        }
      },
      {
        name: "log_application",
        description: "Log application to CSV file",
        inputSchema: {
          type: "object",
          properties: {
            jobTitle: { type: "string" },
            company: { type: "string" },
            matchScore: { type: "number" },
            status: { type: "string", default: "Applied" }
          },
          required: ["jobTitle", "company", "matchScore"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case "search_linkedin":
      return await searchLinkedInJobs(args);
    case "filter_jobs":
      return await filterJobs(args);
    case "send_application":
      return await sendApplication(args);
    case "log_application":
      return await logApplication(args);
    default:
      throw new Error(`Tool not found: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Internship Automation MCP Server running");
  console.error("📧 Tools: search_linkedin, filter_jobs, send_application, log_application");
}

main().catch(console.error);