# Setup Guide

*One-time configuration • ~5 minutes*

## Prerequisites

| Requirement | Minimum Version |
|-------------|-----------------|
| Node.js | v18+ |
| npm | v9+ |
| Gmail | With App Password enabled |

## Installation

```bash
git clone https://github.com/gaurav775-git/internship-automation.git
cd internship-automation
npm install
```

## Environment Configuration

Create `.env` in the project root:

```env
# Gmail SMTP (required for sending emails)
GMAIL_USER=your.email@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

# Optional: Resume file path
RESUME_PATH=data/resume.pdf

# Optional: OpenRouter API (for LLM analysis)
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
```

### Gmail App Password Setup

1. Enable 2-Factor Authentication on your Google account
2. Go to **Google Account → Security → App passwords**
3. Generate a new app password for "Mail"
4. Copy the 16-character password to `.env`

## Data Preparation

Place your internship data in `data/internships.csv`:

```csv
Title,Company,Description,Requirements,Email
"Software Engineering Intern","TechCorp","Backend Python role","Python, SQL","hr@techcorp.com"
```

Place your resume at `data/resume.pdf` (or specify custom path in `.env`).

## Quick Start

```bash
node src/client.js
```

## Verify Setup

```
/testemail    # Should send a test email
/search intern # Should find jobs from linkedin_jobs.csv
```