const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const { HttpsProxyAgent } = require('https-proxy-agent');
const moment = require('moment');
const cfonts = require('cfonts');
const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const { combine, timestamp, label, printf, colorize } = format;

// Load configuration
let config;
try {
  config = require('./config.json');
} catch (error) {
  console.error('Error loading config.json:', error.message);
  process.exit(1);
}

// Setup logger
const customFormat = printf(({ level, message, timestamp }) => {
  const date = moment(timestamp).format('DD/MM/YYYY - HH:mm:ss');
  return `[${date}] ${level}: ${message}`;
});

const logger = createLogger({
  level: config.logLevel || 'info',
  format: combine(
    timestamp(),
    customFormat
  ),
  transports: [
    new transports.Console({
      format: combine(
        colorize(),
        customFormat
      )
    }),
    new transports.DailyRotateFile({
      filename: path.join(config.logDirectory || 'logs', 'cess-network-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: config.logRetention || '7d',
      format: customFormat
    })
  ]
});

// Ensure log directory exists
fs.ensureDirSync(config.logDirectory || 'logs');

// Display header
function displayHeader() {
  cfonts.say('Cess Network', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'green'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: 0,
    gradient: ['cyan', 'green'],
    independentGradient: true,
    transitionGradient: true
  });
  logger.info('===== Cess Network Bot Started =====');
  logger.info(`Next run delay: ${config.nextRunDelayHours} hours`);
  logger.info(`Using proxies: ${config.useProxy ? 'Yes' : 'No'}`);
  logger.info(`Max retries: ${config.maxRetries}`);
}

// Load tokens
async function loadTokens() {
  try {
    if (!await fs.pathExists('./data.txt')) {
      logger.error('data.txt file not found. Please create it with your tokens');
      process.exit(1);
    }
    
    const data = await fs.readFile('./data.txt', 'utf8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    logger.error(`Error loading tokens: ${error.message}`);
    process.exit(1);
  }
}

// Load proxies
async function loadProxies() {
  if (!config.useProxy) return [];
  
  try {
    if (!await fs.pathExists('./proxy.txt')) {
      logger.warn('proxy.txt file not found but useProxy is true. Will proceed without proxies');
      return [];
    }
    
    const data = await fs.readFile('./proxy.txt', 'utf8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    logger.error(`Error loading proxies: ${error.message}`);
    return [];
  }
}

// Create axios instance with retry
function createAxiosInstance(token, proxy = null) {
  const instance = axios.create({
    baseURL: config.requestConfig.baseUrl,
    timeout: config.timeoutMs,
    headers: {
      ...config.requestConfig.headers,
      token
    }
  });
  
  if (proxy) {
    instance.defaults.httpsAgent = new HttpsProxyAgent(proxy);
    logger.debug(`Using proxy: ${proxy}`);
  }
  
  // Configure retry mechanism
  axiosRetry(instance, {
    retries: config.maxRetries,
    retryDelay: (retryCount) => {
      const delay = Math.pow(2, retryCount) * config.retryDelay;
      logger.debug(`Retry attempt ${retryCount}, delaying by ${delay}ms`);
      return delay;
    },
    retryCondition: (error) => {
      // Retry on network errors, 429, 500, 502, 503, 504 status codes
      return axiosRetry.isNetworkError(error) || 
             axiosRetry.isRetryableError(error) ||
             (error.response && [429, 500, 502, 503, 504].includes(error.response.status));
    },
    onRetry: (retryCount, error, requestConfig) => {
      const status = error.response ? error.response.status : 'network error';
      logger.warn(`Retry ${retryCount}/${config.maxRetries} for ${requestConfig.url} - ${status}: ${error.message}`);
    }
  });
  
  return instance;
}

// Check account status
async function checkAccountStatus(axios, accountIndex) {
  try {
    const response = await axios.get(config.requestConfig.statusEndpoint);
    
    if (response.data.code !== 200) {
      throw new Error(`Invalid response code: ${response.data.code}`);
    }
    
    const accountInfo = response.data.data;
    const dailyCheckin = accountInfo.actsMap["Daily Check-in"];
    
    logger.info(`[Account ${accountIndex}] Wallet: ${accountInfo.account.account.slice(0, 6)}...${accountInfo.account.account.slice(-6)}`);
    logger.info(`[Account ${accountIndex}] Points: ${accountInfo.account.points}`);
    logger.info(`[Account ${accountIndex}] Check-in status: ${dailyCheckin.done ? 'Already checked in' : 'Not checked in'}`);
    
    return {
      isCheckedIn: dailyCheckin.done,
      accountInfo
    };
  } catch (error) {
    logger.error(`[Account ${accountIndex}] Error checking account status: ${error.message}`);
    if (error.response) {
      logger.error(`[Account ${accountIndex}] Response data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Perform daily check-in
async function performDailyCheckin(axios, accountIndex) {
  try {
    logger.info(`[Account ${accountIndex}] Performing daily check-in...`);
    
    const response = await axios.post(config.requestConfig.checkinEndpoint, {});
    
    if (response.data.code !== 200) {
      throw new Error(`Invalid response code: ${response.data.code}`);
    }
    
    logger.info(`[Account ${accountIndex}] Check-in successful! Points earned: ${response.data.data}`);
    return true;
  } catch (error) {
    logger.error(`[Account ${accountIndex}] Error performing check-in: ${error.message}`);
    if (error.response) {
      logger.error(`[Account ${accountIndex}] Response data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Process single account
async function processAccount(token, proxy, accountIndex) {
  logger.info(`[Account ${accountIndex}] Processing account...`);
  
  // Create axios instance with retry and proxy (if available)
  const axiosInstance = createAxiosInstance(token, proxy);
  
  try {
    // Check if already checked in
    const { isCheckedIn } = await checkAccountStatus(axiosInstance, accountIndex);
    
    if (isCheckedIn) {
      logger.info(`[Account ${accountIndex}] Already checked in today, skipping`);
      return { success: true, alreadyCheckedIn: true };
    }
    
    // Perform check-in
    await performDailyCheckin(axiosInstance, accountIndex);
    
    // Verify check-in was successful
    const { isCheckedIn: verifyCheckedIn } = await checkAccountStatus(axiosInstance, accountIndex);
    
    if (!verifyCheckedIn) {
      logger.warn(`[Account ${accountIndex}] Verification failed - check-in status is still false`);
      return { success: false, error: 'Verification failed' };
    }
    
    logger.info(`[Account ${accountIndex}] Check-in process completed successfully`);
    return { success: true, alreadyCheckedIn: false };
  } catch (error) {
    logger.error(`[Account ${accountIndex}] Failed to process account: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Process all accounts
async function processAllAccounts() {
  const tokens = await loadTokens();
  logger.info(`Loaded ${tokens.length} tokens`);
  
  const proxies = await loadProxies();
  logger.info(`Loaded ${proxies.length} proxies`);
  
  const results = {
    total: tokens.length,
    successful: 0,
    failed: 0,
    alreadyCheckedIn: 0
  };
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Get matching proxy if available, otherwise null
    const proxy = config.useProxy && i < proxies.length ? proxies[i] : null;
    
    logger.info(`Processing account ${i + 1}/${tokens.length}`);
    const result = await processAccount(token, proxy, i + 1);
    
    if (result.success) {
      results.successful++;
      if (result.alreadyCheckedIn) {
        results.alreadyCheckedIn++;
      }
    } else {
      results.failed++;
    }
    
    // Delay between accounts
    if (i < tokens.length - 1) {
      logger.debug(`Waiting ${config.delayBetweenAccounts}ms before processing next account`);
      await new Promise(resolve => setTimeout(resolve, config.delayBetweenAccounts));
    }
  }
  
  return results;
}

// Main function
async function main() {
  displayHeader();
  
  try {
    const results = await processAllAccounts();
    
    logger.info('===== Summary =====');
    logger.info(`Total accounts: ${results.total}`);
    logger.info(`Successful: ${results.successful}`);
    logger.info(`Failed: ${results.failed}`);
    logger.info(`Already checked in: ${results.alreadyCheckedIn}`);
    
    const nextRunDelay = config.nextRunDelayHours * 60 * 60 * 1000;
    const nextRunTime = moment().add(config.nextRunDelayHours, 'hours').format('DD/MM/YYYY - HH:mm:ss');
    
    logger.info(`Next run in ${config.nextRunDelayHours} hours at ${nextRunTime}`);
    
    // Schedule next run
    setTimeout(() => {
      logger.info('Starting next run...');
      main();
    }, nextRunDelay);
    
  } catch (error) {
    logger.error(`Main process error: ${error.message}`);
    logger.error('Bot will exit due to critical error');
    process.exit(1);
  }
}

// Start the bot
main();