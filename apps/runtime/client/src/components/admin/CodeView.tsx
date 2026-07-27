/**
 * Lightweight, dependency-free syntax highlighter for the read-only source
 * viewer. A small tokenizer (TSX/TS/JS, CSS, JSON; everything else is plain)
 * feeds an editor-style render with a sticky line-number gutter and a One Light
 * / One Dark colour theme. Deliberately NOT a full parser — it stays robust
 * (every byte is always consumed) and adds zero bundle dependencies, which keeps
 * the self-hosted container lean.
 */
import { useMemo } from 'react';

type TokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'tag'
  | 'variable'
  | 'atrule'
  | 'hexcolor'
  | 'key'
  | 'punct';

interface Token {
  t: TokenType;
  v: string;
}

type Rule = [TokenType, RegExp];

// One Light (default) → One Dark (`.dark`). Literal class strings so Tailwind's
// JIT picks up each arbitrary colour.
const TOKEN_CLASS: Record<TokenType, string> = {
  plain: '',
  comment: 'italic text-[#a0a1a7] dark:text-[#7f848e]',
  string: 'text-[#50a14f] dark:text-[#98c379]',
  number: 'text-[#b76b01] dark:text-[#d19a66]',
  keyword: 'text-[#a626a4] dark:text-[#c678dd]',
  tag: 'text-[#e45649] dark:text-[#e06c75]',
  variable: 'text-[#986801] dark:text-[#d19a66]',
  atrule: 'text-[#a626a4] dark:text-[#c678dd]',
  hexcolor: 'text-[#0184bc] dark:text-[#56b6c2]',
  key: 'text-[#e45649] dark:text-[#e06c75]',
  punct: 'text-[#a0a1a7] dark:text-[#828997]',
};

const JS_KEYWORDS =
  'abstract|as|async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|keyof|let|namespace|new|null|of|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield';

const JS_RULES: Rule[] = [
  ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
  ['string', /`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/],
  ['number', /\b(?:0[xXbBoO][0-9a-fA-F]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?)\b/],
  ['keyword', new RegExp(`\\b(?:${JS_KEYWORDS})\\b`)],
  ['tag', /<\/?[A-Za-z][\w.-]*/],
  ['plain', /[A-Za-z_$][\w$]*/],
  ['plain', /\s+/],
  ['punct', /[^\s]/],
];

const CSS_RULES: Rule[] = [
  ['comment', /\/\*[\s\S]*?\*\//],
  ['string', /"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/],
  ['atrule', /@[\w-]+/],
  ['variable', /--[\w-]+/],
  ['hexcolor', /#[0-9a-fA-F]{3,8}\b/],
  ['number', /-?\b\d*\.?\d+(?:px|rem|em|%|vh|vw|dvh|dvw|svh|lvh|fr|s|ms|deg|ch|ex|pt|cm|mm|in|pc)?\b/],
  ['plain', /[A-Za-z_-][\w-]*/],
  ['plain', /\s+/],
  ['punct', /[^\s]/],
];

const JSON_RULES: Rule[] = [
  ['key', /"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/],
  ['string', /"(?:\\[\s\S]|[^"\\])*"/],
  ['number', /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/],
  ['keyword', /\b(?:true|false|null)\b/],
  ['plain', /\s+/],
  ['punct', /[^\s]/],
];

function rulesFor(filename: string): Rule[] | null {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return JS_RULES;
  if (ext === 'css') return CSS_RULES;
  if (ext === 'json') return JSON_RULES;
  return null;
}

/** Scan the whole string once with a sticky combined regex; the punct/space
 *  fallbacks guarantee every character is consumed (never returns null early). */
function tokenize(code: string, rules: Rule[] | null): Token[] {
  if (!rules) return [{ t: 'plain', v: code }];
  const source = rules.map(([, re]) => `(${re.source})`).join('|');
  const re = new RegExp(source, 'gy');
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let type: TokenType = 'plain';
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) {
        type = rules[i - 1][0];
        break;
      }
    }
    tokens.push({ t: type, v: m[0] });
    if (m[0] === '') re.lastIndex++; // safety against zero-width matches
  }
  return tokens;
}

/** Split tokens into per-line arrays, preserving token boundaries. */
function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.v.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ t: tok.t, v: part });
    });
  }
  return lines;
}

// Files larger than this skip per-token spans (kept readable + responsive).
const MAX_HIGHLIGHT_BYTES = 200_000;

export function CodeView({ code, filename }: { code: string; filename: string }) {
  const lines = useMemo(() => {
    const rules = code.length > MAX_HIGHLIGHT_BYTES ? null : rulesFor(filename);
    return toLines(tokenize(code, rules));
  }, [code, filename]);

  const gutterWidth = String(lines.length).length;

  return (
    <div className="min-w-max py-2 font-mono text-xs leading-[1.6]">
      {lines.map((toks, i) => (
        <div key={i} className="group flex hover:bg-foreground/[0.035]">
          <span
            className="sticky left-0 z-10 shrink-0 select-none border-r border-border/60 bg-background pr-3 pl-3 text-right text-muted-foreground/70 group-hover:bg-muted/40"
            style={{ minWidth: `${gutterWidth + 2}ch` }}
          >
            {i + 1}
          </span>
          <code className="whitespace-pre px-4 text-[#383a42] dark:text-[#abb2bf]">
            {toks.length === 0
              ? ' '
              : toks.map((t, j) =>
                  TOKEN_CLASS[t.t] ? (
                    <span key={j} className={TOKEN_CLASS[t.t]}>
                      {t.v}
                    </span>
                  ) : (
                    <span key={j}>{t.v}</span>
                  ),
                )}
          </code>
        </div>
      ))}
    </div>
  );
}
