#!/usr/bin/env node

// ─────────────────────────────────────────────
// WHAT IS THIS FILE?
//
// This tool shows you how an LLM breaks your
// text into "tokens" before it reads it.
//
// Example:
//   You type  →  "Hello world"
//   LLM sees  →  ["Hello", " world"]  (2 tokens)
//
// Run it like this:
//   node tokenizer.js "your text here"
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// TERMINAL COLORS
//
// These are special codes your terminal understands.
// They change the background color of text.
// We use them to paint each token a different color
// so you can visually see where one token ends
// and the next one begins.
// ─────────────────────────────────────────────

const COLOR_LIST = [
  "\x1b[48;5;117m\x1b[30m",   // light blue background
  "\x1b[48;5;120m\x1b[30m",   // light green background
  "\x1b[48;5;216m\x1b[30m",   // light orange background
  "\x1b[48;5;183m\x1b[30m",   // light purple background
  "\x1b[48;5;228m\x1b[30m",   // light yellow background
  "\x1b[48;5;210m\x1b[30m",   // light red background
  "\x1b[48;5;159m\x1b[30m",   // light cyan background
];

const COLOR_RESET = "\x1b[0m";   // turn off color, go back to normal
const BOLD        = "\x1b[1m";   // make text bold
const DIM         = "\x1b[2m";   // make text look faded


// ─────────────────────────────────────────────
// STEP 1 — SPLIT TEXT INTO ROUGH CHUNKS
//
// Before we do any real tokenizing, we split the
// input into rough pieces using a regex pattern.
//
// Why? Because we want to handle things like:
//   - "isn't"  →  ["isn", "'t"]   contractions stay together
//   - "hello!" →  ["hello", "!"]  punctuation is separate
//   - " world" →  [" world"]      space sticks to the word after it
//
// This is the exact same regex GPT-2 uses.
// ─────────────────────────────────────────────

const SPLIT_PATTERN = /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu;


// ─────────────────────────────────────────────
// STEP 2 — BUILD A BYTE MAP
//
// LLMs don't work with letters directly.
// They work with BYTES (numbers 0–255).
//
// The problem: some bytes have no readable symbol.
// For example, byte 32 is a space — hard to display.
//
// The fix: we map every byte to a unique readable
// unicode character. This way EVERYTHING is printable.
//
// The most noticeable mapping:
//   space (byte 32)  →  Ġ
//
// That's why tokens look like "Ġhello" instead of " hello".
// The Ġ just means "this token starts with a space".
// ─────────────────────────────────────────────

function buildByteMap() {

  // start with bytes that already look fine as characters
  // these are standard printable ASCII and some latin characters
  const niceBytes = [
    ...makeRange(33, 127),    // ! " # $ ... ~  (bytes 33 to 126)
    ...makeRange(161, 173),   // ¡ ¢ £ ... ¬   (bytes 161 to 172)
    ...makeRange(174, 256),   // ® ¯ ° ... ÿ   (bytes 174 to 255)
  ];

  // the mapped characters start the same as the bytes
  const mappedChars = [...niceBytes];

  // now handle the bytes that were NOT in the nice list above
  // (space=32, tab=9, newline=10, null=0, etc.)
  // we give each one a unique character above 256 so it doesn't clash
  let nextAvailableChar = 256;
  for (let byteValue = 0; byteValue < 256; byteValue++) {
    if (!niceBytes.includes(byteValue)) {
      niceBytes.push(byteValue);
      mappedChars.push(nextAvailableChar);
      nextAvailableChar++;
    }
  }

  // build the final lookup table
  // example entries:  32 → 'Ġ',   65 → 'A',   10 → 'Ċ'
  const byteToChar = {};
  niceBytes.forEach((byteVal, index) => {
    byteToChar[byteVal] = String.fromCodePoint(mappedChars[index]);
  });

  return byteToChar;
}

// small helper — makes an array of numbers from 'start' up to (but not including) 'end'
function makeRange(start, end) {
  return Array.from({ length: end - start }, (_, i) => start + i);
}

// build the map once and reuse it
const BYTE_MAP = buildByteMap();


// ─────────────────────────────────────────────
// HELPER — convert one word into byte symbols
//
// Takes a string like " the"
// Returns an array like ['Ġ', 't', 'h', 'e']
//
// How:
//   1. encode the string to raw bytes using UTF-8
//   2. look up each byte in BYTE_MAP
// ─────────────────────────────────────────────

function wordToByteSymbols(word) {
  const rawBytes = Buffer.from(word, "utf8");   // e.g. " the" → [32, 116, 104, 101]
  const symbols = [];
  for (const byte of rawBytes) {
    symbols.push(BYTE_MAP[byte]);               // look up each byte in our map
  }
  return symbols;
}


// ─────────────────────────────────────────────
// STEP 3 — BPE MERGE RULES
//
// BPE = Byte Pair Encoding
//
// The idea is simple:
//   Start with individual characters.
//   Find the most common pair.
//   Merge them into one token.
//   Repeat.
//
// Example:
//   ['t','h','e'] → apply ('t','h') merge → ['th','e']
//   ['th','e']    → apply ('th','e') merge → ['the']
//   "the" is now a single token!
//
// Real GPT-2 has 50,000 such merge rules learned from
// training on billions of words. We use a small sample
// just to show how it works.
//
// The ORDER of this list matters — earlier merges run
// first, and later merges can use their results.
// ─────────────────────────────────────────────

const MERGE_RULES = [
  // space + single letter  (remember: space = Ġ in our byte map)
  // these are first because a space followed by a letter is very common
  ["Ġ","t"], ["Ġ","a"], ["Ġ","s"], ["Ġ","i"], ["Ġ","o"],
  ["Ġ","w"], ["Ġ","b"], ["Ġ","h"], ["Ġ","f"], ["Ġ","c"],
  ["Ġ","n"], ["Ġ","e"], ["Ġ","p"], ["Ġ","l"], ["Ġ","m"],
  ["Ġ","g"], ["Ġ","r"], ["Ġ","d"], ["Ġ","u"], ["Ġ","v"],

  // common letter pairs in English
  ["t","h"],        // th
  ["th","e"],       // the  ← uses the result of the line above
  ["i","n"],        // in
  ["e","r"],        // er
  ["a","n"],        // an
  ["r","e"],        // re
  ["o","n"],        // on
  ["Ġt","he"],      // Ġthe  (the whole word "the" as one token)
  ["Ġt","o"],       // Ġto
  ["Ġa","nd"],      // Ġand
  ["Ġi","s"],       // Ġis
  ["Ġi","n"],       // Ġin
  ["o","r"],        // or
  ["a","t"],        // at
  ["e","n"],        // en
  ["i","t"],        // it
  ["e","s"],        // es
  ["Ġw","ith"],     // Ġwith
  ["a","l"],        // al
  ["Ġo","f"],       // Ġof
  ["Ġf","or"],      // Ġfor
  ["o","f"],        // of
  ["Ġh","as"],      // Ġhas
  ["t","i"],        // ti
  ["Ġb","e"],       // Ġbe
  ["e","d"],        // ed
  ["n","t"],        // nt
  ["Ġ","T"], ["Ġ","I"], ["Ġ","A"],
  ["a","r"], ["Ġ","W"], ["i","c"], ["i","n"], ["l","l"],
  ["Ġn","ot"], ["Ġs","o"], ["a","s"], ["t","s"], ["i","o"],
  ["Ġw","as"], ["c","h"], ["Ġy","ou"], ["e","c"], ["e","l"],
  ["l","e"], ["s","t"], ["Ġ","C"], ["a","c"], ["Ġth","at"],
  ["p","r"], ["o","t"], ["u","r"], ["Ġ","M"], ["Ġ","S"],
  ["i","l"], ["k","e"], ["Ġ","H"], ["r","o"], ["Ġ","P"],
  ["a","g"], ["Ġ","N"], ["Ġ","L"], ["Ġ","D"], ["o","w"],
  ["Ġ","R"], ["Ġ","F"], ["Ġ","G"], ["Ġ","E"], ["Ġ","O"],
  ["Ġ","Y"], ["Ġ","B"], ["Ġ","J"], ["Ġ","K"],
  ["i","ng"],       // ing — very common English suffix
  ["Ġs","t"], ["Ġs","e"], ["Ġt","r"], ["Ġc","on"], ["Ġh","e"],
  ["m","o"], ["l","y"], ["o","l"],
  ["Ġ","1"], ["Ġ","2"], ["Ġ","3"],   // space + digit
  ["1","0"], ["0","0"],               // number pairs like 10, 100
];


// ─────────────────────────────────────────────
// HELPER — apply one merge rule to a word
//
// Takes an array of symbols and one merge rule [a, b].
// Scans left to right. Wherever it sees 'a' followed
// by 'b', it replaces both with 'ab'.
//
// Example:
//   applyOneMerge(['t','h','e'], ['t','h'])
//   → ['th', 'e']
// ─────────────────────────────────────────────

function applyOneMerge(symbols, mergeRule) {
  const leftSymbol  = mergeRule[0];   // e.g. 't'
  const rightSymbol = mergeRule[1];   // e.g. 'h'

  const result = [];
  let i = 0;
  while (i < symbols.length) {
    // check if current symbol matches left side of merge
    // and the next symbol matches the right side
    const isLastSymbol = (i === symbols.length - 1);
    if (!isLastSymbol && symbols[i] === leftSymbol && symbols[i + 1] === rightSymbol) {
      // merge! combine both into one
      result.push(leftSymbol + rightSymbol);
      i += 2;   // jump over both symbols since we just merged them
    } else {
      // no match — keep the symbol as it is
      result.push(symbols[i]);
      i += 1;
    }
  }

  return result;
}


// ─────────────────────────────────────────────
// MAIN FUNCTION — tokenize the full input text
// ─────────────────────────────────────────────

function tokenize(text) {

  // ── Step 1: rough split ───────────────────
  // e.g. "Hello, isn't it?" → ["Hello", ",", " isn", "'t", " it", "?"]
  const roughChunks = text.match(SPLIT_PATTERN) || [];

  // ── Step 2 + 3: encode and merge each chunk
  const allTokens = [];

  for (const chunk of roughChunks) {

    // convert chunk to byte symbols
    // e.g. " the" → ['Ġ', 't', 'h', 'e']
    let symbols = wordToByteSymbols(chunk);

    // if only one symbol, nothing to merge — just add it directly
    if (symbols.length === 1) {
      allTokens.push(symbols[0]);
      continue;
    }

    // apply every merge rule one at a time, in order
    for (const mergeRule of MERGE_RULES) {
      symbols = applyOneMerge(symbols, mergeRule);
      // after each merge, symbols array gets shorter (or stays same)
      // e.g. ['t','h','e'] → ['th','e'] → ['the']
    }

    // whatever symbols remain are the final tokens for this chunk
    allTokens.push(...symbols);
  }

  return allTokens;
}


// ─────────────────────────────────────────────
// DISPLAY — print results in a nice format
// ─────────────────────────────────────────────

function showResults(text) {

  const tokens = tokenize(text);

  console.log(`\n${BOLD}Your input:${COLOR_RESET}  ${JSON.stringify(text)}`);
  console.log(`${DIM}(using GPT-2 style byte-level BPE — approximate)${COLOR_RESET}\n`);

  // ── Colored view ──────────────────────────
  // paint each token a different color so boundaries are visible
  console.log(`${BOLD}Tokens highlighted:${COLOR_RESET}  (Ġ means the token starts with a space)\n`);

  let coloredLine = "";
  tokens.forEach((token, index) => {
    // pick a color — cycle through 7 colors using modulo (remainder)
    // index 0 → color 0, index 7 → color 0 again, index 8 → color 1, etc.
    const color = COLOR_LIST[index % COLOR_LIST.length];

    // make newlines visible as ↵ so they don't break the line
    const displayText = token.replace(/\n/g, "↵");

    coloredLine += color + displayText + COLOR_RESET;
  });

  console.log("  " + coloredLine);
  console.log();

  // ── Token table ───────────────────────────
  console.log(`${BOLD}Token breakdown table:${COLOR_RESET}\n`);
  console.log("  " + "No.".padEnd(6) + "Token".padEnd(22) + "Type");
  console.log("  " + "─".repeat(44));

  tokens.forEach((token, index) => {

    // make it human readable in the table
    const readable = token.replace(/Ġ/g, "[space]");

    // figure out what kind of token this is
    let tokenType;
    if (token.startsWith("Ġ")) {
      tokenType = "word (with leading space)";
    } else if (token.length === 1 && !/\w/.test(token)) {
      tokenType = "punctuation";
    } else if (/^\d+$/.test(token)) {
      tokenType = "number";
    } else if (token.length > 1) {
      tokenType = "sub-word piece";
    } else {
      tokenType = "single letter";
    }

    console.log("  " + String(index + 1).padEnd(6) + readable.padEnd(22) + DIM + tokenType + COLOR_RESET);
  });

  console.log("  " + "─".repeat(44));

  // ── Summary stats ─────────────────────────
  const totalTokens = tokens.length;
  const totalChars  = text.length;
  const avg         = totalChars / totalTokens;

  console.log(`\n  ${BOLD}Total tokens:${COLOR_RESET}  ${totalTokens}`);
  console.log(`  ${BOLD}Total chars: ${COLOR_RESET}  ${totalChars}`);
  console.log(`  ${BOLD}Chars/token: ${COLOR_RESET}  ${avg.toFixed(1)} on average`);
  console.log();
  console.log(`  ${DIM}(Real GPT-4 averages ~3–4 chars per token on English text.`);
  console.log(`  Lower number here = smaller merge table = more splits)${COLOR_RESET}`);
  console.log();
}


// ─────────────────────────────────────────────
// INTERACTIVE MODE
//
// When you run the file with no arguments,
// it drops into a loop asking you to type things.
// Type 'quit' to exit.
// ─────────────────────────────────────────────

function runInteractive() {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n${BOLD}Token Visualizer${COLOR_RESET}`);
  console.log("See how LLMs break your text into tokens.");
  console.log("Type anything and press Enter. Type 'quit' to stop.\n");

  function askForInput() {
    rl.question(`${BOLD}>${COLOR_RESET} `, (userInput) => {
      userInput = userInput.trim();   // remove extra spaces

      if (userInput === "") {
        askForInput();   // they pressed Enter with nothing — ask again
        return;
      }

      if (["quit", "exit", "q"].includes(userInput.toLowerCase())) {
        console.log("bye!");
        rl.close();      // exit the loop
        return;
      }

      showResults(userInput);
      askForInput();
    });
  }

  askForInput();
}


// ─────────────────────────────────────────────
// ENTRY POINT
//
// Node runs this block when you execute the file directly.
//
// Two modes:
//   With argument  →  node tokenizer.js "hello world"
//   No argument    →  node tokenizer.js   (interactive)
// ─────────────────────────────────────────────

// process.argv is an array of everything typed in the terminal
// process.argv[0] = "node"              (the runtime)
// process.argv[1] = "tokenizer.js"      (the filename)
// process.argv[2] = "hello"             (first argument, if given)

const argumentsGiven = process.argv.length > 2;

if (argumentsGiven) {
  // join all arguments into one string in case they typed multiple words
  const inputText = process.argv.slice(2).join(" ");
  showResults(inputText);
} else {
  runInteractive();
}
