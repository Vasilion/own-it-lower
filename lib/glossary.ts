/**
 * Plain-English definitions for every figure the tool shows.
 *
 * Written for someone selling their first put, not for an options desk. Each entry
 * says what the number is and how to read it, never what to do about it.
 */
export const GLOSSARY = {
  strike: 'The price you agree to buy the shares at if the put is assigned.',
  dte: 'Days until the contract expires. Your cash is tied up until then.',
  delta:
    'A rough estimate of the chance the stock finishes below the strike and you end up buying the shares. 0.30 is roughly a 30% chance.',
  credit:
    'What you are paid per share for selling the put, using the bid. One contract covers 100 shares, so multiply by 100.',
  annualised:
    'The return on the cash you set aside if the put expires worthless, scaled to a full year so contracts of different lengths can be compared. You would not earn this every month.',
  buffer:
    'How far the stock can fall from today before you are underwater, counting the premium you collected.',
  ifAssigned:
    'Your real cost per share if you end up buying: the strike minus the premium you were paid.',
  iv: 'Implied volatility. How much movement option prices are expecting. Higher IV means bigger premiums, and usually more risk.',
  ivHv:
    'Implied volatility divided by how much the stock has actually moved lately. Above 1 means options are priced for more movement than the stock has delivered. Far above 1 often means an event like earnings is priced in.',
  ivRank:
    'Where today’s implied volatility sits against this stock’s own past year, from 0 (lowest) to 100 (highest). Needs about two months of daily history to compute.',
  oi: 'Open interest. How many of these contracts are open right now. More means an easier fill.',
  spread:
    'The gap between bid and ask as a share of the price. A wide spread means you give up more to get filled.',
  fit: 'How closely this contract matches the settings you picked, from 0 to 100. A match to your filters, not a rating of the trade.',
  setup:
    'How the stock itself scores today: business quality, whether it has pulled back to support, and how rich option premium is versus its own history.',
  quality: 'Business quality from 0 to 100: size, cash flow, balance sheet, growth and profitability.',
  discount:
    'How much the current price looks like a quality stock on sale (a pullback in an uptrend) rather than a stock breaking down.',
  collateral: 'The cash you set aside to cover buying 100 shares at the strike, less the premium received.',
  pe: 'Price to earnings. The share price divided by the last 12 months of earnings per share. Lower means you pay less for each dollar of profit.',
  forwardPe:
    'Price divided by the earnings analysts expect over the next 12 months. Lower than the trailing P/E means earnings are expected to grow.',
  dividendYield: 'Yearly dividends as a share of the price. You only collect it if you end up owning the shares.',
  marketCap: 'The total value of all the company’s shares.',
} as const

export type GlossaryKey = keyof typeof GLOSSARY
