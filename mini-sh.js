// mini-sh.js
// Modern, dependency-free parser for a small shell subset.
// Exports: parse(input) -> Pipeline AST, expandWord(word, ctx) -> string, stringifyArgv(cmd, ctx) -> argv[]
//
// Run directly: node --input-type=module mini-sh.js
//
/* ============================================================================
   Helper types (documented inline)
   - Word is { kind: 'Word', parts: [ TextPart ], span: {start,end} }
     where TextPart can be { kind: 'Text', value, span } or { kind: 'Var', name, braced, span }
   - Redirection: { kind: 'Redirection', fd?, op, target:Word, dupTargetFd? }
   - Command: { kind:'Command', words:Word[], redirections:Redirection[], span }
   - Pipeline: { kind:'Pipeline', commands:Command[], span }
   ============================================================================ */

const SyntaxKind = {
  Word: 'Word',
  Text: 'Text',
  Var: 'Var',
  Redirection: 'Redirection',
  Command: 'Command',
  Pipeline: 'Pipeline',
};

// ---------------------
// Lexer: converts string -> sequence of tokens
// We do a single-pass hand-written scanning for speed & clarity.
// ---------------------

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}
function isVarStart(ch) {
  return (ch >= 'A' && ch <= 'Z') ||
         (ch >= 'a' && ch <= 'z') ||
         ch === '_';
}
function isVarChar(ch) {
  return isVarStart(ch) || isDigit(ch);
}

function makeSpan(start, end) { return { start, end }; }

// Token kinds: we use a small internal token set to ease parsing.
const TokenKind = {
  Word: 'Word',           // a raw word string (not yet split into parts)
  Pipe: 'Pipe',           // |
  GT: 'GT',               // >
  GTGT: 'GTGT',           // >>
  LT: 'LT',               // <
  AMP_GT: 'AMP_GT',       // &> (redirect both)
  FD_GT: 'FD_GT',         // n> or n>> or n>&
  EOF: 'EOF',
};

class Token {
  constructor(kind, text, start, end, meta = null) {
    this.kind = kind;
    this.text = text;   // raw substring as seen
    this.start = start;
    this.end = end;
    this.meta = meta;   // optional metadata (like fd or dup target)
  }
}

function lex(input) {
  // Returns list of Token
  const tokens = [];
  const N = input.length;
  let i = 0;

  // Advance helpers
  const peek = (n = 0) => input[i + n];
  const eof = () => i >= N;

  // Helpers to push token
  const pushToken = (kind, start, end, meta = null) => {
    tokens.push(new Token(kind, input.slice(start, end), start, end, meta));
  };

  while (!eof()) {
    // Skip whitespace
    if (isSpace(peek())) { i++; continue; }

    const ch = peek();

    // Operators: check two-char ones first
    if (ch === '|' ) {
      pushToken(TokenKind.Pipe, i, i+1);
      i += 1;
      continue;
    }

    // &> (redirect both stdout+stderr)
    if (ch === '&' && peek(1) === '>') {
      pushToken(TokenKind.AMP_GT, i, i+2);
      i += 2;
      continue;
    }

    // Handle numeric fd before redir, like 2>, 2>>, 3>&1
    if (isDigit(ch)) {
      // read digits
      const startFd = i;
      while (!eof() && isDigit(peek())) i++;
      // check if next is '>' (a redirection)
      if (peek() === '>') {
        const fdStr = input.slice(startFd, i);
        i++; // consume '>'
        if (peek() === '>') {
          // >> (append)
          i++;
          pushToken(TokenKind.FD_GT, startFd, i, { fd: Number(fdStr), append: true });
          continue;
        }
        // maybe a dup form >&
        if (peek() === '&') {
          // consume '&' and then read target digits (dup target fd)
          i++;
          const dupStart = i;
          while (!eof() && isDigit(peek())) i++;
          const dupStr = input.slice(dupStart, i);
          // If no digits after &, we still treat as FD_GT with dupTargetFd:null (error later)
          pushToken(TokenKind.FD_GT, startFd, i, { fd: Number(fdStr), dup: true, dupTarget: dupStr ? Number(dupStr) : null });
          continue;
        }
        // plain fd>
        pushToken(TokenKind.FD_GT, startFd, i, { fd: Number(fdStr), append: false });
        continue;
      }
      // else: not a redir; fallthrough to word scanning from startFd
      i = startFd; // reset to scan as word
    }

    // Single-char redirections
    if (ch === '>') {
      if (peek(1) === '>') {
        pushToken(TokenKind.GTGT, i, i+2);
        i += 2;
      } else {
        pushToken(TokenKind.GT, i, i+1);
        i += 1;
      }
      continue;
    }
    if (ch === '<') {
      pushToken(TokenKind.LT, i, i+1);
      i += 1;
      continue;
    }

    // Otherwise scan a word (handles quoting, escapes, variables will be split later)
    // Word scanning: gather characters until whitespace or an operator boundary
    const wstart = i;
    let bufStart = i;
    let inWord = true;

    // We'll copy the raw substring; parsing into parts happens later.
    // But we must treat quotes as part of the raw token so later part-splitting can be accurate.
    while (!eof() && inWord) {
      const c = peek();
      // break on top-level operators or whitespace
      if (isSpace(c)) break;
      if (c === '|' || c === '<' || c === '>') break;
      if (c === '&' && peek(1) === '>') break; // &> start operator
      // important: if we see digits followed by '>' we would have lexed as FD_GT earlier; so here digits are safe
      // Handle quotes: we include them as part of token raw text
      if (c === "'" || c === '"') {
        // consume quoted string naively (handles escapes in double quotes semantically later)
        const q = c;
        i++; // consume opening quote
        while (!eof()) {
          const cc = peek();
          if (cc === '\\' && q === '"' ) {
            // escape inside double quotes: consume next char as well
            i += 2;
            continue;
          }
          if (cc === q) { i++; break; }
          i++;
        }
        continue;
      }
      if (c === '\\') {
        // escape next char (include both)
        i += 2;
        continue;
      }
      // normal char
      i++;
    }
    const wend = i;
    pushToken(TokenKind.Word, wstart, wend);
  }

  pushToken(TokenKind.EOF, N, N);
  return tokens;
}

// ---------------------
// Parser: tokens -> AST
// We keep parsing simple and deterministic. We preserve word raw text and split into parts later.
// ---------------------

// helper: split a raw word string into parts (Text | Var)
// We support:
//   - single quotes: 'literal' (no expansion)
//   - double quotes: "possibly with \" and \$ and variables"
//   - unquoted escapes: backslash escapes single char
//   - variables: $name or ${name} (inside double quotes or unquoted)
function splitWordIntoParts(raw, baseOffset = 0) {
  // raw: substring exactly as in input (includes quotes if present)
  // baseOffset: index of raw[0] in original input for span calculation
  const parts = [];
  let i = 0;
  const N = raw.length;

  const pushText = (s, start, end) => {
    if (!s) return;
    parts.push({ kind: SyntaxKind.Text, value: s, span: makeSpan(baseOffset + start, baseOffset + end) });
  };
  const pushVar = (name, braced, start, end) => {
    parts.push({ kind: SyntaxKind.Var, name, braced, span: makeSpan(baseOffset + start, baseOffset + end) });
  };

  while (i < N) {
    const ch = raw[i];

    if (ch === "'") {
      // single-quoted literal: everything until the next single quote is literal text
      const start = i;
      i++; // skip opening '
      const innerStart = i;
      while (i < N && raw[i] !== "'") i++;
      const inner = raw.slice(innerStart, i);
      // include the literal content (not the quotes) as Text
      pushText(inner, innerStart, innerStart + inner.length);
      if (i < N && raw[i] === "'") i++; // consume closing '
      continue;
    }

    if (ch === '"') {
      // double-quoted: we interpret backslash escapes for \" and \\ and \$ and `\n` etc.
      const opening = i;
      i++; // skip opening "
      let segmentStart = i;
      let acc = '';
      while (i < N) {
        const c = raw[i];
        if (c === '\\') {
          // push accumulated
          if (i > segmentStart) {
            const s = raw.slice(segmentStart, i);
            pushText(s, segmentStart, i);
          }
          // handle escape
          const esc = raw[i+1] ?? '';
          // The shell interprets certain escapes; we implement common ones.
          if (esc === 'n') { pushText('\n', i, i+2); }
          else if (esc === 't') { pushText('\t', i, i+2); }
          else if (esc === '"' || esc === '\\' || esc === '$' || esc === '`') {
            // keep the escaped character literally
            pushText(esc, i, i+2);
          } else {
            // unknown escape: just include the escaped char
            pushText(esc, i, i+2);
          }
          i += 2;
          segmentStart = i;
          continue;
        }
        if (c === '"') {
          // end of double-quoted segment
          if (i > segmentStart) {
            const s = raw.slice(segmentStart, i);
            // But this segment can contain variables like $var or ${var}
            // So we must scan it for $ occurrences and split accordingly.
            scanTextForVars(s, segmentStart);
          }
          i++; // consume closing "
          break;
        }
        if (c === '$') {
          // flush up to $ as text, then parse variable
          if (i > segmentStart) {
            const s = raw.slice(segmentStart, i);
            scanTextForVars(s, segmentStart);
          }
          // parse variable
          const varStart = i;
          const next = raw[i+1];
          if (next === '{') {
            // ${name}
            let j = i+2;
            while (j < N && raw[j] !== '}') j++;
            const varName = raw.slice(i+2, j);
            pushVar(varName, true, i, j+1);
            i = j+1;
            segmentStart = i;
            continue;
          } else {
            // $name
            let j = i+1;
            if (isVarStart(next)) {
              j++;
              while (j < N && isVarChar(raw[j])) j++;
              const varName = raw.slice(i+1, j);
              pushVar(varName, false, i, j);
              i = j;
              segmentStart = i;
              continue;
            } else {
              // $ followed by non-var -> literal $
              pushText('$', i, i+1);
              i++;
              segmentStart = i;
              continue;
            }
          }
        }
        i++;
      }
      continue;
    }

    if (ch === '\\') {
      // unquoted escape: backslash escapes the next character literally
      const start = i;
      if (i+1 < N) {
        pushText(raw[i+1], i, i+2);
        i += 2;
      } else {
        // trailing backslash: treat as literal backslash
        pushText('\\', i, i+1);
        i++;
      }
      continue;
    }

    if (ch === '$') {
      // unquoted variable (same rules as inside double quotes)
      const varStart = i;
      const next = raw[i+1];
      if (next === '{') {
        let j = i+2;
        while (j < N && raw[j] !== '}') j++;
        const varName = raw.slice(i+2, j);
        pushVar(varName, true, i, j+1);
        i = j+1;
        continue;
      } else {
        let j = i+1;
        if (isVarStart(next)) {
          j++;
          while (j < N && isVarChar(raw[j])) j++;
          const varName = raw.slice(i+1, j);
          pushVar(varName, false, i, j);
          i = j;
          continue;
        } else {
          // $ followed by non-var: keep literal $
          pushText('$', i, i+1);
          i++;
          continue;
        }
      }
    }

    // Regular run of characters until special char or end
    // accumulate until next special char
    const runStart = i;
    while (i < N) {
      const c = raw[i];
      if (c === "'" || c === '"' || c === '\\' || c === '$') break;
      i++;
    }
    if (i > runStart) {
      const s = raw.slice(runStart, i);
      pushText(s, runStart, i);
    }
  }

  // Helper used above: scan a piece of text for inline $vars and split accordingly.
  function scanTextForVars(text, offset) {
    let p = 0;
    let accStart = 0;
    while (p < text.length) {
      if (text[p] === '$') {
        // push preceding text
        if (p > accStart) {
          pushText(text.slice(accStart, p), offset + accStart, offset + p);
        }
        // parse var
        if (text[p+1] === '{') {
          let j = p+2;
          while (j < text.length && text[j] !== '}') j++;
          const varName = text.slice(p+2, j);
          pushVar(varName, true, offset + p, offset + j + 1);
          p = j + 1;
          accStart = p;
          continue;
        } else {
          let j = p+1;
          if (isVarStart(text[j])) {
            j++;
            while (j < text.length && isVarChar(text[j])) j++;
            const varName = text.slice(p+1, j);
            pushVar(varName, false, offset + p, offset + j);
            p = j;
            accStart = p;
            continue;
          } else {
            // literal $
            pushText('$', offset + p, offset + p + 1);
            p++;
            accStart = p;
            continue;
          }
        }
      }
      p++;
    }
    if (accStart < text.length) {
      pushText(text.slice(accStart), offset + accStart, offset + text.length);
    }
  }

  // Merge consecutive Text parts into single Text for cleanliness
  const merged = [];
  for (const part of parts) {
    if (merged.length && merged[merged.length-1].kind === SyntaxKind.Text && part.kind === SyntaxKind.Text) {
      const prev = merged[merged.length-1];
      prev.value += part.value;
      prev.span.end = part.span.end;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

// Parser consumes tokens and builds AST
function parse(input) {
  const tokens = lex(input);
  let idx = 0;
  const peekTok = (n = 0) => tokens[idx + n] ?? tokens[tokens.length - 1];
  const eatTok = () => tokens[idx++] ?? tokens[tokens.length - 1];

  const pipelineStart = 0;
  const commands = [];

  // top-level: command ( '|' command )*
  while (peekTok().kind !== TokenKind.EOF) {
    const cmd = parseCommand();
    commands.push(cmd);
    if (peekTok().kind === TokenKind.Pipe) {
      eatTok(); // consume |
      // continue loop to parse next command
      continue;
    } else {
      break;
    }
  }

  const pipelineEnd = peekTok().end;
  return {
    kind: SyntaxKind.Pipeline,
    commands,
    span: makeSpan(pipelineStart, pipelineEnd),
  };

  // parseCommand: collect words and redirections in order
  function parseCommand() {
    const words = [];
    const redirs = [];
    const cmdStart = peekTok().start;
    while (true) {
      const tk = peekTok();
      if (tk.kind === TokenKind.EOF || tk.kind === TokenKind.Pipe) break;

      if (tk.kind === TokenKind.Word) {
        // But a Word token might actually be a redirection operator if it's something like '&>file' or '2>file'
        // However lex produced distinct token kinds for those, so here Word is safe.
        const raw = tk.text;
        const spanStart = tk.start;
        // Recognize if this word is immediately a redirection operator in textual form like '2>&1' (should have been tokenized earlier)
        // For simplicity, treat it as a plain word.
        words.push(makeWord(raw, spanStart));
        eatTok();
        continue;
      }

      // Redirection tokens from lexer:
      if (tk.kind === TokenKind.GT || tk.kind === TokenKind.GTGT || tk.kind === TokenKind.LT || tk.kind === TokenKind.AMP_GT || tk.kind === TokenKind.FD_GT) {
        const t = eatTok();
        // Determine op and fd info
        let op = null;
        let fd = undefined;
        let dup = false;
        let append = false;
        let dupTarget = null;

        if (t.kind === TokenKind.AMP_GT) {
          op = 'clobber'; // &>file shorthand
        } else if (t.kind === TokenKind.GT) {
          op = '>';
        } else if (t.kind === TokenKind.GTGT) {
          op = '>>';
        } else if (t.kind === TokenKind.LT) {
          op = '<';
        } else if (t.kind === TokenKind.FD_GT) {
          fd = t.meta.fd;
          if (t.meta.dup) {
            dup = true;
            dupTarget = t.meta.dupTarget; // may be null -> error handled later
            op = 'dup';
          } else {
            append = t.meta.append;
            op = append ? '>>' : '>';
          }
        }

        // After a redirection operator, we expect a target word (filename) next
        const next = peekTok();
        if (next.kind !== TokenKind.Word) {
          // error: missing target: create a placeholder Word with empty parts and continue
          const placeholder = makeWord('', t.end);
          redirs.push({
            kind: SyntaxKind.Redirection,
            fd,
            op,
            target: placeholder,
            dupTargetFd: dup ? dupTarget : undefined,
            span: makeSpan(t.start, t.end),
          });
          continue;
        }
        // consume the target word token
        const targTok = eatTok();
        const targetWord = makeWord(targTok.text, targTok.start);
        redirs.push({
          kind: SyntaxKind.Redirection,
          fd,
          op,
          target: targetWord,
          dupTargetFd: dup ? dupTarget : undefined,
          span: makeSpan(t.start, targTok.end),
        });
        continue;
      }

      // Unknown token -> bail
      eatTok();
    }

    const cmdEnd = (peekTok().start || 0);
    return {
      kind: SyntaxKind.Command,
      words,
      redirections: redirs,
      span: makeSpan(cmdStart, cmdEnd),
    };
  }

  function makeWord(rawText, startOffset) {
    const parts = splitWordIntoParts(rawText, startOffset);
    const end = startOffset + rawText.length;
    return { kind: SyntaxKind.Word, parts, span: makeSpan(startOffset, end) };
  }
}

// ---------------------
// Expansion: convert a Word (parts) into a concrete string given a context
// - context is an object mapping variable names to string values
// - missing vars resolve to empty string
// - this function does not perform globbing or splitting
// ---------------------

function expandWord(word, ctx = {}) {
  // word: { parts: [ {kind:Text, value} | {kind:Var, name, braced} ] }
  let out = '';
  for (const p of word.parts) {
    if (p.kind === SyntaxKind.Text) out += p.value;
    else if (p.kind === SyntaxKind.Var) {
      const val = ctx[p.name];
      out += (val === undefined || val === null) ? '' : String(val);
    } else {
      // unknown part: ignore
    }
  }
  return out;
}

// Build argv for a Command by expanding each word with provided context
function buildArgv(command, ctx = {}) {
  return command.words.map(w => expandWord(w, ctx));
}

// ---------------------
// Utilities for pretty printing AST (helpful during tests)
// ---------------------

function wordToStringParts(word) {
  return word.parts.map(p => p.kind === SyntaxKind.Text ? JSON.stringify(p.value) : `$${p.name}`).join(' + ');
}

function printAST(pipeline) {
  const out = [];
  out.push(`Pipeline: ${pipeline.commands.length} command(s)`);
  pipeline.commands.forEach((cmd, i) => {
    out.push(`  Command ${i}:`);
    out.push(`    words:`);
    cmd.words.forEach(w => {
      out.push(`      - ${wordToStringParts(w)} (span ${w.span.start}-${w.span.end})`);
    });
    if (cmd.redirections.length) {
      out.push(`    redirections:`);
      cmd.redirections.forEach(r => {
        const fdStr = r.fd === undefined ? '' : `${r.fd}`;
        const op = r.op;
        const target = r.target.parts.map(p => p.kind === SyntaxKind.Text ? p.value : `$${p.name}`).join('');
        out.push(`      - ${fdStr}${op} -> ${target}${r.dupTargetFd !== undefined ? ` (dup->${r.dupTargetFd})` : ''}`);
      });
    }
  });
  return out.join('\n');
}

// ---------------------
// Quick test harness using the provided command list
// ---------------------

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('mini-sh.js')) {
  // If run directly, run tests
  const samples = [
    'cp -r src/ dest/',
    'mv oldname.txt newname.txt',
    'touch newfile.txt',
    'cat /etc/passwd',
    'journalctl -u nginx.service --since "1 hour ago"',
    'ssh user@192.0.2.10',
    'scp file.zip user@remote:/home/user/',
    'tar -czvf backup.tar.gz /etc /home/user',
    'zip -r archive.zip folder/',
    'curl -I https://example.com',
    'mkdir --parents --mode=0755 ~/projects/myapp',
    'chmod --changes --recursive 755 /usr/local/bin',
    'chown --recursive --verbose user:group /srv/data',
    'find /home --maxdepth 3 --name "*.pdf" --type f',
    'grep --recursive --ignore-case --line-number --color=always "error" /var/www',
    'tar --create --gzip --file=backup.tar.gz --directory=/etc etc',
    'tar --extract --verbose --file=backup.tar.gz --directory=/restore',
    'ssh --log-level=INFO --oStrictHostKeyChecking=no user@192.0.2.10',
    'scp --recursive --compress --port=2222 file.zip user@remote:/home/user/',
    'rsync --archive --compress --progress --delete src/ dest/',
    'docker run --detach --name=mycontainer --publish=8080:80 nginx:latest',
    'python3 --version --verbose --help',
    'grep --message="User not found" /var/log/auth.log',
    'ssh -o "ProxyCommand=nc -x 127.0.0.1:1080 %h %p" user@host',
    'curl --header="Authorization: Bearer abc123== " --silent https://api.example.com',
    'find /var/www --name="*.php" --mtime="-7"',
    'systemd-run --unit="one-shot.job" --property="TimeoutStartSec=30s" /usr/bin/echo "done"',
    // some with pipes and vars:
    `command-name -x -y value -z | another-command positional0 --y value-for-y positional1 | yet-anoter-command $POSITIONAL_VALUE_FROM_CONTEXT --foo $lowercase_value_from_context`,
    'echo "A mix: $HOME and ${USER} and literal $ notvar" > out.txt',
    'cat input.txt 2>&1 | grep error &> combined.log'
  ];

  console.log('\n== mini-sh.js self-test ==\n');
  let count = 0;
  for (const s of samples) {
    count++;
    console.log(`\n[${count}] input: ${s}`);
    try {
      const ast = parse(s);
      console.log(printAST(ast));
      // show argv for each command using process.env as context (common variables)
      ast.commands.forEach((cmd, idx) => {
        const argv = buildArgv(cmd, process.env);
        console.log(`    argv[${idx}]:`, argv);
      });
    } catch (err) {
      console.error('   parse error:', err);
    }
  }
  console.log('\n== done ==\n');
}

// ---------------------
// Exports for reuse as a module
// ---------------------
export { parse, expandWord, buildArgv, SyntaxKind };
