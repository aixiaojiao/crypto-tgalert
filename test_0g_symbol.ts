#!/usr/bin/env npx ts-node

import { BinanceClient } from './src/services/binance';

async function test0GSymbol() {
  const client = new BinanceClient();

  console.log('Testing 0GUSDT symbol existence...');

  try {
    // Test 1: Check if symbol exists in futures
    console.log('\n1. Testing futures symbol validity...');
    const isFuturesValid = await client.isFuturesSymbolValid('0GUSDT');
    console.log(`0GUSDT in futures: ${isFuturesValid}`);

    // Test 2: Check if symbol exists in spot
    console.log('\n2. Testing spot symbol validity...');
    const isSpotValid = await client.isSymbolValid('0GUSDT');
    console.log(`0GUSDT in spot: ${isSpotValid}`);

    // Test 3: Try to get futures price
    if (isFuturesValid) {
      console.log('\n3. Testing futures price fetch...');
      try {
        const price = await client.getFuturesPrice('0GUSDT');
        console.log(`0GUSDT futures price: $${price}`);
      } catch (error) {
        console.log(`Failed to get futures price: ${(error as Error).message}`);
      }
    }

    // Test 4: Try to get spot price
    if (isSpotValid) {
      console.log('\n4. Testing spot price fetch...');
      try {
        const price = await client.getPrice('0GUSDT');
        console.log(`0GUSDT spot price: $${price}`);
      } catch (error) {
        console.log(`Failed to get spot price: ${(error as Error).message}`);
      }
    }

    // Test 5: List all trading symbols that start with "0"
    console.log('\n5. Looking for symbols starting with "0"...');
    try {
      const futuresSymbols = await client.getFuturesTradingSymbols();
      const zeroSymbols = futuresSymbols.filter(s => s.startsWith('0'));
      console.log(`Found symbols starting with "0": ${zeroSymbols.join(', ')}`);
    } catch (error) {
      console.log(`Failed to get trading symbols: ${(error as Error).message}`);
    }

  } catch (error) {
    console.error('Test failed:', error);
  }
}

test0GSymbol().then(() => {
  console.log('\nTest completed');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});