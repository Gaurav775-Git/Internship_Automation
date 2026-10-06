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

```

### Gmail App Password Setup

1. Enable 2-Factor Authentication on your Google account
2. Go to **Google Account → Security → App passwords**
3. Generate a new app password for "Mail"
4. Copy the 16-character password to `.env`

## Data Preparation

Place a recipient file in `data/recipients.csv`, `.xlsx`, or `.xls`. The program automatically finds email addresses in a column named `Email` or by scanning the file:

```csv
Name,Email
Recruiter One,hr@example.com
Recruiter Two,careers@example.com
```

Place your resume at `data/resume.pdf` (or specify custom path in `.env`).

## Quick Start

```bash
node src/client.js
```

## Verify Setup

```
/testemail    # Should send a test email to yourself
```