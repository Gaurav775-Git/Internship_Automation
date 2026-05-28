import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import nodemailer from "nodemailer";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");

async function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!existsSync(envPath)) return;

  const contents = await readFile(envPath, "utf-8");
  contents.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...rest] = trimmed.split("=");
    if (!key) return;
    const value = rest.join("=").trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

await loadEnvFile();

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const DEFAULT_GMAIL_USER = process.env.GMAIL_USER || "";
const DEFAULT_GMAIL_PASSWORD = process.env.GMAIL_PASSWORD || "";
const DEFAULT_RESUME_PATH = process.env.RESUME_PATH
  ? path.isAbsolute(process.env.RESUME_PATH)
    ? process.env.RESUME_PATH
    : path.join(ROOT_DIR, process.env.RESUME_PATH)
  : path.join(ROOT_DIR, "data", "resume.txt");
const DEFAULT_OPENROUTER_HEADERS = {
  "Content-Type": "application/json",
  ...(OPENROUTER_API_KEY ? { Authorization: `Bearer ${OPENROUTER_API_KEY}` } : {})
};

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

// Tool 1: Search LinkedIn Jobs (from CSV)
async function searchLinkedInJobs(args) {
  const { keyword, location, limit = 20 } = args;
  
  try {
    const csvPath = path.join(ROOT_DIR, "data", "linkedin_jobs.csv");
    
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
    
    const skills = extractSkills(resumeText);
    
    const scoredJobs = jobList.map(job => {
      let score = 0;
      const jobText = `${job.title || ""} ${job.description || ""}`.toLowerCase();
      
      skills.forEach(skill => {
        if (jobText.includes(skill.toLowerCase())) score += 2;
      });
      
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

// Tool 3: Send email with resume (FIXED - removed malformed object)
async function sendApplication(args) {
  const {
    to,
    jobTitle,
    company,
    resumePath: resumePathArg,
    gmailUser: gmailUserArg,
    gmailPassword: gmailPasswordArg,
  } = args;

  const gmailUser = gmailUserArg || DEFAULT_GMAIL_USER;
  const gmailPassword = gmailPasswordArg || DEFAULT_GMAIL_PASSWORD;
  const resumePath = resumePathArg || DEFAULT_RESUME_PATH;

  try {
    if (!gmailUser || !gmailPassword) {
      throw new Error("Gmail credentials are required. Set GMAIL_USER and GMAIL_PASSWORD in .env or pass them as arguments.");
    }

    if (!resumePath) {
      throw new Error("Resume path is required. Set RESUME_PATH in .env or pass resumePath as an argument.");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPassword }
    });
    
    if (!existsSync(resumePath)) {
      throw new Error(`Resume not found at ${resumePath}`);
    }
    
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
    
    const logDir = path.join(ROOT_DIR, "logs");
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

// Tool 4: Save to CSV
async function logApplication(args) {
  const { jobTitle, company, matchScore, status = "Applied" } = args;
  
  try {
    const logDir = path.join(ROOT_DIR, "logs");
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

// Tool 5: Analyze job fit using OpenRouter
async function mistralAnalyzeJob(args) {
  const { jobTitle, company, jobDescription, requirements, yourResume } = args;
  
  try {
    const prompt = `Analyze the fit between a job opportunity and a candidate's resume.

Job Title: ${jobTitle}
Company: ${company}
Job Description: ${jobDescription}
Required Skills/Qualifications: ${requirements}

Candidate's Resume:
${yourResume}

Provide a JSON response with these exact fields:
{
  "match_score": <number 0-100>,
  "reasons_to_apply": [<array of 3-5 specific reasons>],
  "should_apply": <boolean>,
  "email_body": "<draft email body for this specific opportunity>"
}

Be realistic and specific to this job. Consider actual skill matches, experience level, and company fit.`;

    const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        ...DEFAULT_OPENROUTER_HEADERS,
        "HTTP-Referer": "http://localhost",
        "X-Title": "internship-automation"
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenRouter API error (${response.status}): ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error("Invalid response structure from OpenRouter API");
    }

    const responseText = data.choices[0].message.content;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not extract JSON from API response");
    }

    const analysisResult = JSON.parse(jsonMatch[0]);

    if (
      typeof analysisResult.match_score !== "number" ||
      !Array.isArray(analysisResult.reasons_to_apply) ||
      typeof analysisResult.should_apply !== "boolean" ||
      typeof analysisResult.email_body !== "string"
    ) {
      throw new Error("API response missing required fields");
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          analysis: analysisResult,
          job: { jobTitle, company }
        })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: false,
          error: error.message,
          fallback: {
            match_score: 50,
            reasons_to_apply: ["Could not reach analysis service", "Please retry with proper internet connection"],
            should_apply: false,
            email_body: "Error: Could not generate email body"
          }
        })
      }]
    };
  }
}

// Tool 6: Generic LLM chat using OpenRouter
async function llmChat(args) {
  const { message } = args;
  if (!message) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: false, error: "Missing message parameter" })
      }]
    };
  }

  try {
    const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        ...DEFAULT_OPENROUTER_HEADERS,
        "HTTP-Referer": "http://localhost",
        "X-Title": "internship-automation"
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: message }],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenRouter API error (${response.status}): ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Invalid response structure from OpenRouter API");
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, response: content.trim() })
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
          required: ["to", "jobTitle", "company"]
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
      },
      {
        name: "mistral_analyze_job",
        description: "Analyze job fit using OpenRouter's free Mistral API - provides match score and email draft",
        inputSchema: {
          type: "object",
          properties: {
            jobTitle: { type: "string" },
            company: { type: "string" },
            jobDescription: { type: "string" },
            requirements: { type: "string" },
            yourResume: { type: "string" }
          },
          required: ["jobTitle", "company", "jobDescription", "yourResume"]
        }
      },
      {
        name: "llm_chat",
        description: "Chat with the OpenRouter LLM through the server",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Prompt text for the LLM" }
          },
          required: ["message"]
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
    case "mistral_analyze_job":
      return await mistralAnalyzeJob(args);
    case "llm_chat":
      return await llmChat(args);
    default:
      throw new Error(`Tool not found: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Internship Automation MCP Server running");
  console.error("📧 Tools: search_linkedin, filter_jobs, send_application, log_application, mistral_analyze_job, llm_chat");
}

main().catch(console.error);