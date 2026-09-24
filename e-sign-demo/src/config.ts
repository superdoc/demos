export const config = {
  port: Number.parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  apiKey: process.env.API_KEY || '',
  maxFileSize: Number.parseInt(process.env.MAX_FILE_SIZE || String(24 * 1024 * 1024), 10),
  requestTimeout: Number.parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
  gotenbergUrl: process.env.GOTENBERG_URL || 'http://localhost:3001',
  privateKey: process.env.ESIGN_PRIVATE_KEY?.replaceAll('\\n', '\n'),
  publicKey: process.env.ESIGN_PUBLIC_KEY?.replaceAll('\\n', '\n'),
};
