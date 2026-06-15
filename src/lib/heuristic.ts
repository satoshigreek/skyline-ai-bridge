import type { ChainKey } from "./chains";
import type { Intent } from "./intent";

// Regex fallback parser — used when no ANTHROPIC_API_KEY is configured or the
// LLM path fails. Deliberately conservative: when it can't tell, it asks a
// clarifying question rather than guessing.

const TOKEN_WORDS: Record<string, string> = {
  usdc: "USDC",
  usdt: "USDT",
  dai: "DAI",
  eth: "ETH",
  weth: "WETH",
  btc: "BTC",
  wbtc: "WBTC",
  cbbtc: "cbBTC",
  near: "NEAR",
  wnear: "NEAR",
  sol: "SOL",
  ada: "ADA",
  ap3x: "AP3X",
  bap3x: "bAP3X",
  bnap3x: "bnAP3X",
  arb: "ARB",
  op: "OP",
  pol: "POL",
  matic: "POL",
  avax: "AVAX",
  bnb: "BNB",
  // Chain names users employ as token names ("swap usdc to bitcoin" = BTC).
  bitcoin: "BTC",
  solana: "SOL",
  cardano: "ADA",
};

// Tokens whose destination chain is unambiguous when used as tokenOut.
const TOKEN_HOME_CHAIN: Record<string, ChainKey> = {
  NEAR: "near",
  BTC: "bitcoin",
  SOL: "solana",
  ADA: "cardano",
  AP3X: "nexus",
  AVAX: "avalanche",
  BNB: "bsc",
};

// Ordered: more specific phrases first (e.g. "apex fusion" before "base").
const CHAIN_PATTERNS: Array<[RegExp, ChainKey]> = [
  // Apex Fusion internal chains.
  [/\bprime\b/i, "prime"],
  [/\bvector\b/i, "vector"],
  [/\bnexus\b/i, "nexus"],
  // "Apex Fusion" / "Apex" / "AP3X" as a from/to/on slot means the Nexus EVM
  // chain. (chainAt only runs on slot text, so a standalone "ap3x" token mention
  // elsewhere is still parsed as the token.)
  [/apex\s*fusion|apexfusion|\bapex\b|\bap3x\b/i, "nexus"],
  [/\bbase\b/i, "base"],
  [/\bnear\s+(protocol|chain|network)\b|\bnear\b/i, "near"],
  [/\bethereum\b|\beth\s+mainnet\b|\bmainnet\b/i, "ethereum"],
  [/\barbitrum\b/i, "arbitrum"],
  [/\bsolana\b/i, "solana"],
  [/\bbitcoin\b/i, "bitcoin"],
  [/\bbsc\b|\bbnb\s*chain\b|\bbinance\b/i, "bsc"],
  [/\boptimism\b/i, "optimism"],
  [/\bpolygon\b|\bmatic\s+(chain|network)\b/i, "polygon"],
  [/\bavalanche\b/i, "avalanche"],
  [/\bcardano\b/i, "cardano"],
];

function chainAt(word: string): ChainKey | null {
  for (const [re, key] of CHAIN_PATTERNS) {
    if (re.test(word)) return key;
  }
  return null;
}

export function heuristicParse(rawPrompt: string): Intent {
  let text = rawPrompt.toLowerCase().replace(/(\d),(\d)/g, "$1$2"); // 1,000 -> 1000

  // 1. Recipient first (so its digits/words don't pollute later extraction).
  let recipient: string | null = null;
  const evmAddr = rawPrompt.match(/0x[a-fA-F0-9]{40}/);
  const nearAddr = rawPrompt.match(/\b([a-z0-9_-]+\.near)\b/i);
  if (evmAddr) {
    recipient = evmAddr[0];
    text = text.replace(evmAddr[0].toLowerCase(), " <recipient> ");
  } else if (nearAddr) {
    recipient = nearAddr[1].toLowerCase();
    text = text.replace(nearAddr[1].toLowerCase(), " <recipient> ");
  }

  // 2. Quote-only intent.
  const quoteOnly =
    /\b(how much|what would it cost|what does it cost|what'?s the (cost|fee|price)|quote( me)?|estimate)\b/.test(
      text,
    );

  // 3. Amount side: "receive/get/want N TOKEN" => the amount is the OUTPUT.
  const amountSide: "in" | "out" =
    /\b(receive|get( me)?|want|need)\b[^.]{0,24}?\d/.test(text) &&
    !/\b(swap|sell|send|pay|bridge|move|transfer|convert)\b[^.]{0,16}?\d/.test(text)
      ? "out"
      : "in";

  // 4. Amount: a number not embedded in a word (so the "3" in ap3x never matches).
  const amountMatch = text.match(/(?<![a-z0-9.])(\d+(?:\.\d+)?)(?![0-9a-z])/);
  const amount = amountMatch ? amountMatch[1] : null;

  // 5. Chain roles from syntax. Scan ALL candidates ("cost to move X to near"
  //    has two "to"s — only the one naming a chain counts) and consume the
  //    phrase so "to near" the chain doesn't double as NEAR the token.
  let fromChain: ChainKey | null = null;
  let toChain: ChainKey | null = null;

  const firstChainSlot = (
    re: RegExp,
  ): { phrase: string; word: string; chain: ChainKey } | null => {
    for (const m of text.matchAll(re)) {
      const c = chainAt(m[1]);
      if (c) return { phrase: m[0], word: m[1].split(/\s+/)[0], chain: c };
    }
    return null;
  };

  const fromSlot = firstChainSlot(
    /\bfrom\s+(apex\s*fusion|apexfusion|[a-z0-9]+(?:\s+(?:chain|network|protocol|mainnet))?)/g,
  );
  if (fromSlot) {
    fromChain = fromSlot.chain;
    text = text.replace(fromSlot.phrase, " ");
  }

  let toChainWord: string | null = null;
  const toSlot = firstChainSlot(
    /\b(?:to|onto)\s+(apex\s*fusion|apexfusion|[a-z0-9]+(?:\s+(?:chain|network|protocol|mainnet))?)/g,
  );
  if (toSlot) {
    toChain = toSlot.chain;
    toChainWord = toSlot.word;
    text = text.replace(toSlot.phrase, " ");
  }

  const onSlot = firstChainSlot(
    /\bon\s+(apex\s*fusion|apexfusion|[a-z0-9]+(?:\s+(?:chain|network|protocol|mainnet))?)/g,
  );
  if (onSlot) {
    const c = onSlot.chain;
    // "send … to <recipient> on X" and "receive … on X" => destination;
    // otherwise "on X" says where the asset currently lives (source).
    if (recipient && !toChain) toChain = c;
    else if (amountSide === "out" && !toChain) toChain = c;
    else if (!fromChain) fromChain = c;
    else if (!toChain) toChain = c;
    text = text.replace(onSlot.phrase, " ");
  }

  // 6. Explicit output token: "for/into Y", "buy Y with X", "sell X for Y".
  //    Scan all candidates — "fees for bridging 50 usdc" must not eat "for".
  let tokenOut: string | null = null;
  for (const m of text.matchAll(/\b(?:for|into)\s+([a-z0-9]+)\b/g)) {
    if (TOKEN_WORDS[m[1]]) {
      tokenOut = TOKEN_WORDS[m[1]];
      text = text.replace(m[0], " ");
      break;
    }
  }
  let buyTokenIn: string | null = null;
  // "buy NEAR with 100 USDC" — tolerate an amount between "with" and the token.
  const buyMatch = text.match(
    /\bbuy\s+([a-z0-9]+)\b[^.]*?\bwith\s+(?:[\d.]+\s+)?([a-z0-9]+)\b/,
  );
  if (buyMatch && TOKEN_WORDS[buyMatch[1]] && TOKEN_WORDS[buyMatch[2]]) {
    tokenOut = TOKEN_WORDS[buyMatch[1]];
    buyTokenIn = TOKEN_WORDS[buyMatch[2]];
    text = text.replace(buyMatch[0], " ");
  }

  // 7. Remaining token mentions in order of appearance.
  const seen: string[] = [];
  const wordRe = /[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(text)) !== null) {
    const t = TOKEN_WORDS[m[0]];
    if (t && !seen.includes(t)) seen.push(t);
  }
  let tokenIn: string | null = buyTokenIn ?? seen[0] ?? null;
  if (!tokenOut && seen.length > 1 && seen[1] !== tokenIn) tokenOut = seen[1];
  // "swap USDC to NEAR": under a swap verb the destination word doubles as the
  // output token when the two coincide (NEAR/SOL/ADA/AP3X…).
  if (
    !tokenOut &&
    toChainWord &&
    TOKEN_WORDS[toChainWord] &&
    TOKEN_WORDS[toChainWord] !== tokenIn &&
    /\b(swap|convert|trade|exchange|sell|turn)\b/.test(rawPrompt.toLowerCase())
  ) {
    tokenOut = TOKEN_WORDS[toChainWord];
  }
  if (tokenOut === tokenIn) tokenOut = null;
  // When the amount belongs to the output ("receive 100 USDC"), the first
  // token mentioned is the OUTPUT, not the input.
  if (amountSide === "out" && tokenIn && !tokenOut) {
    tokenOut = tokenIn;
    tokenIn = null;
  }

  // 8. Inferences.
  if (!toChain && recipient?.endsWith(".near")) toChain = "near";
  if (!toChain && tokenOut && TOKEN_HOME_CHAIN[tokenOut]) {
    toChain = TOKEN_HOME_CHAIN[tokenOut];
  }
  // bAP3X (Base) / bnAP3X (BNB) bridging defaults toward Apex Fusion.
  if (!toChain && (tokenIn === "bAP3X" || tokenIn === "bnAP3X")) toChain = "nexus";
  if (!fromChain && tokenIn === "bnAP3X") fromChain = "bsc";

  let defaultedFrom = false;
  if (!fromChain) {
    // Base-first app: an unstated source means the connected Base wallet.
    fromChain = "base";
    defaultedFrom = true;
  }

  // 9. Action.
  const verbSend = /\b(send|pay|transfer)\b/.test(text) && recipient !== null;
  const verbSwap =
    /\b(swap|convert|trade|exchange|sell|buy|turn)\b/.test(text) ||
    (tokenOut !== null && tokenOut !== tokenIn);
  let action: Intent["action"];
  if (quoteOnly) action = "quote_only";
  else if (verbSwap && tokenOut) action = "swap";
  else if (verbSend) action = "send";
  else action = "bridge";

  // 10. Clarify when required pieces are missing.
  let clarifyingQuestion: string | null = null;
  if (!tokenIn && !(amountSide === "out" && tokenOut)) {
    clarifyingQuestion = "Which token do you want to use?";
  } else if (!amount) {
    const t = tokenIn ?? tokenOut ?? "tokens";
    clarifyingQuestion = `How much ${t} do you want to ${
      action === "swap" ? "swap" : action === "send" ? "send" : "bridge"
    }?`;
  } else if (!toChain) {
    clarifyingQuestion = "Which destination chain should this go to?";
  } else if (amountSide === "out" && !tokenIn) {
    clarifyingQuestion = `Which token do you want to pay with to receive ${amount} ${tokenOut}?`;
  }

  // 11. Confidence: explicit fields found vs needed.
  let score = 0.3;
  if (tokenIn) score += 0.2;
  if (amount) score += 0.2;
  if (toChain) score += 0.15;
  if (!defaultedFrom) score += 0.1;
  if (clarifyingQuestion) score = Math.min(score, 0.35);
  const confidence = Math.min(0.9, score); // heuristic never claims LLM-level certainty

  return {
    action,
    tokenIn,
    tokenOut,
    amount,
    amountSide,
    fromChain,
    toChain,
    recipient,
    confidence,
    clarifyingQuestion,
  };
}
