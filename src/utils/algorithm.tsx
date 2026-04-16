import { Text } from '@mantine/core';
import { ReactNode } from 'react';
import {
  ActivityLogRow,
  Algorithm,
  AlgorithmDataRow,
  AlgorithmSummary,
  CompressedAlgorithmDataRow,
  CompressedListing,
  CompressedObservations,
  CompressedOrder,
  CompressedOrderDepth,
  CompressedTrade,
  CompressedTradingState,
  ConversionObservation,
  Listing,
  Observation,
  Order,
  OrderDepth,
  Product,
  ProsperitySymbol,
  Trade,
  TradingState,
} from '../models.ts';
import { authenticatedAxios } from './axios.ts';

export class AlgorithmParseError extends Error {
  public constructor(public readonly node: ReactNode) {
    super('Failed to parse algorithm logs');
  }
}

function getColumnValues(columns: string[], indices: number[]): number[] {
  const values: number[] = [];

  for (const index of indices) {
    const value = columns[index];
    if (value !== '') {
      values.push(parseFloat(value));
    }
  }

  return values;
}

function getActivityLogs(logLines: string[]): ActivityLogRow[] {
  const headerIndex = logLines.indexOf('Activities log:');
  if (headerIndex === -1) {
    return [];
  }

  const rows: ActivityLogRow[] = [];

  for (let i = headerIndex + 2; i < logLines.length; i++) {
    const line = logLines[i];
    if (line === '') {
      break;
    }

    const columns = line.split(';');

    rows.push({
      day: Number(columns[0]),
      timestamp: Number(columns[1]),
      product: columns[2],
      bidPrices: getColumnValues(columns, [3, 5, 7]),
      bidVolumes: getColumnValues(columns, [4, 6, 8]),
      askPrices: getColumnValues(columns, [9, 11, 13]),
      askVolumes: getColumnValues(columns, [10, 12, 14]),
      midPrice: Number(columns[15]),
      profitLoss: Number(columns[16]),
    });
  }

  return rows;
}

function decompressListings(compressed: CompressedListing[]): Record<ProsperitySymbol, Listing> {
  const listings: Record<ProsperitySymbol, Listing> = {};

  for (const [symbol, product, denomination] of compressed) {
    listings[symbol] = {
      symbol,
      product,
      denomination,
    };
  }

  return listings;
}

function decompressOrderDepths(
  compressed: Record<ProsperitySymbol, CompressedOrderDepth>,
): Record<ProsperitySymbol, OrderDepth> {
  const orderDepths: Record<ProsperitySymbol, OrderDepth> = {};

  for (const [symbol, [buyOrders, sellOrders]] of Object.entries(compressed)) {
    orderDepths[symbol] = {
      buyOrders,
      sellOrders,
    };
  }

  return orderDepths;
}

function decompressTrades(compressed: CompressedTrade[]): Record<ProsperitySymbol, Trade[]> {
  const trades: Record<ProsperitySymbol, Trade[]> = {};

  for (const [symbol, price, quantity, buyer, seller, timestamp] of compressed) {
    if (trades[symbol] === undefined) {
      trades[symbol] = [];
    }

    trades[symbol].push({
      symbol,
      price,
      quantity,
      buyer,
      seller,
      timestamp,
    });
  }

  return trades;
}

function decompressObservations(compressed: CompressedObservations): Observation {
  const conversionObservations: Record<Product, ConversionObservation> = {};

  for (const [
    product,
    [bidPrice, askPrice, transportFees, exportTariff, importTariff, sugarPrice, sunlightIndex],
  ] of Object.entries(compressed[1])) {
    conversionObservations[product] = {
      bidPrice,
      askPrice,
      transportFees,
      exportTariff,
      importTariff,
      sugarPrice,
      sunlightIndex,
    };
  }

  return {
    plainValueObservations: compressed[0],
    conversionObservations,
  };
}

function decompressState(compressed: CompressedTradingState): TradingState {
  return {
    timestamp: compressed[0],
    traderData: compressed[1],
    listings: decompressListings(compressed[2]),
    orderDepths: decompressOrderDepths(compressed[3]),
    ownTrades: decompressTrades(compressed[4]),
    marketTrades: decompressTrades(compressed[5]),
    position: compressed[6],
    observations: decompressObservations(compressed[7]),
  };
}

function decompressOrders(compressed: CompressedOrder[]): Record<ProsperitySymbol, Order[]> {
  const orders: Record<ProsperitySymbol, Order[]> = {};

  for (const [symbol, price, quantity] of compressed) {
    if (orders[symbol] === undefined) {
      orders[symbol] = [];
    }

    orders[symbol].push({
      symbol,
      price,
      quantity,
    });
  }

  return orders;
}

function decompressDataRow(compressed: CompressedAlgorithmDataRow, sandboxLogs: string): AlgorithmDataRow {
  return {
    state: decompressState(compressed[0]),
    orders: decompressOrders(compressed[1]),
    conversions: compressed[2],
    traderData: compressed[3],
    algorithmLogs: compressed[4],
    sandboxLogs,
  };
}

function getAlgorithmData(logLines: string[]): AlgorithmDataRow[] {
  const headerIndex = logLines.indexOf('Sandbox logs:');
  if (headerIndex === -1) {
    return [];
  }

  const rows: AlgorithmDataRow[] = [];
  let nextSandboxLogs = '';

  const sandboxLogPrefix = '  "sandboxLog": ';
  const lambdaLogPrefix = '  "lambdaLog": ';

  for (let i = headerIndex + 1; i < logLines.length; i++) {
    const line = logLines[i];
    if (line.endsWith(':')) {
      break;
    }

    if (line.startsWith(sandboxLogPrefix)) {
      nextSandboxLogs = JSON.parse(line.substring(sandboxLogPrefix.length, line.length - 1)).trim();

      if (nextSandboxLogs.startsWith('Conversion request')) {
        const lastRow = rows[rows.length - 1];
        lastRow.sandboxLogs += (lastRow.sandboxLogs.length > 0 ? '\n' : '') + nextSandboxLogs;

        nextSandboxLogs = '';
      }

      continue;
    }

    if (!line.startsWith(lambdaLogPrefix) || line === '  "lambdaLog": "",') {
      continue;
    }

    const start = line.indexOf('[[');
    const end = line.lastIndexOf(']') + 1;

    try {
      const compressedDataRow = JSON.parse(JSON.parse('"' + line.substring(start, end) + '"'));
      rows.push(decompressDataRow(compressedDataRow, nextSandboxLogs));
    } catch (err) {
      console.log(line);
      console.error(err);

      throw new AlgorithmParseError(
        (
          <>
            <Text>Logs are in invalid format. Could not parse the following line:</Text>
            <Text>{line}</Text>
          </>
        ),
      );
    }
  }

  return rows;
}

export function parseAlgorithmLogs(logs: string, summary?: AlgorithmSummary): Algorithm {
  const logLines = logs.trim().split(/\r?\n/);

  const activityLogs = getActivityLogs(logLines);
  const data = getAlgorithmData(logLines);

  if (activityLogs.length === 0 && data.length === 0) {
    throw new AlgorithmParseError(
      (
        <Text>
          Logs are empty, either something went wrong with your submission or your backtester logs in a different format
          than Prosperity&apos;s submission environment.
        </Text>
      ),
    );
  }

  if (activityLogs.length === 0 || data.length === 0) {
    throw new AlgorithmParseError(
      /* prettier-ignore */
      <Text>Logs are in invalid format.</Text>,
    );
  }

  return {
    summary,
    activityLogs,
    data,
  };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result as string));
    reader.addEventListener('error', () => reject(new Error('FileReader emitted an error event')));
    reader.readAsText(file);
  });
}

export async function parseCsvData(files: File[]): Promise<Algorithm> {
  const pricesRows: {
    day: number;
    timestamp: number;
    product: string;
    bidPrices: number[];
    bidVolumes: number[];
    askPrices: number[];
    askVolumes: number[];
    midPrice: number;
    profitLoss: number;
  }[] = [];

  const tradesRows: {
    day: number;
    timestamp: number;
    symbol: string;
    buyer: string;
    seller: string;
    price: number;
    quantity: number;
  }[] = [];

  for (const file of files) {
    const text = await readFileAsText(file);
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) continue;

    const header = lines[0].toLowerCase();

    if (header.includes('mid_price')) {
      // prices CSV: day;timestamp;product;bid_price_1;bid_volume_1;...;mid_price;profit_and_loss
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';');
        if (cols.length < 16) continue;

        pricesRows.push({
          day: Number(cols[0]),
          timestamp: Number(cols[1]),
          product: cols[2],
          bidPrices: getColumnValues(cols, [3, 5, 7]),
          bidVolumes: getColumnValues(cols, [4, 6, 8]),
          askPrices: getColumnValues(cols, [9, 11, 13]),
          askVolumes: getColumnValues(cols, [10, 12, 14]),
          midPrice: Number(cols[15]),
          profitLoss: Number(cols[16]) || 0,
        });
      }
    } else if (header.includes('buyer')) {
      // trades CSV: timestamp;buyer;seller;symbol;currency;price;quantity
      // Need to extract day from filename (e.g. "prices_round_1_day_-2.csv" or "trades_round_1_day_-2.csv")
      const dayMatch = file.name.match(/day_(-?\d+)/);
      const day = dayMatch ? Number(dayMatch[1]) : 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';');
        if (cols.length < 7) continue;

        tradesRows.push({
          day,
          timestamp: Number(cols[0]),
          buyer: cols[1],
          seller: cols[2],
          symbol: cols[3],
          price: Number(cols[5]),
          quantity: Number(cols[6]),
        });
      }
    }
  }

  if (pricesRows.length === 0) {
    throw new AlgorithmParseError(<Text>No prices CSV data found. Please include at least one prices CSV file.</Text>);
  }

  const days = [...new Set(pricesRows.map(r => r.day))].sort((a, b) => a - b);
  const minDay = days[0];

  const toNormalized = (day: number, timestamp: number) => (day - minDay) * 1_000_000 + timestamp;

  // Build activityLogs
  const activityLogs: ActivityLogRow[] = pricesRows.map(r => ({
    day: r.day,
    timestamp: toNormalized(r.day, r.timestamp),
    product: r.product,
    bidPrices: r.bidPrices,
    bidVolumes: r.bidVolumes,
    askPrices: r.askPrices,
    askVolumes: r.askVolumes,
    midPrice: r.midPrice,
    profitLoss: r.profitLoss,
  }));

  // Group trades by normalizedTimestamp + symbol
  const tradesByTimestamp = new Map<number, Map<string, Trade[]>>();
  for (const t of tradesRows) {
    const ts = toNormalized(t.day, t.timestamp);
    if (!tradesByTimestamp.has(ts)) tradesByTimestamp.set(ts, new Map());
    const bySymbol = tradesByTimestamp.get(ts)!;
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push({
      symbol: t.symbol,
      price: t.price,
      quantity: t.quantity,
      buyer: t.buyer,
      seller: t.seller,
      timestamp: ts,
    });
  }

  // Group prices rows by normalizedTimestamp
  const pricesByTimestamp = new Map<
    number,
    {
      product: string;
      bidPrices: number[];
      bidVolumes: number[];
      askPrices: number[];
      askVolumes: number[];
    }[]
  >();
  for (const r of pricesRows) {
    const ts = toNormalized(r.day, r.timestamp);
    if (!pricesByTimestamp.has(ts)) pricesByTimestamp.set(ts, []);
    pricesByTimestamp.get(ts)!.push(r);
  }

  const sortedTimestamps = [...pricesByTimestamp.keys()].sort((a, b) => a - b);

  const data: AlgorithmDataRow[] = sortedTimestamps.map(ts => {
    const products = pricesByTimestamp.get(ts)!;

    const listings: Record<ProsperitySymbol, Listing> = {};
    const orderDepths: Record<ProsperitySymbol, OrderDepth> = {};

    for (const p of products) {
      listings[p.product] = { symbol: p.product, product: p.product, denomination: 'SEASHELLS' };

      const buyOrders: Record<number, number> = {};
      for (let i = 0; i < p.bidPrices.length; i++) {
        buyOrders[p.bidPrices[i]] = p.bidVolumes[i];
      }

      const sellOrders: Record<number, number> = {};
      for (let i = 0; i < p.askPrices.length; i++) {
        sellOrders[p.askPrices[i]] = -p.askVolumes[i];
      }

      orderDepths[p.product] = { buyOrders, sellOrders };
    }

    const marketTrades: Record<ProsperitySymbol, Trade[]> = {};
    const tradesAtTs = tradesByTimestamp.get(ts);
    if (tradesAtTs) {
      for (const [symbol, trades] of tradesAtTs) {
        marketTrades[symbol] = trades;
      }
    }

    return {
      state: {
        timestamp: ts,
        traderData: '',
        listings,
        orderDepths,
        ownTrades: {},
        marketTrades,
        position: {},
        observations: { plainValueObservations: {}, conversionObservations: {} },
      },
      orders: {},
      conversions: 0,
      traderData: '',
      algorithmLogs: '',
      sandboxLogs: '',
    };
  });

  return { activityLogs, data };
}

export async function getAlgorithmLogsUrl(algorithmId: string): Promise<string> {
  const urlResponse = await authenticatedAxios.get(
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/submission/logs/${algorithmId}`,
  );

  return urlResponse.data;
}

function downloadFile(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = new URL(url).pathname.split('/').pop()!;
  link.target = '_blank';
  link.rel = 'noreferrer';

  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadAlgorithmLogs(algorithmId: string): Promise<void> {
  const logsUrl = await getAlgorithmLogsUrl(algorithmId);
  downloadFile(logsUrl);
}

export async function downloadAlgorithmResults(algorithmId: string): Promise<void> {
  const detailsResponse = await authenticatedAxios.get(
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/results/tutorial/${algorithmId}`,
  );

  downloadFile(detailsResponse.data.algo.summary.activitiesLog);
}
