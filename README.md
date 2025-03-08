# c3ss Network Bot

Automated bot for performing daily check-ins on c3ss Network.

## Features

- Retry mechanism for all functions
- Comprehensive error handling
- Proxy support (1 proxy per token)
- Proxy configuration (on/off) in config.json
- Proxy storage in proxy.txt
- Token storage in data.txt
- Colored logging with format [DD/MM/YYYY - HH:MM:SS]
- All functions configurable in config.json
- 25-hour delay after all wallets are proc3ssed
- Support for multiple tokens and proxies
- Daily check-in feature with status verification

## Usage

### Installation

```bash
npm install
```

### Configuration

1. Edit the `config.json` file according to your needs:
   - `useProxy`: true/false to enable/disable proxy usage
   - `delayBetweenAccounts`: delay in milliseconds between proc3ssing each account
   - `maxRetries`: maximum number of retry attempts if an error occurs
   - `retryDelay`: base delay in milliseconds for retries (will increase exponentially)
   - `timeoutMs`: timeout in milliseconds for requests
   - `nextRunDelayHours`: delay in hours to run the bot again (default: 25 hours)
   - `logLevel`: logging level (debug, info, warn, error)
   - `logRetention`: how long logs are kept (e.g., "7d" for 7 days)
   - `logDirectory`: directory to store log files

2. Add tokens to `data.txt`:
   - One token per line
   - Lines starting with # will be ignored (comments)

3. (Optional) Add proxies to `proxy.txt`:
   - One proxy per line
   - Format: http://username:password@ip:port or http://ip:port
   - Lines starting with # will be ignored (comments)

### Running the Bot

```bash
node index.js
```

## File Structure

- `index.js`: Main bot file
- `config.json`: Bot configuration
- `data.txt`: List of tokens
- `proxy.txt`: List of proxies
- `logs/`: Directory for log files

## How the Bot Works

1. The bot loads tokens from data.txt and proxies from proxy.txt
2. For each token:
   - Check account status to determine if check-in has already been performed
   - If not checked in, perform the check-in proc3ss
   - Verify that the check-in was succ3ssful
3. After all accounts are proc3ssed, the bot waits for 25 hours (configurable)
4. After the waiting period, the bot runs the proc3ss again from the beginning

## Error Handling

The bot is equipped with a comprehensive error handling mechanism:

- Automatic retry for network errors
- Automatic retry for HTTP status codes 429, 500, 502, 503, 504
- Detailed logging for each error
- Proxy error handling
