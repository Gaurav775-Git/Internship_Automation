export const colors = {
  success: (text) => `\x1b[32m${text}\x1b[0m`,
  error: (text) => `\x1b[31m${text}\x1b[0m`,
  warning: (text) => `\x1b[33m${text}\x1b[0m`,
  info: (text) => `\x1b[36m${text}\x1b[0m`,
  highlight: (text) => `\x1b[35m${text}\x1b[0m`,
  primary: (text) => `\x1b[34m${text}\x1b[0m`,
  dim: (text) => `\x1b[90m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  underline: (text) => `\x1b[4m${text}\x1b[0m`,
  gradient: (text) => text // Will be enhanced with gradient-string
};
