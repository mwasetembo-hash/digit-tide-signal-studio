# Digit Tide Signal Studio

Build the complete 'Mwase Hacking Bot' - Elite Deriv Signal Engine & Automated Trading Bot.

Theme & Aesthetics:
- Deep obsidian void background (#050508)
- Translucent dark panels (#0b0b12 / #0f0f18) with glassmorphism and subtle border glows
- Electric Cyan (#00f0ff), Crimson Danger/Sell (#ff003c), Emerald Green (#00ff9d), and Amber (#fbbf24) highlights
- JetBrains Mono font for technical data and Inter for UI text

Key Features:
1. Header & Navigation:
   - App branding: 'MWASE HACKING BOT - Universal Deriv Signal & Automation Engine'
   - Market filter bar: All Markets, Synthetic Indices, Forex, Commodities, Cryptocurrencies
   - Live Deriv connection status pill (Connected / Reconnecting / Error)
   - Account telemetry sub-bar: Active balance, session P&L, Win Rate, current stake, bot state
   - Mode switcher: [DEMO / Virtual Paper Trading] vs [MANUAL Signals with 1-Click Execution] vs [AUTO BOT Live Automation]
   - Deriv API Config modal preloaded with Deriv App ID (34ARk0NOmxpaMAqV6Bwgg or default 1089) and API token (pat_e2d6096c3495c0fad8c2e0693e22742a022eb390a7661d5b074137a2847828cd) with localStorage persistence and toggle to switch tokens
   - 'EXECUTE TRADE' button opening a manual contract confirmation drawer

2. Real Deriv WebSocket Integration & Automation Engine:
   - Connect to official Deriv WebSocket: `wss://ws.derivws.com/websockets/v3?app_id=...` with automatic reconnect
   - Authorize using the API token and display account balance
   - Real-time tick stream subscription for Volatility 100 (1s) [R_100] as target, plus Volatility 75, 50, 25, 10, Forex (EUR/USD, GBP/USD), Commodities (XAU/USD), and Crypto (BTC/USD)
   - Maintain rolling tick history and extract last digits (0-9)
   - Real-time Digit Frequency Histogram (digits 0 to 9) calculated over rolling 100 ticks showing hot and cold digits with percentages
   - Live Tick Digit Vector stream displaying the last 10 raw digits in animated glowing boxes

3. Automated Trading & Strategy Deck:
   - Strategy selector: Mean Reversion (Digit Even / Digit Odd on 3-in-a-row pattern detection), Over/Under with configurable barrier (0-9), and Digit Matches/Differs
   - Stake and risk controls: Initial stake ($), Martingale multiplier (e.g. 2.1x), max consecutive losses before reset, stop loss, take profit
   - Proposal request -> Buy contract -> Open contract tracking -> Win/Loss evaluation -> Martingale stake adjustment -> Cooldown -> Next scan
   - Complete Demo mode simulating paper trades with virtual P&L when running without live token

4. Interactive Terminal & Feeds:
   - Top marquee ticker tape showing rolling instruments and percentage changes
   - Active Market Signals Grid with live price ticks, directional CALL/PUT badges, strategy names, and confidence meters (85%-98%)
   - Live Engine Execution Log terminal: Timestamped logs for WebSocket events, pattern detections, contract proposals, purchases, and P&L results with clear button
   - Trader Community Feed: Simulated and interactive network broadcasts where users can type and post trade reads

Ensure the application is fully responsive, polished, and ready to use out of the box.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://digit-tide-signal-studio.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b50d82ea-f479-4388-9334-8e6429dc69c7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
