/**
 * Liquid optionable names outside the S&P 500, plus the major index ETFs.
 *
 * The S&P 500 alone is too narrow a universe for this product. It excludes large,
 * heavily-traded US names that simply are not index members (SOFI), most foreign
 * issuers regardless of size (TSM, ASML, NVO), and every ETF — even though index
 * ETFs are among the most common cash-secured put underlyings there are.
 *
 * Selection rule: optionable, liquid enough for a real options market, and broadly
 * above the $10B floor. Nothing here is pre-vetted for quality — the fundamentals
 * gate does that, and names that fail it still appear, marked, rather than being
 * silently dropped.
 *
 * ETFs deliberately included. Their quality components abstain (an index fund has
 * no debt/equity ratio), so they are scored on discount and IV alone, which is the
 * right question to ask about an index.
 *
 * Hand-maintained. Review when index membership shifts.
 */

import type { UniverseMember } from './universe'

export const SUPPLEMENTAL: UniverseMember[] = [
  // --- US equities not in the S&P 500 -------------------------------------
  { symbol: 'SOFI', name: 'SoFi Technologies', sector: 'Financials' },
  { symbol: 'RIVN', name: 'Rivian Automotive', sector: 'Consumer Discretionary' },
  { symbol: 'LCID', name: 'Lucid Group', sector: 'Consumer Discretionary' },
  { symbol: 'RBLX', name: 'Roblox', sector: 'Communication Services' },
  { symbol: 'SNAP', name: 'Snap', sector: 'Communication Services' },
  { symbol: 'PINS', name: 'Pinterest', sector: 'Communication Services' },
  { symbol: 'LYFT', name: 'Lyft', sector: 'Industrials' },
  { symbol: 'CHWY', name: 'Chewy', sector: 'Consumer Discretionary' },
  { symbol: 'AFRM', name: 'Affirm Holdings', sector: 'Financials' },
  { symbol: 'TOST', name: 'Toast', sector: 'Information Technology' },
  { symbol: 'DKNG', name: 'DraftKings', sector: 'Consumer Discretionary' },
  { symbol: 'CVNA', name: 'Carvana', sector: 'Consumer Discretionary' },
  { symbol: 'HIMS', name: 'Hims & Hers Health', sector: 'Health Care' },
  { symbol: 'U', name: 'Unity Software', sector: 'Information Technology' },
  { symbol: 'PATH', name: 'UiPath', sector: 'Information Technology' },
  { symbol: 'SNOW', name: 'Snowflake', sector: 'Information Technology' },
  { symbol: 'MDB', name: 'MongoDB', sector: 'Information Technology' },
  { symbol: 'ZS', name: 'Zscaler', sector: 'Information Technology' },
  { symbol: 'NET', name: 'Cloudflare', sector: 'Information Technology' },
  { symbol: 'S', name: 'SentinelOne', sector: 'Information Technology' },
  { symbol: 'OKTA', name: 'Okta', sector: 'Information Technology' },
  { symbol: 'TWLO', name: 'Twilio', sector: 'Information Technology' },
  { symbol: 'MSTR', name: 'MicroStrategy', sector: 'Information Technology' },
  { symbol: 'MARA', name: 'MARA Holdings', sector: 'Financials' },
  { symbol: 'RIOT', name: 'Riot Platforms', sector: 'Financials' },
  { symbol: 'CLSK', name: 'CleanSpark', sector: 'Financials' },
  { symbol: 'IONQ', name: 'IonQ', sector: 'Information Technology' },
  { symbol: 'ARM', name: 'Arm Holdings', sector: 'Information Technology' },
  { symbol: 'ASTS', name: 'AST SpaceMobile', sector: 'Communication Services' },
  { symbol: 'RKLB', name: 'Rocket Lab', sector: 'Industrials' },
  { symbol: 'JOBY', name: 'Joby Aviation', sector: 'Industrials' },
  { symbol: 'ACHR', name: 'Archer Aviation', sector: 'Industrials' },
  { symbol: 'OKLO', name: 'Oklo', sector: 'Utilities' },
  { symbol: 'SMR', name: 'NuScale Power', sector: 'Utilities' },
  { symbol: 'TLN', name: 'Talen Energy', sector: 'Utilities' },
  { symbol: 'CELH', name: 'Celsius Holdings', sector: 'Consumer Staples' },
  { symbol: 'ELF', name: 'e.l.f. Beauty', sector: 'Consumer Staples' },
  { symbol: 'DUOL', name: 'Duolingo', sector: 'Consumer Discretionary' },
  { symbol: 'CAVA', name: 'CAVA Group', sector: 'Consumer Discretionary' },
  { symbol: 'PLNT', name: 'Planet Fitness', sector: 'Consumer Discretionary' },

  // --- Foreign issuers and ADRs -------------------------------------------
  { symbol: 'TSM', name: 'Taiwan Semiconductor', sector: 'Information Technology' },
  { symbol: 'ASML', name: 'ASML Holding', sector: 'Information Technology' },
  { symbol: 'NVO', name: 'Novo Nordisk', sector: 'Health Care' },
  { symbol: 'SHOP', name: 'Shopify', sector: 'Information Technology' },
  { symbol: 'SE', name: 'Sea Limited', sector: 'Consumer Discretionary' },
  { symbol: 'MELI', name: 'MercadoLibre', sector: 'Consumer Discretionary' },
  { symbol: 'BABA', name: 'Alibaba Group', sector: 'Consumer Discretionary' },
  { symbol: 'JD', name: 'JD.com', sector: 'Consumer Discretionary' },
  { symbol: 'PDD', name: 'PDD Holdings', sector: 'Consumer Discretionary' },
  { symbol: 'NIO', name: 'NIO', sector: 'Consumer Discretionary' },
  { symbol: 'BIDU', name: 'Baidu', sector: 'Communication Services' },
  { symbol: 'GRAB', name: 'Grab Holdings', sector: 'Industrials' },
  { symbol: 'NU', name: 'Nu Holdings', sector: 'Financials' },
  { symbol: 'SONY', name: 'Sony Group', sector: 'Consumer Discretionary' },
  { symbol: 'TM', name: 'Toyota Motor', sector: 'Consumer Discretionary' },
  { symbol: 'RY', name: 'Royal Bank of Canada', sector: 'Financials' },
  { symbol: 'TD', name: 'Toronto-Dominion Bank', sector: 'Financials' },
  { symbol: 'BHP', name: 'BHP Group', sector: 'Materials' },
  { symbol: 'RIO', name: 'Rio Tinto', sector: 'Materials' },
  { symbol: 'VALE', name: 'Vale', sector: 'Materials' },
  { symbol: 'HDB', name: 'HDFC Bank', sector: 'Financials' },
  { symbol: 'IBN', name: 'ICICI Bank', sector: 'Financials' },
  { symbol: 'INFY', name: 'Infosys', sector: 'Information Technology' },
  { symbol: 'STLA', name: 'Stellantis', sector: 'Consumer Discretionary' },
  { symbol: 'UL', name: 'Unilever', sector: 'Consumer Staples' },
  { symbol: 'BUD', name: 'Anheuser-Busch InBev', sector: 'Consumer Staples' },
  { symbol: 'SAP', name: 'SAP', sector: 'Information Technology' },
  { symbol: 'AZN', name: 'AstraZeneca', sector: 'Health Care' },
  { symbol: 'GSK', name: 'GSK', sector: 'Health Care' },
  { symbol: 'NVS', name: 'Novartis', sector: 'Health Care' },
  { symbol: 'SNY', name: 'Sanofi', sector: 'Health Care' },
  { symbol: 'SHEL', name: 'Shell', sector: 'Energy' },
  { symbol: 'BP', name: 'BP', sector: 'Energy' },
  { symbol: 'TTE', name: 'TotalEnergies', sector: 'Energy' },
  { symbol: 'EQNR', name: 'Equinor', sector: 'Energy' },

  // --- Index and sector ETFs ----------------------------------------------
  // Quality components abstain for these; they score on discount and IV, which is
  // the only sensible question to ask about an index.
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'ETF — Broad Market' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', sector: 'ETF — Broad Market' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', sector: 'ETF — Broad Market' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', sector: 'ETF — Broad Market' },
  { symbol: 'EEM', name: 'iShares MSCI Emerging Markets ETF', sector: 'ETF — International' },
  { symbol: 'EFA', name: 'iShares MSCI EAFE ETF', sector: 'ETF — International' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', sector: 'ETF — Commodity' },
  { symbol: 'SLV', name: 'iShares Silver Trust', sector: 'ETF — Commodity' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', sector: 'ETF — Fixed Income' },
  { symbol: 'HYG', name: 'iShares iBoxx High Yield Corporate Bond ETF', sector: 'ETF — Fixed Income' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'XLV', name: 'Health Care Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'XLI', name: 'Industrial Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'XLP', name: 'Consumer Staples Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'XLU', name: 'Utilities Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'XLY', name: 'Consumer Discretionary Select Sector SPDR', sector: 'ETF — Sector' },
  { symbol: 'SMH', name: 'VanEck Semiconductor ETF', sector: 'ETF — Sector' },
  { symbol: 'XBI', name: 'SPDR S&P Biotech ETF', sector: 'ETF — Sector' },
  { symbol: 'KRE', name: 'SPDR S&P Regional Banking ETF', sector: 'ETF — Sector' },
  { symbol: 'ARKK', name: 'ARK Innovation ETF', sector: 'ETF — Thematic' },
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust', sector: 'ETF — Digital Assets' },
]
