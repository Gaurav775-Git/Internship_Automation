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
const CSV_HEADERS = ["Title", "Company", "Description", "Requirements", "Email"];

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

function normalizeCsvCell(value) {
  return String(value ?? "").replace(/\r/g, "").replace(/^"|"$/g, "").trim();
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function splitCsvRows(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const text = csvText.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((entry) => String(entry).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((entry) => String(entry).trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function isHeaderRow(row) {
  const normalized = row.map((cell) => normalizeCsvCell(cell).toLowerCase());
  return CSV_HEADERS.some((header) => normalized.includes(header.toLowerCase()));
}

function parseJsonFromText(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Could not extract JSON from AI response");
  }
  return JSON.parse(match[0]);
}

async function callOpenRouter(prompt, { temperature = 0.2, max_tokens = 900 } = {}) {
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
      temperature,
      max_tokens
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`OpenRouter API error (${response.status}): ${errorData.error?.message || "Unknown error"}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Invalid response structure from OpenRouter API");
  }

  return content.trim();
}

async function cleanCsvRowWithAi({ headers, row, rowNumber }) {
  const prompt = `You are cleaning an internship CSV row.

Source headers:
${JSON.stringify(headers)}

Row number:
${rowNumber}

Parsed cells from the source row:
${JSON.stringify(row)}

Normalize this row into EXACTLY these fields:
${JSON.stringify(CSV_HEADERS)}

Rules:
- Keep only information that is supported by the source row.
- Fix obvious formatting issues, broken quotes, and extra whitespace.
- If a field is missing or unclear, use "Unknown" for Title, Company, Description, Requirements and use an empty string for Email unless an email is clearly present.
- Do not invent emails or companies.
- If the row is unusable, still return a best-effort record and mark it with "row_status": "needs_review".
- Return valid JSON only. No markdown, no code fences.

Output schema:
{
  "Title": "",
  "Company": "",
  "Description": "",
  "Requirements": "",
  "Email": "",
  "row_status": "cleaned",
  "notes": ["optional note"]
}`;

  const responseText = await callOpenRouter(prompt, { temperature: 0.1, max_tokens: 700 });
  const cleaned = parseJsonFromText(responseText);

  return {
    Title: normalizeCsvCell(cleaned.Title || cleaned.title || "Unknown") || "Unknown",
    Company: normalizeCsvCell(cleaned.Company || cleaned.company || "Unknown") || "Unknown",
    Description: normalizeCsvCell(cleaned.Description || cleaned.description || "Unknown") || "Unknown",
    Requirements: normalizeCsvCell(cleaned.Requirements || cleaned.requirements || "Unknown") || "Unknown",
    Email: normalizeCsvCell(cleaned.Email || cleaned.email || ""),
    row_status: normalizeCsvCell(cleaned.row_status || "cleaned") || "cleaned",
    notes: Array.isArray(cleaned.notes) ? cleaned.notes.map((note) => normalizeCsvCell(note)).filter(Boolean) : []
  };
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
        <a href="https://www.linkedin.com/in/gaurav775/">LinkedIn</a> | 
        <a href="https://github.com/gaurav775-git">GitHub</a> | 
        <a href="https://gaurav-rpm.vercel.app/">Portfolio</a></p>
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

// Tool 7: AI clean and normalize CSV data
async function filterData(args) {
  const {
    csvPath: csvPathArg,
    outputPath: outputPathArg,
    overwrite = false
  } = args;

  const csvPath = csvPathArg
    ? (path.isAbsolute(csvPathArg) ? csvPathArg : path.join(ROOT_DIR, csvPathArg))
    : path.join(ROOT_DIR, "data", "internships.csv");

  try {
    if (!existsSync(csvPath)) {
      throw new Error(`CSV file not found at ${csvPath}`);
    }

    const csvContent = await readFile(csvPath, "utf-8");
    const rows = splitCsvRows(csvContent);

    if (rows.length === 0) {
      throw new Error("CSV file is empty");
    }

    const hasHeader = isHeaderRow(rows[0]);
    const sourceHeaders = hasHeader ? rows[0].map((header) => normalizeCsvCell(header)) : [...CSV_HEADERS];
    const dataRows = hasHeader ? rows.slice(1) : rows;

    if (dataRows.length === 0) {
      throw new Error("No data rows found in the CSV file");
    }

    const cleanedRows = [];
    const warnings = [];

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = hasHeader ? i + 2 : i + 1;
      const row = dataRows[i].map((cell) => normalizeCsvCell(cell));

      let cleanedRow;
      try {
        cleanedRow = await cleanCsvRowWithAi({
          headers: sourceHeaders,
          row,
          rowNumber
        });
      } catch (rowError) {
        const fallback = {
          Title: row[0] || "Unknown",
          Company: row[1] || "Unknown",
          Description: row[2] || "Unknown",
          Requirements: row[3] || "Unknown",
          Email: row[4] || "",
          row_status: "needs_review",
          notes: [`AI cleanup failed: ${rowError.message}`]
        };
        cleanedRow = fallback;
        warnings.push(`Row ${rowNumber}: ${rowError.message}`);
      }

      cleanedRows.push(cleanedRow);
    }

    const finalRows = [CSV_HEADERS.join(",")];
    for (const row of cleanedRows) {
      finalRows.push(CSV_HEADERS.map((header) => escapeCsvCell(row[header] ?? "")).join(","));
    }

    const resolvedOutputPath = overwrite
      ? csvPath
      : (outputPathArg
          ? (path.isAbsolute(outputPathArg) ? outputPathArg : path.join(ROOT_DIR, outputPathArg))
          : path.join(path.dirname(csvPath), `${path.basename(csvPath, path.extname(csvPath))}.cleaned${path.extname(csvPath) || ".csv"}`));

    const outputDir = path.dirname(resolvedOutputPath);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    await writeFile(resolvedOutputPath, finalRows.join("\n") + "\n");

    const needsReview = cleanedRows.filter((row) => row.row_status === "needs_review").length;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          inputPath: csvPath,
          outputPath: resolvedOutputPath,
          rowsRead: dataRows.length,
          rowsWritten: cleanedRows.length,
          rowsNeedingReview: needsReview,
          warnings
        })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: false,
          error: error.message
        })
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
      },
      {
        name: "filter_data",
        description: "AI clean and normalize a CSV file with missing or malformed internship data",
        inputSchema: {
          type: "object",
          properties: {
            csvPath: { type: "string", description: "Path to the source CSV file" },
            outputPath: { type: "string", description: "Path for the cleaned CSV output" },
            overwrite: { type: "boolean", description: "Overwrite the source CSV instead of creating a new file", default: false }
          },
          required: ["csvPath"]
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
    case "filter_data":
      return await filterData(args);
    default:
      throw new Error(`Tool not found: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Internship Automation MCP Server running");
  console.error("📧 Tools: search_linkedin, filter_jobs, send_application, log_application, mistral_analyze_job, llm_chat, filter_data");
}

main().catch(console.error);
