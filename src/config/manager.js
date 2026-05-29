import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

const DEFAULT_CONFIG = {
  gmailUser: '',
  resumePath: 'data/resume.txt',
  csvPath: 'data/internships.csv',
  minMatchScore: 50,
  delaySeconds: 45,
  maxEmailsPerDay: 100,
  theme: 'default'
};

export async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function updateConfig(updates) {
  const config = await loadConfig();
  const newConfig = { ...config, ...updates };
  await saveConfig(newConfig);
  return newConfig;
}
