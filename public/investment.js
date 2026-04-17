/**
 * @file investment.js
 * @description Professional Live Trading Simulation Logic for the Investment Dashboard.
 * Handles live price updates, professional investment plans, balance validation, and UI enhancements.
 * Part of Step 3 Implementation.
 */

/** @constant {string} apiBase - The root URL for all internal API requests */
const apiBase = '/api';

/** @type {Chart|null} profitChartInstance - Stores the Chart.js instance for the P&L doughnut chart */
let profitChartInstance = null;

/** @type {Object} marketState - Persists the current state of the market view (currency, page) */
let marketState = { vs: 'usd', page: 1 };

/** @type {Object} livePrices - Stores the latest fetched prices for live updates */
let livePrices = {};

/** @type {Object} trends - Investment trends data */
const trendsData = {
  safe: [
    { id: 'btc_trend', coinId: 'bitcoin', name: 'BTC Trend', symbol: 'BTC', risk: 'Low', baseRoi: 12, volatility: 0.5 },
    { id: 'eth_trend', coinId: 'ethereum', name: 'ETH Trend', symbol: 'ETH', risk: 'Low', baseRoi: 15, volatility: 0.8 },
    { id: 'market_trend', coinId: 'tether', name: 'Market Index', symbol: 'INDEX', risk: 'Low', baseRoi: 8, volatility: 0.3 }
  ],
  risky: [
    { id: 'meme_trend', coinId: 'dogecoin', name: 'Meme Trend', symbol: 'MEME', risk: 'High', baseRoi: 45, volatility: 5.0 },
    { id: 'moon_trend', coinId: 'shiba-inu', name: 'Moonshot Trend', symbol: 'MOON', risk: 'High', baseRoi: 120, volatility: 10.0 },
    { id: 'alpha_trend', coinId: 'pepe', name: 'Alpha Trend', symbol: 'ALPHA', risk: 'High', baseRoi: 80, volatility: 7.5 }
  ]
};

/** @type {Object} simulatedTrends - Stores the live simulated % for trends */
let simulatedTrends = {};

/**
 * Simulates live profit/loss % for trends.
 */
function simulateTrends() {
  const allTrends = [...trendsData.safe, ...trendsData.risky];
  allTrends.forEach(trend => {
    const randomShift = (Math.random() - 0.5) * trend.volatility;
    const currentPl = (simulatedTrends[trend.id]?.pl || 0) + randomShift;
    
    // Keep PL within reasonable bounds relative to baseRoi
    const maxBound = trend.baseRoi * 1.5;
    const minBound = -trend.baseRoi * 0.5;
    const boundedPl = Math.max(minBound, Math.min(maxBound, currentPl));

    simulatedTrends[trend.id] = {
      pl: boundedPl,
      status: boundedPl >= 0 ? 'Profit' : 'Loss'
    };
  });
  updateTrendsUI();
}

/**
 * Updates the trends UI components if they exist.
 */
function updateTrendsUI() {
  const strategy = localStorage.getItem('investorPath') || 'safe';
  const container = document.getElementById('trendsContainer');
  if (!container) return;

  const trends = trendsData[strategy];
  let html = `<div class="coin-grid">`;
  
  trends.forEach(trend => {
    const data = simulatedTrends[trend.id] || { pl: 0, status: 'Neutral' };
    const plClass = data.pl >= 0 ? 'text-green' : 'text-red';
    const indicatorClass = data.pl >= 0 ? 'pl-positive' : 'pl-negative';
    
    html += `
      <div class="coin-live-card fade-in" onclick="selectTrend('${trend.id}')" style="cursor:pointer; border: 1px solid ${selectedTrendId === trend.id ? 'var(--accent-blue)' : 'rgba(255,255,255,0.1)'}">
        <div class="coin-header">
          <div class="logo-icon" style="width:32px; height:32px; font-size:12px;">${trend.symbol}</div>
          <div class="coin-info">
            <span class="coin-name">${trend.name}</span>
            <span class="coin-symbol">${trend.risk} Risk</span>
          </div>
          <span class="volatility-tag" style="background:${trend.risk === 'High' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}; color:${trend.risk === 'High' ? '#ef4444' : '#22c55e'}">${trend.risk}</span>
        </div>
        <div class="coin-body">
          <div class="price-section">
            <span class="current-price ${plClass}">${data.pl >= 0 ? '+' : ''}${data.pl.toFixed(2)}%</span>
            <span class="pl-indicator ${indicatorClass}" style="font-size:10px; margin-left:auto;">${data.status}</span>
          </div>
          <div class="last-updated">Live Trend Activity</div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

let selectedTrendId = null;

/**
 * Selects a trend and updates the custom investment form.
 */
function selectTrend(trendId) {
  selectedTrendId = trendId;
  updateTrendsUI();
  updateInvestmentProjection();
}

/**
 * @section Onboarding Functions
 * @description Core logic for checking investment history and managing the onboarding paths.
 */

/**
 * Checks if the user is a first-time investor.
 * Triggers the onboarding modal if zero investments are found.
 * Part of Step 3.A Implementation.
 */
async function checkFirstTimeInvestor() {
  const { userId } = getUserContext();
  if (!userId) return false;
  
  try {
    const res = await fetch(`${apiBase}/investments/summary?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    return data.success && (!data.summary || !data.summary.positions || data.summary.positions.length === 0);
  } catch (err) {
    console.error('Error checking investor history:', err);
    return false;
  }
}

/**
 * Saves the user's chosen strategy and updates the dashboard view.
 * @param {string} strategy - 'safe' or 'risky'
 */
function selectStrategy(strategy) {
  localStorage.setItem('investorPath', strategy);
  const modal = document.getElementById('onboardingModal');
  if (modal) modal.style.display = 'none';
  renderStrategyDashboard(strategy);
}

/** @type {Object} livePriceCache - Cache for live prices in the investment section */
let livePriceCache = {
  data: {},
  timestamp: 0,
  ttl: 30000 // 30 seconds
};

/**
 * Fetches live market data from CoinGecko API for specific coin groups with optimization.
 * Handles Step 3.A: Live Market Auto-Update.
 * Runs every 30 seconds to ensure fresh data.
 */
async function fetchLivePrices() {
  const strategy = localStorage.getItem('investorPath') || 'safe';
  const now = Date.now();
  
  // Return cached data if available and fresh
  if (livePriceCache.timestamp && (now - livePriceCache.timestamp < livePriceCache.ttl) && livePriceCache.strategy === strategy) {
    livePrices = livePriceCache.data;
    updateCoinListUI(strategy);
    return;
  }

  const safeCoins = ['tether', 'usd-coin', 'bitcoin', 'ethereum'];
  const riskyCoins = ['dogecoin', 'shiba-inu', 'pepe', 'floki', 'bonk'];
  const coinIds = strategy === 'safe' ? safeCoins : riskyCoins;
  
  const loadingSkeleton = document.getElementById('priceLoadingSkeleton');
  if (loadingSkeleton && !livePriceCache.timestamp) loadingSkeleton.style.display = 'block';

  try {
    const ids = coinIds.join(',');
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=10&page=1&sparkline=true&price_change_percentage=24h`;
    
    const res = await fetch(url);
    if (!res.ok) throw new Error('API limit reached or network error');
    const data = await res.json();
    
    livePrices = data.reduce((acc, coin) => {
      acc[coin.id] = coin;
      return acc;
    }, {});

    // Update cache
    livePriceCache.data = livePrices;
    livePriceCache.timestamp = now;
    livePriceCache.strategy = strategy;

    updateCoinListUI(strategy);
    if (loadingSkeleton) loadingSkeleton.style.display = 'none';
  } catch (err) {
    console.error('Live price fetch error:', err);
    if (loadingSkeleton) loadingSkeleton.style.display = 'none';
    // Use cached data as fallback even if stale
    if (Object.keys(livePriceCache.data).length > 0) {
      livePrices = livePriceCache.data;
      updateCoinListUI(strategy);
    } else {
      showToast('Error updating live prices. Please check your connection.', 'error');
    }
  }
}

/**
 * Updates the coin list UI with live data, including sparklines and 24h changes.
 * Part of Step 3.A and 3.D.
 * @param {string} strategy - 'safe' or 'risky'
 */
function updateCoinListUI(strategy) {
  const container = document.getElementById('coinListContainer');
  if (!container) return;

  const coins = strategy === 'safe' 
    ? ['tether', 'usd-coin', 'bitcoin', 'ethereum'] 
    : ['dogecoin', 'shiba-inu', 'pepe', 'floki', 'bonk'];

  let html = `<div class="coin-grid">`;
  
  coins.forEach(id => {
    const coin = livePrices[id];
    if (!coin) return;
    
    const change = coin.price_change_percentage_24h || 0;
    const changeClass = change >= 0 ? 'text-green' : 'text-red';
    const lastUpdated = new Date().toLocaleTimeString();
    
    html += `
      <div class="coin-live-card fade-in">
        <div class="coin-header">
          <img src="${coin.image}" alt="${coin.name}" class="coin-icon">
          <div class="coin-info">
            <span class="coin-name">${coin.name}</span>
            <span class="coin-symbol">${coin.symbol.toUpperCase()}</span>
          </div>
          ${strategy === 'risky' ? '<span class="volatility-tag">High Volatility</span>' : ''}
        </div>
        <div class="coin-body">
          <div class="price-section">
            <span class="current-price">${formatCurrency(coin.current_price)}</span>
            <span class="price-change ${changeClass}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%</span>
          </div>
          <div class="sparkline-container">
            <canvas id="sparkline-${coin.id}" width="100" height="40"></canvas>
          </div>
          <div class="coin-meta">
            <span class="last-updated">Last updated: ${lastUpdated}</span>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;

  // Initialize sparklines
  coins.forEach(id => {
    const coin = livePrices[id];
    if (coin && coin.sparkline_in_7d) {
      renderSparkline(`sparkline-${coin.id}`, coin.sparkline_in_7d.price, coin.price_change_percentage_24h >= 0 ? '#22c55e' : '#ef4444');
    }
  });
}

/**
 * Renders a small sparkline chart for a coin's price history.
 * Part of Step 3.D.2.
 * @param {string} canvasId - The ID of the canvas element.
 * @param {Array<number>} data - Price history data.
 * @param {string} color - Line color.
 */
function renderSparkline(canvasId, data, color) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data: data,
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.4
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}

/**
 * Dynamically renders the dashboard content based on the selected path.
 * Handles Step 3.B (Professional Plans) and adds Disclaimer Banner.
 * @param {string} strategy - 'safe' or 'risky'
 */
async function renderStrategyDashboard(strategy) {
  const container = document.getElementById('tab-investment');
  if (!container) return;
  
  await loadInvestments();

  let html = `
    <header style="margin-bottom:24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="page-title">${strategy === 'safe' ? 'Safe Assets Dashboard' : 'High Growth Dashboard'}</h1>
        <p class="page-subtitle">${strategy === 'safe' ? 'Low volatility simulation focused on stable growth.' : 'Aggressive simulation with high volatility assets.'}</p>
      </div>
      <div class="pl-indicator ${strategy === 'safe' ? 'pl-positive' : 'pl-negative'}" style="font-size: 14px; padding: 8px 16px;">
        ${strategy === 'safe' ? '🛡️ Safe Path' : '🚀 High Risk Path'}
      </div>
    </header>

    <!-- Real-time portfolio valuation summary -->
    <section class="panel" style="margin-bottom:2rem;">
      <div class="wallet-summary-grid">
        <div>
          <p class="wallet-card-label">Amount Invested</p>
          <p class="wallet-card-value" id="investAmount">$0.00</p>
        </div>
        <div>
          <p class="wallet-card-label">Current Value</p>
          <p class="wallet-card-value" id="investCurrent">$0.00</p>
        </div>
        <div>
          <p class="wallet-card-label">Profit / Loss</p>
          <p class="wallet-card-value" id="investPnL">$0.00</p>
        </div>
      </div>
    </section>

    <div id="priceLoadingSkeleton" class="skeleton-loader" style="display:none;">
      <div class="investment-plans-grid">
        <div class="skeleton skeleton-row" style="height: 120px;"></div>
        <div class="skeleton skeleton-row" style="height: 120px;"></div>
        <div class="skeleton skeleton-row" style="height: 120px;"></div>
      </div>
    </div>

    <section class="panel" style="margin-bottom: 2rem;">
      <div class="panel-header">
        <h2 class="panel-title">Dynamic Market Trends</h2>
        <p class="panel-meta">Real-time simulation of trending investment categories</p>
      </div>
      <div id="trendsContainer"></div>
    </section>

    <section class="panel" style="margin-bottom: 2rem;">
      <div class="panel-header">
        <h2 class="panel-title">Custom Investment System</h2>
        <p class="panel-meta">Create your own investment plan based on trends</p>
      </div>
      <div class="layout-two-column" style="margin-bottom:0;">
        <div class="panel" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);">
          <div class="form-field">
            <label class="form-label">Investment Amount ($)</label>
            <input type="number" id="customAmount" class="form-input" placeholder="Enter amount ($)" oninput="updateInvestmentProjection()">
          </div>
          <div class="form-field">
            <label class="form-label">Duration (Days)</label>
            <select id="customDuration" class="form-select" onchange="updateInvestmentProjection()">
              <option value="7">7 Days (Short Term)</option>
              <option value="15">15 Days (Mid Term)</option>
              <option value="30" selected>30 Days (Standard)</option>
              <option value="60">60 Days (Growth)</option>
              <option value="90">90 Days (Professional)</option>
            </select>
          </div>
          <button class="btn" style="width: 100%; height: 50px; margin-top: 1rem;" onclick="handleInvestNowCustom()">
            Invest Now
          </button>
        </div>
        <div class="panel" style="background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.1);">
          <h3 style="font-size:16px; font-weight:700; color:white; margin-bottom:1rem;">Investment Projection</h3>
          <div id="projectionDetails">
            <div class="empty-state">Select a trend and enter amount to see projection</div>
          </div>
        </div>
      </div>
    </section>

    <section class="panel" style="margin-bottom: 2rem;">
      <div class="panel-header">
        <h2 class="panel-title">Your Active Positions</h2>
        <p class="panel-meta">Professional-grade tracking with real-time analytics</p>
      </div>
      <div id="positionsTable">
        <div id="posTablePlaceholder" class="empty-state">No investments yet. Create a custom plan above to start.</div>
      </div>
    </section>

    <!-- Cross-Navigation Section -->
    <section style="display: flex; gap: 1rem; justify-content: center; margin-top: 3rem;">
      <button class="icon-btn secondary" style="padding: 1rem 2rem; border-radius: 999px;" onclick="switchStrategy('safe')">
        🛡️ Explore Low Risk Trends
      </button>
      <button class="icon-btn secondary" style="padding: 1rem 2rem; border-radius: 999px;" onclick="switchStrategy('risky')">
        🚀 Explore High Risk Trends
      </button>
    </section>
  `;

  container.innerHTML = html;
  
  // Select the first trend by default
  const defaultTrends = trendsData[strategy];
  if (defaultTrends && defaultTrends.length > 0) {
    selectedTrendId = defaultTrends[0].id;
  }

  // Start live updates
   fetchLivePrices();
   simulateTrends();
   updateInvestmentProjection();
   if (window.trendInterval) clearInterval(window.trendInterval);
   window.trendInterval = setInterval(simulateTrends, 5000);
   if (window.aggregatesInterval) clearInterval(window.aggregatesInterval);
   window.aggregatesInterval = setInterval(refreshAggregates, 5000);
   refreshAggregates();
}

/**
 * Updates the projection details in the custom investment form.
 */
function updateInvestmentProjection() {
  const container = document.getElementById('projectionDetails');
  const amount = parseFloat(document.getElementById('customAmount')?.value) || 0;
  const duration = parseInt(document.getElementById('customDuration')?.value) || 30;
  
  if (!selectedTrendId || amount <= 0) {
    container.innerHTML = `<div class="empty-state">Select a trend and enter amount to see projection</div>`;
    return;
  }

  const allTrends = [...trendsData.safe, ...trendsData.risky];
  const trend = allTrends.find(t => t.id === selectedTrendId);
  const simData = simulatedTrends[selectedTrendId] || { pl: 0 };
  
  // Projection logic: baseRoi + current sim PL, adjusted for duration
  const expectedRoi = (trend.baseRoi + (simData.pl / 10)) * (duration / 30);
  const profit = amount * (expectedRoi / 100);
  const total = amount + profit;
  
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div class="feature-item"><span>Trend Selected</span> <strong>${trend.name}</strong></div>
      <div class="feature-item"><span>Risk Level</span> <strong class="${trend.risk === 'High' ? 'text-red' : 'text-green'}">${trend.risk}</strong></div>
      <div class="feature-item"><span>Current Trend ROI</span> <strong class="${simData.pl >= 0 ? 'text-green' : 'text-red'}">${simData.pl >= 0 ? '+' : ''}${simData.pl.toFixed(2)}%</strong></div>
      <div class="feature-item"><span>Expected Profit</span> <strong class="text-green">${formatCurrency(profit)}</strong></div>
      <div class="feature-item" style="border-top:1px solid rgba(255,255,255,0.1); padding-top:8px; margin-top:4px;">
        <span style="font-weight:700; color:white;">Projected Total</span> 
        <strong style="font-size:18px; color:var(--accent-blue);">${formatCurrency(total)}</strong>
      </div>
      <div class="last-updated" style="margin-top:8px;">* Projections are based on current market trends and simulation logic.</div>
    </div>
  `;
}

/**
 * Switches between safe and risky strategies.
 */
function switchStrategy(strategy) {
  localStorage.setItem('investorPath', strategy);
  renderStrategyDashboard(strategy);
}

/**
 * Handles custom investment execution.
 */
async function handleInvestNowCustom() {
  const { userId } = getUserContext();
  if (!userId) return showToast('Please login to invest', 'error');

  if (!selectedTrendId) return showToast('Please select a trend first', 'error');

  const amount = parseFloat(document.getElementById('customAmount').value);
  const duration = parseInt(document.getElementById('customDuration').value);

  if (isNaN(amount) || amount <= 0) {
    return showToast('Please enter a valid investment amount', 'error');
  }

  try {
    const res = await fetch(`${apiBase}/wallet?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    if (!data.success) throw new Error('Balance check failed');

    if (data.wallet.availableBalance < amount) {
      return showInsufficientFundsModal(amount);
    }

    // Professional Investment Disclaimer Modal (Step 4)
    showInvestmentDisclaimerModal(() => {
      const allTrends = [...trendsData.safe, ...trendsData.risky];
      const trend = allTrends.find(t => t.id === selectedTrendId);
      
      // Create the investment
      createInvestment(trend.name, amount, duration);
    });
  } catch (err) {
    console.error('Investment error:', err);
    showToast('Failed to process investment', 'error');
  }
}

/**
 * Displays a professional investment disclaimer modal.
 * @param {Function} onConfirm - Callback function when the user confirms.
 */
function showInvestmentDisclaimerModal(onConfirm) {
  const modalId = 'investmentDisclaimerModal';
  const modalHtml = `
    <div id="${modalId}" class="modal-overlay fade-in">
      <div class="onboarding-modal" style="max-width: 550px; padding: 2.5rem; border: 1px solid rgba(59, 130, 246, 0.3); background: linear-gradient(145deg, #1a202c 0%, #111827 100%);">
        <div style="margin-bottom: 1.5rem;">
          <div style="width: 60px; height: 60px; background: rgba(59, 130, 246, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
            <span style="font-size: 30px;">⚖️</span>
          </div>
          <h2 style="font-size: 24px; font-weight: 800; color: white; margin-bottom: 1rem;">Investment Disclaimer</h2>
          <p style="font-size: 15px; color: #a0aec0; line-height: 1.6; margin-bottom: 0;">
            All investments are at your own risk. Profit or loss is not guaranteed and we are not responsible for any financial outcome.
          </p>
        </div>
        <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
          <button class="btn secondary" style="min-width: 140px; height: 48px;" onclick="closeModal('${modalId}')">Cancel</button>
          <button class="btn primary" style="min-width: 140px; height: 48px;" id="confirmInvestmentBtn">Confirm & Invest</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById('confirmInvestmentBtn').onclick = () => {
    closeModal(modalId);
    onConfirm();
  };
}

/**
 * Displays a professional modal for insufficient funds.
 */
function showInsufficientFundsModal(required) {
  const modalHtml = `
    <div id="insufficientFundsModal" class="modal-overlay">
      <div class="modal-content professional">
        <div class="modal-header">
          <h2>Insufficient Funds</h2>
          <button class="close-btn" onclick="closeModal('insufficientFundsModal')">&times;</button>
        </div>
        <div class="modal-body">
          <p>You do not have enough balance to start this plan. Minimum required: <strong>$${required}</strong>.</p>
          <p>Please deposit funds to your wallet to continue.</p>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" onclick="closeModal('insufficientFundsModal')">Cancel</button>
          <button class="btn primary" onclick="redirectToDeposit()">Deposit Now</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Creates the actual investment via the backend API.
 * Updated to support both individual assets and Trend-based custom plans.
 * @param {string} coinName - The name of the trend or asset.
 * @param {number} amount - Total investment amount.
 * @param {number} durationDays - Plan duration in days.
 */
async function createInvestment(coinName, amount, durationDays) {
  const { userId } = getUserContext();
  
  // Find trend data to get correct identifiers
  const allTrends = [...trendsData.safe, ...trendsData.risky];
  const trend = allTrends.find(t => t.name === coinName);
  
  const coinId = trend ? trend.coinId : coinName.toLowerCase();
  const coinSymbol = trend ? trend.symbol : 'USD';

  try {
    showToast(`Activating ${coinName} Investment...`, 'info');
    
    const res = await fetch(`${apiBase}/investments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId, 
        coinId: coinId, 
        coinSymbol: coinSymbol, 
        coinName: coinName, 
        amountUsd: amount,
        duration: durationDays
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error occurred during investment');

    showToast('Investment Activated Successfully', 'success');
    refreshAggregates();
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    console.error('Investment creation error:', err);
    showToast(err.message || 'Failed to activate investment. Please try again.', 'error');
  }
}

/**
 * Displays a professional emergency withdrawal disclaimer modal.
 * @param {number} investmentId - The ID of the investment to stop.
 * @param {number} currentValue - The current value of the investment.
 * @param {string} coinName - The name of the asset.
 */
function showEmergencyWithdrawModal(investmentId, currentValue, coinName) {
  const fee = currentValue * 0.02;
  const netAmount = currentValue - fee;
  const modalId = 'emergencyWithdrawModal';
  
  const modalHtml = `
    <div id="${modalId}" class="modal-overlay fade-in">
      <div class="onboarding-modal" style="max-width: 550px; padding: 2.5rem; border: 1px solid rgba(239, 68, 68, 0.3); background: linear-gradient(145deg, #1a202c 0%, #111827 100%);">
        <div style="margin-bottom: 1.5rem; text-align: center;">
          <div style="width: 60px; height: 60px; background: rgba(239, 68, 68, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
            <span style="font-size: 30px;">⚠️</span>
          </div>
          <h2 style="font-size: 24px; font-weight: 800; color: white; margin-bottom: 1rem;">Emergency Force Stop</h2>
          <p style="font-size: 15px; color: #a0aec0; line-height: 1.6; margin-bottom: 1.5rem;">
            You are stopping your <strong>${coinName}</strong> investment early. Please review the following details before confirming:
          </p>
          
          <div style="background: rgba(0,0,0,0.2); border-radius: 12px; padding: 1.5rem; text-align: left; margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
              <span style="color: #a0aec0;">Current Market Value</span>
              <span style="color: white; font-weight: 600;">${formatCurrency(currentValue)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
              <span style="color: #ef4444;">Early Exit Fee (2%)</span>
              <span style="color: #ef4444; font-weight: 600;">-${formatCurrency(fee)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.1);">
              <span style="color: white; font-weight: 700;">Net Return Amount</span>
              <span style="color: #22c55e; font-weight: 800; font-size: 18px;">${formatCurrency(netAmount)}</span>
            </div>
          </div>
          
          <p style="font-size: 13px; color: #718096; line-height: 1.4;">
            * This action is irreversible. The remaining balance will be credited to your available wallet immediately.
          </p>
        </div>
        <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
          <button class="btn secondary" style="min-width: 140px; height: 48px;" onclick="closeModal('${modalId}')">Cancel</button>
          <button class="btn" style="min-width: 140px; height: 48px; background: #ef4444; color: white;" id="confirmEmergencyWithdrawBtn">Confirm & Stop</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById('confirmEmergencyWithdrawBtn').onclick = () => {
    closeModal(modalId);
    handleEmergencyWithdraw(investmentId);
  };
}

/**
 * Handles the emergency withdrawal execution via the backend API.
 * @param {number} investmentId - The ID of the investment to stop.
 */
async function handleEmergencyWithdraw(investmentId) {
  const { userId } = getUserContext();
  if (!userId) return;

  try {
    showToast('Processing Emergency Withdrawal...', 'info');
    
    const res = await fetch(`${apiBase}/investments/emergency-withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, investmentId })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error during emergency withdrawal');

    showToast('Investment Stopped & Funds Returned Successfully!', 'success');
    refreshAggregates();
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    console.error('Emergency withdrawal error:', err);
    showToast(err.message || 'Failed to stop investment. Please try again.', 'error');
  }
}

/**
 * Utility: Shows a professional toast notification.
 * Part of Step 3.A.4.
 */
function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} fade-in`;
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <span class="toast-message">${message}</span>
    </div>
  `;
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

/**
 * Utility: Creates a container for toast notifications if it doesn't exist.
 */
function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;
  document.body.appendChild(container);
  return container;
}

/**
 * Utility: Closes a modal by ID.
 */
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.remove();
}

/**
 * Utility: Redirects user to the wallet deposit section.
 */
function redirectToDeposit() {
  closeModal('insufficientFundsModal');
  setActiveTab('wallet');
  renderWalletForms('deposit');
}

/**
 * Formats a numeric value as a USD currency string.
 */
function formatCurrency(value) {
  const num = Number(value || 0);
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formats a numeric value as a percentage string.
 */
function formatPercent(value) {
  const num = Number(value || 0);
  return `${num.toFixed(2)}%`;
}

/**
 * Orchestrates the visibility of dashboard tabs and triggers data refresh for specific views.
 * @param {string} tabName - The identifier of the tab to activate.
 */
function setActiveTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    if (panel.id === `tab-${tabName}`) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', 'hidden');
    }
  });

  document.querySelectorAll('.nav-link[data-tab]').forEach((btn) => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (tabName === 'wallet') {
    loadWallet();
    renderWalletForms('deposit');
    loadTransactions();
  } else if (tabName === 'investment' || tabName === 'profit' || tabName === 'profile' || tabName === 'dashboard') {
    refreshAggregates();
    if (tabName === 'profile') loadProfile();
  } else if (tabName === 'market') {
    loadMarketSnapshot();
  }
}

/**
 * Retrieves the current user session details from localStorage.
 */
function getUserContext() {
  const storedId = localStorage.getItem('userId');
  const storedName = localStorage.getItem('userName') || 'Investor';
  const userId = storedId ? parseInt(storedId, 10) : null;
  return { userId, userName: storedName };
}

/**
 * Fetches and displays the user's wallet balances.
 */
async function loadWallet() {
  const { userId } = getUserContext();
  if (!userId) return;
  try {
    const res = await fetch(`${apiBase}/wallet?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    if (!data.success) return;

    const w = data.wallet;
    const available = formatCurrency(w.availableBalance);
    const deposited = formatCurrency(w.totalDeposited);
    const withdrawn = formatCurrency(w.totalWithdrawn);

    ['walletAvailable','walletAvailable2'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = available; });
    ['walletDeposited','walletDeposited2'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = deposited; });
    ['walletWithdrawn','walletWithdrawn2'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = withdrawn; });
    
    const statEl = document.getElementById('statWalletBalance'); if (statEl) statEl.textContent = available;
    const statDepEl = document.getElementById('statTotalDeposited'); if (statDepEl) statDepEl.textContent = deposited;
    const statWithEl = document.getElementById('statTotalWithdrawn'); if (statWithEl) statWithEl.textContent = withdrawn;
    
    const profileWallet = document.getElementById('profileWalletBalance'); if (profileWallet) profileWallet.textContent = available;
    const profileDep = document.getElementById('profileDeposited'); if (profileDep) profileDep.textContent = deposited;
    const profileWith = document.getElementById('profileWithdrawn'); if (profileWith) profileWith.textContent = withdrawn;
  } catch (err) {
    console.error('Wallet load error:', err);
  }
}

/**
 * Retrieves the user's transaction history.
 */
async function loadTransactions() {
  const { userId } = getUserContext();
  if (!userId) return;
  try {
    const res = await fetch(`${apiBase}/wallet/transactions?userId=${encodeURIComponent(userId)}&limit=50`);
    const data = await res.json();
    if (!data.success) return;

    const rows = (data.transactions || []).map(t => {
      const when = t.created_at ? new Date(t.created_at).toLocaleString() : '';
      const fee = Number(t.fee || 0);
      const amt = Number(t.amount || 0);
      const rawStatus = (t.status || 'pending').toLowerCase();
      const status = rawStatus === 'completed' ? 'approved' : rawStatus;
      const statusLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending';
      
      let statusHtml = '';
      const typeLower = (t.type || '').toLowerCase();
      if (typeLower.includes('deposit') || typeLower.includes('withdraw')) {
        const statusClass = `status-${status}`;
        statusHtml = `<span class="deposit-status-badge ${statusClass}">${statusLabel}</span>`;
      }

      return `
        <tr>
          <td>${when}</td>
          <td>${t.type.replace('_', ' ')} ${statusHtml}</td>
          <td>${formatCurrency(amt)}</td>
          <td>${fee ? formatCurrency(fee) : '-'}</td>
          <td>${t.description || ''}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>Date</th><th>Type / Status</th><th>Amount</th><th>Fee</th><th>Description</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    const table = document.getElementById('transactionsTable');
    if (table) table.innerHTML = html;
  } catch (err) {
    console.error('Transaction load error:', err);
  }
}

/**
 * Handles payment method selection and updates UI.
 */
function selectPaymentMethod(method, name, details) {
  document.querySelectorAll('.payment-method-card').forEach(card => card.classList.remove('selected'));
  const selectedCard = event.currentTarget;
  selectedCard.classList.add('selected');
  
  const methodSelect = document.getElementById('depMethod');
  if (methodSelect) methodSelect.value = method;
  
  showToast(`Selected ${method.toUpperCase()}. Please copy details and pay.`, 'info');
}

/**
 * Handles screenshot file upload and updates UI.
 */
function handleScreenshotUpload(input) {
  const box = input.parentElement;
  const status = document.getElementById('uploadStatus');
  if (input.files && input.files[0]) {
    box.classList.add('has-file');
    status.textContent = `File selected: ${input.files[0].name}`;
    status.style.color = '#22c55e';
  } else {
    box.classList.remove('has-file');
    status.textContent = 'Click to upload screenshot (JPG/PNG)';
    status.style.color = '';
  }
}

/**
 * Validates and submits the manual deposit request.
 */
async function submitManualDeposit() {
  const { userId } = getUserContext();
  const amount = document.getElementById('depAmount').value;
  const method = document.getElementById('depMethod').value;
  const senderName = document.getElementById('depSenderName').value;
  const senderAccount = document.getElementById('depSenderAccount').value;
  const screenshot = document.getElementById('depScreenshot').files[0];
  const payPwd = document.getElementById('depPayPwd').value;

  if (!amount || !method || !senderName || !senderAccount || !screenshot || !payPwd) {
    return showToast('Please fill all fields and upload screenshot.', 'error');
  }

  try {
    showToast('Verifying payment password...', 'info');
    
    // Step 1: Verify Payment Password
    const verifyRes = await fetch(`${apiBase}/user/verify-payment-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, paymentPassword: payPwd })
    });
    const verifyData = await verifyRes.json();
    
    if (!verifyData.success) {
      return showToast('Incorrect Payment Password', 'error');
    }

    // Step 2: Prepare FormData for submission
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('amount', amount);
    formData.append('method', method);
    formData.append('senderName', senderName);
    formData.append('senderAccount', senderAccount);
    formData.append('screenshot', screenshot);
    formData.append('type', 'deposit');
    formData.append('status', 'pending');

    showToast('Submitting deposit request...', 'info');
    
    const submitRes = await fetch(`${apiBase}/wallet/manual-deposit`, {
      method: 'POST',
      body: formData
    });
    const submitData = await submitRes.json();

    if (submitData.success) {
      showToast('Deposit Request Submitted Successfully!', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } else {
      showToast(submitData.error || 'Submission failed', 'error');
    }
  } catch (err) {
    console.error('Manual deposit error:', err);
    showToast('Server error. Please try again.', 'error');
  }
}

/**
 * Updates withdrawal amount with fee calculation.
 */
function updateWithdrawalFee() {
  const amountInput = document.getElementById('withdrawAmount');
  const amount = parseFloat(amountInput.value) || 0;
  const feeEl = document.getElementById('withdrawFeeValue');
  const netEl = document.getElementById('withdrawNetValue');
  
  const fee = amount * 0.01;
  const net = amount - fee;
  
  if (feeEl) feeEl.textContent = formatCurrency(fee);
  if (netEl) netEl.textContent = formatCurrency(net);
}

/**
 * Submits the manual withdrawal request.
 */
async function submitManualWithdrawal() {
  const { userId } = getUserContext();
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  const method = document.getElementById('withdrawMethod').value;
  const accountName = document.getElementById('withdrawAccountName').value;
  const accountAddress = document.getElementById('withdrawAccountAddress').value;
  const payPwd = document.getElementById('withdrawPayPwd').value;

  if (!amount || amount <= 0 || !method || !accountName || !accountAddress || !payPwd) {
    return showToast('Please fill all fields.', 'error');
  }

  try {
    showToast('Verifying payment password...', 'info');
    
    // Step 1: Verify Payment Password
    const verifyRes = await fetch(`${apiBase}/user/verify-payment-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, paymentPassword: payPwd })
    });
    const verifyData = await verifyRes.json();
    
    if (!verifyData.success) {
      return showToast('Incorrect Payment Password', 'error');
    }

    // Step 2: Submit withdrawal request
    showToast('Submitting withdrawal request...', 'info');
    
    const submitRes = await fetch(`${apiBase}/wallet/manual-withdrawal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        amount,
        method,
        accountName,
        accountAddress
      })
    });
    const submitData = await submitRes.json();

    if (submitData.success) {
      showToast('Withdrawal Request Submitted Successfully!', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } else {
      showToast(submitData.error || 'Submission failed', 'error');
    }
  } catch (err) {
    console.error('Manual withdrawal error:', err);
    showToast('Server error. Please try again.', 'error');
  }
}

/**
 * Dynamically renders the appropriate wallet forms.
 * Enhanced with professional manual deposit & withdrawal workflow.
 */
function renderWalletForms(active) {
  const container = document.getElementById('walletForms');
  if (!container) return;
  let html = '';

  if (active === 'deposit') {
    html = `
      <div class="deposit-workflow fade-in">
        <h2 class="panel-title" style="margin-bottom:1.5rem;">Deposit Funds</h2>
        
        <!-- Payment Method Cards (Step 1) -->
        <p class="field-label" style="margin-bottom:1rem;">1. Select Payment Method & Copy Details</p>
        <div class="payment-methods-grid">
          <div class="payment-method-card" onclick="selectPaymentMethod('easypaisa', 'NH Network', '03001234567')">
            <div class="method-icon">📱</div>
            <div class="method-name">EasyPaisa</div>
            <div class="method-details">Account: NH Network<br>Number: 03001234567</div>
          </div>
          <div class="payment-method-card" onclick="selectPaymentMethod('jazzcash', 'NH Network', '03007654321')">
            <div class="method-icon">💰</div>
            <div class="method-name">JazzCash</div>
            <div class="method-details">Account: NH Network<br>Number: 03007654321</div>
          </div>
          <div class="payment-method-card" onclick="selectPaymentMethod('bank', 'NH Network Bank', 'PK00 NHNT 1234 5678 9012')">
            <div class="method-icon">🏦</div>
            <div class="method-name">Bank Transfer</div>
            <div class="method-details">Bank: NH Network Bank<br>IBAN: PK00...9012</div>
          </div>
          <div class="payment-method-card" onclick="selectPaymentMethod('usdt', 'TRC20 Wallet', 'TNV7...xY9z')">
            <div class="method-icon">💵</div>
            <div class="method-name">USDT (TRC20)</div>
            <div class="method-details">Network: TRC20<br>Address: TNV7...xY9z</div>
          </div>
        </div>

        <!-- Manual Deposit Form (Step 2) -->
        <div id="manualDepositForm" class="panel" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);">
          <p class="field-label" style="margin-bottom:1.5rem;">2. Submit Your Payment Proof</p>
          
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem;">
            <div class="form-field">
              <label class="form-label">Deposit Amount (USD)</label>
              <input type="number" id="depAmount" class="form-input" placeholder="e.g. 500" required>
            </div>
            <div class="form-field">
              <label class="form-label">Payment Method</label>
              <select id="depMethod" class="form-select" required>
                <option value="">Select Method</option>
                <option value="easypaisa">EasyPaisa</option>
                <option value="jazzcash">JazzCash</option>
                <option value="bank">Bank Transfer</option>
                <option value="usdt">USDT (TRC20)</option>
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; margin-top:1rem;">
            <div class="form-field">
              <label class="form-label">Your Account Name</label>
              <input type="text" id="depSenderName" class="form-input" placeholder="Name on your account" required>
            </div>
            <div class="form-field">
              <label class="form-label">Your Account/Wallet Number</label>
              <input type="text" id="depSenderAccount" class="form-input" placeholder="Your account or wallet address" required>
            </div>
          </div>

          <div class="form-field" style="margin-top:1rem;">
            <label class="form-label">Upload Payment Screenshot</label>
            <div class="upload-box" onclick="document.getElementById('depScreenshot').click()">
              <span id="uploadStatus">Click to upload screenshot (JPG/PNG)</span>
              <input type="file" id="depScreenshot" hidden accept="image/*" onchange="handleScreenshotUpload(this)">
            </div>
          </div>

          <div class="form-field" style="margin-top:1rem;">
            <label class="form-label">Payment Password</label>
            <input type="password" id="depPayPwd" class="form-input" placeholder="Required for security" required>
          </div>

          <button class="btn" id="manualDepositBtn" style="width: 100%; margin-top: 1.5rem; height: 50px; font-size: 16px;">Confirm Deposit Request</button>
          <p class="form-note" style="text-align:center; margin-top:1rem;">Your request will be verified by admin within 1-2 hours.</p>
        </div>
      </div>
    `;
    
    setTimeout(() => {
      const btn = document.getElementById('manualDepositBtn');
      if (btn) btn.onclick = submitManualDeposit;
    }, 100);

  } else if (active === 'withdraw') {
    html = `
      <div class="withdrawal-workflow fade-in">
        <h2 class="panel-title" style="margin-bottom:1.5rem;">Withdraw Funds</h2>
        
        <div class="panel" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem;">
            <div class="form-field">
              <label class="form-label">Withdrawal Amount (USD)</label>
              <input type="number" id="withdrawAmount" class="form-input" placeholder="e.g. 100" required oninput="updateWithdrawalFee()">
            </div>
            <div class="form-field">
              <label class="form-label">Payment Method</label>
              <select id="withdrawMethod" class="form-select" required>
                <option value="">Select Method</option>
                <option value="easypaisa">EasyPaisa</option>
                <option value="jazzcash">JazzCash</option>
                <option value="bank">Bank Transfer</option>
                <option value="usdt">USDT (TRC20)</option>
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; margin-top:1rem;">
            <div class="form-field">
              <label class="form-label">Account Name</label>
              <input type="text" id="withdrawAccountName" class="form-input" placeholder="Your Name on Account" required>
            </div>
            <div class="form-field">
              <label class="form-label">Account/Wallet Address</label>
              <input type="text" id="withdrawAccountAddress" class="form-input" placeholder="Your Account Number or Address" required>
            </div>
          </div>

          <div class="form-field" style="margin-top:1rem;">
            <label class="form-label">Payment Password</label>
            <input type="password" id="withdrawPayPwd" class="form-input" placeholder="Enter your payment password" required>
          </div>

          <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 12px; font-size: 14px;">
            <div style="display:flex; justify-content:space-between; margin-bottom: 0.5rem;">
              <span style="color:var(--text-muted);">Processing Fee (1%)</span>
              <span id="withdrawFeeValue">$0.00</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-weight:700; color:white;">
              <span>Total to Receive</span>
              <span id="withdrawNetValue">$0.00</span>
            </div>
          </div>

          <p class="form-note" style="margin-top:1rem; font-size:12px; color:var(--text-muted);">
            ⚠️ 1% fee will be automatically deducted from the withdrawal amount. 
            Withdrawals are processed within 24 hours after admin approval.
          </p>

          <button class="btn" id="manualWithdrawalBtn" style="width: 100%; margin-top: 1.5rem; height: 50px; font-size: 16px;">Submit Withdrawal Request</button>
        </div>
      </div>
    `;
    
    setTimeout(() => {
      const btn = document.getElementById('manualWithdrawalBtn');
      if (btn) btn.onclick = submitManualWithdrawal;
    }, 100);
  }
  container.innerHTML = html;
}

/** @type {Object} marketCache - In-memory cache for market data to reduce API calls and latency */
let marketCache = {
  data: null,
  timestamp: 0,
  ttl: 60000 // 1 minute
};

/**
 * Fetches market data with caching and improved fetching logic.
 * Part of Step 3 Implementation (Optimized).
 */
async function fetchMarketData(vs = 'usd', page = 1) {
  const cacheKey = `${vs}_${page}`;
  const now = Date.now();
  
  if (marketCache.data && marketCache.timestamp && (now - marketCache.timestamp < marketCache.ttl) && marketCache.key === cacheKey) {
    return marketCache.data;
  }

  try {
    const res = await fetch(`${apiBase}/market/list?vs_currency=${encodeURIComponent(vs)}&page=${encodeURIComponent(page)}&per_page=50`);
    if (!res.ok) throw new Error('Failed to fetch market data');
    const data = await res.json();
    
    if (data.success) {
      marketCache.data = data.coins;
      marketCache.timestamp = now;
      marketCache.key = cacheKey;
      return data.coins;
    }
    return [];
  } catch (err) {
    console.error('Market fetch error:', err);
    throw err;
  }
}

/**
 * Fetches real-time market data for the market snapshot table with optimization and skeletons.
 */
async function loadMarketSnapshot(query = '') {
  const marketTable = document.getElementById('marketTable');
  if (!marketTable) return;

  // Show skeletons if no data exists or when explicitly loading
  if (!marketCache.data) {
    marketTable.innerHTML = `
      <div class="market-skeleton">
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
      </div>
    `;
  }

  try {
    const { vs, page } = marketState;
    const coins = await fetchMarketData(vs, page);
    
    let filteredCoins = coins || [];
    const q = (query || document.getElementById('marketSearch')?.value || '').trim().toLowerCase();
    
    if (q) {
      filteredCoins = coins.filter(c => 
        (c.name || '').toLowerCase().includes(q) || 
        (c.symbol || '').toLowerCase().includes(q) || 
        (c.id || '').toLowerCase().includes(q)
      );
    }

    const rows = filteredCoins.map((c) => {
      const change = Number(c.priceChange24h || 0);
      const changeClass = change >= 0 ? 'badge-green' : 'badge-red';
      const changeText = `${change.toFixed(2)}%`;
      const priceText = (vs === 'usd') ? formatCurrency(c.price) : `${Number(c.price || 0).toLocaleString()} PKR`;
      const mcap = c.marketCap ? `$${Number(c.marketCap).toLocaleString()}` : '-';
      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <img src="${c.image || ''}" alt="" style="width:24px; height:24px; border-radius:50%;" onerror="this.style.display='none'">
              <div>
                <div style="font-weight:600;">${c.name}</div>
                <div style="font-size:10px; color:var(--text-muted);">${c.symbol.toUpperCase()}</div>
              </div>
            </div>
          </td>
          <td style="font-weight:700;">${priceText}</td>
          <td class="${changeClass}" style="font-weight:600;">${change >= 0 ? '▲' : '▼'} ${changeText}</td>
          <td style="color:var(--text-muted);">${mcap}</td>
        </tr>
      `;
    }).join('');

    const tableHtml = `
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>Coin</th><th>Price (${vs.toUpperCase()})</th><th>24h Change</th><th>Market Cap</th></tr>
          </thead>
          <tbody>${rows.length ? rows : '<tr><td colspan="4" class="empty-state">No coins found matching your search.</td></tr>'}</tbody>
        </table>
      </div>
    `;

    marketTable.innerHTML = tableHtml;

    // Update the 'Dashboard' tab's mini-market preview (Top 5 coins)
    const dashContainer = document.getElementById('dashboardMarket');
    if (dashContainer) {
      const topFive = coins.slice(0, 5).map((c) => {
        const change = Number(c.priceChange24h || 0);
        const cls = change >= 0 ? 'badge-green' : 'badge-red';
        return `
          <tr>
            <td>${c.name} <span class="chip">${c.symbol.toUpperCase()}</span></td>
            <td>${formatCurrency(c.price)}</td>
            <td class="${cls}">${change.toFixed(2)}%</td>
          </tr>
        `;
      }).join('');
      dashContainer.innerHTML = `
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr><th>Coin</th><th>Price</th><th>24h</th></tr>
            </thead>
            <tbody>${topFive}</tbody>
          </table>
        </div>
      `;
    }
  } catch (err) {
    console.error('Market snapshot error:', err);
    marketTable.innerHTML = '<div class="empty-state">Failed to load market data. Please check your connection.</div>';
  }
}

/**
 * Optimized search functionality for Market Snapshot.
 */
function handleMarketSearch() {
  const q = document.getElementById('marketSearch')?.value || '';
  loadMarketSnapshot(q);
}

/**
 * Fetches a summary of all user investments.
 */
async function loadInvestments() {
  const { userId } = getUserContext();
  if (!userId) return null;
  try {
    const res = await fetch(`${apiBase}/investments/summary?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    if (!data.success) return null;
    return data.summary || null;
  } catch (err) { 
    console.error('Investment summary load error:', err);
    return null; 
  }
}

/**
 * Renders the user's investment positions in a professional trading-style table.
 * Includes Entry Value, Current Value, P/L calculations and Status.
 */
function renderPositions(summary) {
  const container = document.getElementById('positionsTable');
  if (!container) return;
  const positions = (summary && summary.positions) || [];
  
  if (!positions.length) {
    container.innerHTML = '<div class="empty-state">No active positions. Select an investment plan to get started.</div>';
    return;
  }

  const rows = positions.map((p) => {
    const isPositive = p.profitAmount >= 0;
    const plClass = isPositive ? 'text-green' : 'text-red';
    const plIndicator = isPositive ? 'pl-positive' : 'pl-negative';
    const date = new Date(p.createdAt);
    
    // Use the stored duration from the database (Step 6)
    const durationDays = p.duration || 30; 
    const expiryDate = new Date(date.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    const isCompleted = now > expiryDate;
    const timeRemaining = isCompleted ? 'Completed' : `${Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))} days`;

    return `
      <tr class="fade-in">
        <td>
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="font-weight:700; color:white;">${p.coinName}</div>
            <span class="chip">${p.coinSymbol.toUpperCase()}</span>
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Entered: ${date.toLocaleDateString()}</div>
        </td>
        <td>
          <div style="font-weight:600;">${formatCurrency(p.investedAmount)}</div>
          <div style="font-size:11px; color:var(--text-muted);">@ ${formatCurrency(p.avgBuyPrice)}</div>
        </td>
        <td>
          <div style="font-weight:600; color:white;">${formatCurrency(p.currentValue)}</div>
          <div style="font-size:11px; color:var(--text-muted);">@ ${formatCurrency(p.currentPrice)}</div>
        </td>
        <td>
          <div class="${plClass}" style="font-weight:700;">${isPositive ? '+' : ''}${formatCurrency(p.profitAmount)}</div>
          <div class="pl-indicator ${plIndicator}" style="display:inline-block; margin-top:4px; font-size:10px;">
            ${isPositive ? '▲' : '▼'} ${Math.abs(p.profitPercent).toFixed(2)}%
          </div>
        </td>
        <td>
          <div class="${isCompleted ? '' : 'status-running'}">${isCompleted ? '✅ Completed' : 'Running'}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${timeRemaining}</div>
          ${!isCompleted ? `
            <button class="btn" style="padding:4px 8px; font-size:11px; margin-top:8px; background:var(--error);" onclick="showEmergencyWithdrawModal(${p.id}, ${p.currentValue}, '${p.coinName}')">
              Emergency Withdraw
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="trading-table">
        <thead>
          <tr>
            <th>Asset / Time</th>
            <th>Invested / Entry</th>
            <th>Current Value</th>
            <th>Profit / Loss</th>
            <th>Status / Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/**
 * Updates or creates advanced Chart.js visualizations for the Profit Ratio section.
 * Includes Asset Distribution and Portfolio Growth charts.
 */
function renderAnalyticsCharts(summary) {
  const positions = (summary && summary.positions) || [];
  if (!positions.length) return;

  // 1. Asset Distribution (Doughnut)
  const distCtx = document.getElementById('assetDistributionChart');
  if (distCtx) {
    const data = {
      labels: positions.map(p => p.coinName),
      datasets: [{
        data: positions.map(p => p.currentValue),
        backgroundColor: [
          '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'
        ],
        borderWidth: 0,
        hoverOffset: 20
      }]
    };
    
    if (window.assetDistChart) window.assetDistChart.destroy();
    window.assetDistChart = new Chart(distCtx, {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#cbd5e0', font: { size: 11 } } }
        },
        cutout: '70%'
      }
    });
  }

  // 2. Portfolio Growth (Simulated Line Chart)
  const growthCtx = document.getElementById('portfolioGrowthChart');
  if (growthCtx) {
    const totalValue = summary.currentTotal;
    const labels = ['Day 1', 'Day 5', 'Day 10', 'Day 15', 'Day 20', 'Day 25', 'Today'];
    // Simulate growth data points based on current profit
    const baseValue = summary.investedTotal;
    const growthData = labels.map((_, i) => {
      const progress = i / (labels.length - 1);
      const volatility = (Math.random() - 0.5) * (baseValue * 0.05);
      return baseValue + (totalValue - baseValue) * progress + volatility;
    });

    if (window.growthChart) window.growthChart.destroy();
    window.growthChart = new Chart(growthCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Portfolio Value',
          data: growthData,
          borderColor: '#3b82f6',
          background: 'linear-gradient(180deg, rgba(59, 130, 246, 0.2) 0%, transparent 100%)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#3b82f6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#718096' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#718096', callback: (v) => '$' + v.toLocaleString() } }
        }
      }
    });
  }

  // 3. Profit History (Bar Chart)
  const historyCtx = document.getElementById('profitHistoryChart');
  if (historyCtx) {
    const labels = positions.map(p => p.coinSymbol.toUpperCase());
    const data = {
      labels: labels,
      datasets: [{
        label: 'Net Profit/Loss ($)',
        data: positions.map(p => p.profitAmount),
        backgroundColor: positions.map(p => p.profitAmount >= 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)'),
        borderRadius: 8
      }]
    };

    if (window.historyChart) window.historyChart.destroy();
    window.historyChart = new Chart(historyCtx, {
      type: 'bar',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#718096' } },
          x: { grid: { display: false }, ticks: { color: '#718096' } }
        }
      }
    });
  }

  // 4. Investment Breakdown Table (New)
  const breakdownContainer = document.getElementById('profitBreakdownTable');
  if (breakdownContainer) {
    const rows = positions.map(p => {
      const isPositive = p.profitAmount >= 0;
      return `
        <tr>
          <td>
            <div style="font-weight:700; color:white;">${p.coinName}</div>
            <div style="font-size:11px; color:var(--text-muted);">${p.coinSymbol.toUpperCase()}</div>
          </td>
          <td>${formatCurrency(p.investedAmount)}</td>
          <td>${formatCurrency(p.currentValue)}</td>
          <td class="${isPositive ? 'text-green' : 'text-red'}" style="font-weight:700;">
            ${isPositive ? '+' : ''}${formatCurrency(p.profitAmount)}
            <div style="font-size:10px;">${isPositive ? '▲' : '▼'} ${Math.abs(p.profitPercent).toFixed(2)}%</div>
          </td>
          <td>
            <div class="chip" style="background: rgba(59, 130, 246, 0.1); border-color: rgba(59, 130, 246, 0.3);">
              ${p.duration || 30} Days
            </div>
            <button class="btn" style="padding:2px 6px; font-size:10px; margin-top:6px; background:var(--error); width:100%;" onclick="showEmergencyWithdrawModal(${p.id}, ${p.currentValue}, '${p.coinName}')">
              Force Stop
            </button>
          </td>
        </tr>
      `;
    }).join('');

    breakdownContainer.innerHTML = `
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Trend / Asset</th>
              <th>Amount Invested</th>
              <th>Current Value</th>
              <th>Total P/L</th>
              <th>Plan / Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }
}

/**
 * Global Refresh Orchestrator.
 * Updates all dashboard metrics, positions, and charts.
 */
async function refreshAggregates() {
  await loadWallet();
  const summary = await loadInvestments();
  
  const dashboardPnL = document.getElementById('statPnL');
  const dashboardPnLPercent = document.getElementById('statPnLPercent');

  if (!summary) {
    // Only reset investment-specific fields, keep wallet totals (which are handled by loadWallet)
    ['statInvested','statCurrent','statPnL','investAmount','investCurrent','investPnL','investPnLPercent','profileInvested','profileCurrent','profilePnL'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '$0.00';
    });
    if (dashboardPnLPercent) {
      dashboardPnLPercent.textContent = '0.00%';
      dashboardPnLPercent.className = 'pl-indicator pl-positive';
    }
    renderPositions({ positions: [] });
    return;
  }

  const invested = formatCurrency(summary.investedTotal);
  const current = formatCurrency(summary.currentTotal);
  const profit = summary.profitAmount || 0;
  const profitText = (profit >= 0 ? '+' : '') + formatCurrency(profit);
  const profitPercent = summary.profitPercent || 0;

  // Update Main Stat Cards
  ['statInvested', 'investAmount', 'profileInvested'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = invested; });
  ['statCurrent', 'investCurrent', 'profileCurrent'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = current; });
  ['statPnL', 'investPnL', 'profilePnL'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = profitText; });
  // Percent badges intentionally suppressed to keep display clean

  renderPositions(summary);
  renderAnalyticsCharts(summary);
}

/**
 * Fetches and displays the user's KYC profile information.
 */
async function loadProfile() {
  const { userId } = getUserContext();
  if (!userId) return;
  try {
    const stRes = await fetch(`${apiBase}/investor/request/status?userId=${encodeURIComponent(userId)}`);
    const stData = await stRes.json();
    const r = (stData && stData.request) || {};
    
    const avatarEl = document.getElementById('investorSelfie');
    const nameEl = document.getElementById('cardFullName');
    const emailEl = document.getElementById('cardEmail');
    const phoneEl = document.getElementById('cardPhone');
    const cnicEl = document.getElementById('cardCnic');
    const addrEl = document.getElementById('cardAddress');
    
    if (avatarEl) {
      if (r.avatar_url) avatarEl.src = r.avatar_url;
      else if (r.selfie_url) avatarEl.src = r.selfie_url;
      else avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(r.full_name || 'User')}&background=3b82f6&color=fff&size=240`;
    }
    
    if (nameEl) nameEl.textContent = r.full_name || '-';
    if (emailEl) emailEl.textContent = r.email || '-';
    if (phoneEl) phoneEl.textContent = r.country_code ? `${r.country_code} ${String(r.phone||'').replace(r.country_code,'').trim()}` : (r.phone || '-');
    if (cnicEl) cnicEl.textContent = r.cnic || '-';
    if (addrEl) addrEl.textContent = r.address || '-';
    
    // Display current payment password from the server
    const profileRes = await fetch(`${apiBase}/user/profile?userId=${encodeURIComponent(userId)}`);
    const profileData = await profileRes.json();
    if (profileData && profileData.profile) {
      const pwdEl = document.getElementById('currentPaymentPwd');
      if (pwdEl) pwdEl.textContent = profileData.profile.paymentPassword || '123456';
    }

    const banner = document.getElementById('profileReadonlyBanner');
    if (banner) banner.style.display = stData?.status === 'approved' ? 'block' : 'none';
  } catch (err) {
    console.error('Profile load error:', err);
  }
}

/**
 * Main Initialization Logic.
 */
document.addEventListener('DOMContentLoaded', () => {
  const logoBrand = document.getElementById('logoBrand');
  if (logoBrand) logoBrand.onclick = (e) => { e.preventDefault(); window.location.href = '/'; };

  const homeBtn = document.getElementById('homeBtn');
  if (homeBtn) homeBtn.addEventListener('click', () => { window.location.href = '/dashboard.html'; });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userName');
    localStorage.removeItem('userId');
    window.location.href = '/';
  });

  const { userName } = getUserContext();
  const profileName = document.getElementById('profileName');
  if (profileName) profileName.textContent = userName;
  
  document.querySelectorAll('.nav-link[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) setActiveTab(tab);
    });
  });

  document.querySelectorAll('[data-open-wallet-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-open-wallet-action');
      setActiveTab('wallet');
      renderWalletForms(action);
      loadTransactions();
    });
  });

  document.querySelectorAll('[data-wallet-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderWalletForms(btn.getAttribute('data-wallet-tab'));
    });
  });

  const marketCurrency = document.getElementById('marketCurrency');
  if (marketCurrency) marketCurrency.addEventListener('change', () => {
    marketState.vs = marketCurrency.value || 'usd';
    loadMarketSnapshot();
  });
  
  const marketSearch = document.getElementById('marketSearch');
  if (marketSearch) {
    marketSearch.addEventListener('input', () => { loadMarketSnapshot(); });
    marketSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleMarketSearch();
    });
  }

  const marketSearchBtn = document.getElementById('marketSearchBtn');
  if (marketSearchBtn) {
    marketSearchBtn.addEventListener('click', handleMarketSearch);
  }

  // Handle Payment Password Update
  const updatePaymentPwdBtn = document.getElementById('updatePaymentPwdBtn');
  if (updatePaymentPwdBtn) {
    updatePaymentPwdBtn.addEventListener('click', async () => {
      const newPwdInput = document.getElementById('newPaymentPassword');
      const newPwd = newPwdInput ? newPwdInput.value.trim() : '';
      const { userId } = getUserContext();
      
      if (!newPwd || newPwd.length < 4) {
        if (window.showToast) showToast('Password must be at least 4 digits.', 'error');
        else alert('Password must be at least 4 digits.');
        return;
      }
      
      try {
        updatePaymentPwdBtn.disabled = true;
        updatePaymentPwdBtn.textContent = 'Updating...';
        
        const res = await fetch(`${apiBase}/user/profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, paymentPassword: newPwd })
        });
        
        const data = await res.json();
        if (data.success) {
          if (window.showToast) showToast('Payment password updated successfully!', 'success');
          else alert('Payment password updated successfully!');
          if (newPwdInput) newPwdInput.value = '';
          loadProfile(); // Refresh displayed password
        } else {
          throw new Error(data.error || 'Update failed');
        }
      } catch (err) {
        console.error('Update payment password error:', err);
        if (window.showToast) showToast(err.message, 'error');
        else alert(err.message);
      } finally {
        updatePaymentPwdBtn.disabled = false;
        updatePaymentPwdBtn.textContent = 'Update Password';
      }
    });
  }

  const prevBtn = document.getElementById('marketPrev');
  const nextBtn = document.getElementById('marketNext');
  if (prevBtn) prevBtn.addEventListener('click', () => { marketState.page = Math.max(1, (marketState.page || 1) - 1); loadMarketSnapshot(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { marketState.page = (marketState.page || 1) + 1; loadMarketSnapshot(); });

  loadProfile();
  loadWallet();
  loadMarketSnapshot();
  
  (async () => {
    const isFirstTime = await checkFirstTimeInvestor();
    const savedPath = localStorage.getItem('investorPath');
    
    if (isFirstTime) {
      const modal = document.getElementById('onboardingModal');
      if (modal) modal.style.display = 'flex';
      if (savedPath) renderStrategyDashboard(savedPath);
    } else if (savedPath) {
      renderStrategyDashboard(savedPath);
    }
  })();

  refreshAggregates();
  setActiveTab('dashboard');

  setInterval(loadMarketSnapshot, 30000);
  setInterval(refreshAggregates, 5000);
  setInterval(fetchLivePrices, 30000); // Live Market Auto-Update
  setInterval(() => {
    const walletTab = document.getElementById('tab-wallet');
    if (walletTab && !walletTab.hasAttribute('hidden')) {
      loadTransactions();
    }
  }, 30000);
});
