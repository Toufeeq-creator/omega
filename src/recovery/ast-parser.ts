// ─────────────────────────────────────────────────────────────────────────────
// Pratt AST Parser & Code Generator (Zero External Dependencies)
//
// A high-performance recursive-descent expression & statement parser with
// Pratt operator precedence. Designed specifically for autonomous AST self-healing:
// - Parses member access chains (dot, bracket, optional chaining)
// - Parses variable declarations (const, let, var) and return statements
// - Parses binary arithmetic (unit conversions), nullish coalescing, and ternaries
// - AST Node tree mutation & exact code generation (round-trip unparsing)
// ─────────────────────────────────────────────────────────────────────────────

// ─── Token Types ──────────────────────────────────────────────────────────

export enum TokenType {
  Identifier,
  Number,
  String,
  Keyword,     // const, let, var, return, true, false, null, undefined
  Dot,         // .
  QuestionDot, // ?.
  Question,    // ?
  Colon,       // :
  DoubleQuestion, // ??
  Plus,        // +
  Minus,       // -
  Star,        // *
  Slash,       // /
  Percent,     // %
  Equal,       // =
  DoubleEqual, // ==
  TripleEqual, // ===
  NotEqual,    // !=
  StrictNotEqual, // !==
  Exclamation, // !
  AmpAmp,      // &&
  BarBar,      // ||
  LeftParen,   // (
  RightParen,  // )
  LeftBracket, // [
  RightBracket,// ]
  LeftBrace,   // {
  RightBrace,  // }
  Comma,       // ,
  Semicolon,   // ;
  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

// ─── Precedence Levels ───────────────────────────────────────────────────

export enum Precedence {
  Lowest = 0,
  Assignment = 1,   // =
  Ternary = 2,      // ? :
  Nullish = 3,      // ??
  LogicalOr = 4,    // ||
  LogicalAnd = 5,   // &&
  Equality = 6,     // ==, ===, !=, !==
  Relational = 7,   // <, >, <=, >=
  AddSub = 8,       // +, -
  MulDiv = 9,       // *, /, %
  Unary = 10,       // !, -, +
  Call = 11,        // fn(...)
  Member = 12,      // obj.prop, obj[prop], obj?.prop
}

// ─── AST Node Definitions ────────────────────────────────────────────────

export type ASTNode =
  | IdentifierNode
  | LiteralNode
  | MemberExpressionNode
  | BinaryExpressionNode
  | LogicalExpressionNode
  | ConditionalExpressionNode
  | CallExpressionNode
  | VariableDeclarationNode
  | ReturnStatementNode
  | ExpressionStatementNode;

export interface IdentifierNode {
  type: "Identifier";
  name: string;
}

export interface LiteralNode {
  type: "Literal";
  value: string | number | boolean | null | undefined;
  raw: string;
}

export interface MemberExpressionNode {
  type: "MemberExpression";
  object: ASTNode;
  property: ASTNode;
  computed: boolean; // true for a["b"] or a[0], false for a.b
  optional: boolean; // true for a?.b or a?.[0]
}

export interface BinaryExpressionNode {
  type: "BinaryExpression";
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

export interface LogicalExpressionNode {
  type: "LogicalExpression";
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

export interface ConditionalExpressionNode {
  type: "ConditionalExpression";
  test: ASTNode;
  consequent: ASTNode;
  alternate: ASTNode;
}

export interface CallExpressionNode {
  type: "CallExpression";
  callee: ASTNode;
  arguments: ASTNode[];
  optional: boolean;
}

export interface VariableDeclarationNode {
  type: "VariableDeclaration";
  kind: "const" | "let" | "var";
  declarations: { id: ASTNode; init?: ASTNode }[];
}

export interface ReturnStatementNode {
  type: "ReturnStatement";
  argument?: ASTNode;
}

export interface ExpressionStatementNode {
  type: "ExpressionStatement";
  expression: ASTNode;
}

// ─── Lexer / Tokenizer ───────────────────────────────────────────────────

export class Lexer {
  private pos = 0;

  constructor(private input: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.input.length) break;

      const char = this.input[this.pos];
      const start = this.pos;

      // QuestionDot or Question
      if (char === "?") {
        if (this.peek(1) === "." && !this.isDigit(this.peek(2))) {
          this.pos += 2;
          tokens.push({ type: TokenType.QuestionDot, value: "?.", start, end: this.pos });
          continue;
        }
        if (this.peek(1) === "?") {
          this.pos += 2;
          tokens.push({ type: TokenType.DoubleQuestion, value: "??", start, end: this.pos });
          continue;
        }
        this.pos++;
        tokens.push({ type: TokenType.Question, value: "?", start, end: this.pos });
        continue;
      }

      // Dot
      if (char === ".") {
        this.pos++;
        tokens.push({ type: TokenType.Dot, value: ".", start, end: this.pos });
        continue;
      }

      // Colon
      if (char === ":") {
        this.pos++;
        tokens.push({ type: TokenType.Colon, value: ":", start, end: this.pos });
        continue;
      }

      // Semicolon
      if (char === ";") {
        this.pos++;
        tokens.push({ type: TokenType.Semicolon, value: ";", start, end: this.pos });
        continue;
      }

      // Comma
      if (char === ",") {
        this.pos++;
        tokens.push({ type: TokenType.Comma, value: ",", start, end: this.pos });
        continue;
      }

      // Parentheses & Brackets & Braces
      if (char === "(") { this.pos++; tokens.push({ type: TokenType.LeftParen, value: "(", start, end: this.pos }); continue; }
      if (char === ")") { this.pos++; tokens.push({ type: TokenType.RightParen, value: ")", start, end: this.pos }); continue; }
      if (char === "[") { this.pos++; tokens.push({ type: TokenType.LeftBracket, value: "[", start, end: this.pos }); continue; }
      if (char === "]") { this.pos++; tokens.push({ type: TokenType.RightBracket, value: "]", start, end: this.pos }); continue; }
      if (char === "{") { this.pos++; tokens.push({ type: TokenType.LeftBrace, value: "{", start, end: this.pos }); continue; }
      if (char === "}") { this.pos++; tokens.push({ type: TokenType.RightBrace, value: "}", start, end: this.pos }); continue; }

      // Operators
      if (char === "+") { this.pos++; tokens.push({ type: TokenType.Plus, value: "+", start, end: this.pos }); continue; }
      if (char === "-") { this.pos++; tokens.push({ type: TokenType.Minus, value: "-", start, end: this.pos }); continue; }
      if (char === "*") { this.pos++; tokens.push({ type: TokenType.Star, value: "*", start, end: this.pos }); continue; }
      if (char === "/") { this.pos++; tokens.push({ type: TokenType.Slash, value: "/", start, end: this.pos }); continue; }
      if (char === "%") { this.pos++; tokens.push({ type: TokenType.Percent, value: "%", start, end: this.pos }); continue; }

      // Equals, DoubleEqual, TripleEqual
      if (char === "=") {
        if (this.peek(1) === "=") {
          if (this.peek(2) === "=") {
            this.pos += 3;
            tokens.push({ type: TokenType.TripleEqual, value: "===", start, end: this.pos });
            continue;
          }
          this.pos += 2;
          tokens.push({ type: TokenType.DoubleEqual, value: "==", start, end: this.pos });
          continue;
        }
        this.pos++;
        tokens.push({ type: TokenType.Equal, value: "=", start, end: this.pos });
        continue;
      }

      // Not, NotEqual, StrictNotEqual
      if (char === "!") {
        if (this.peek(1) === "=") {
          if (this.peek(2) === "=") {
            this.pos += 3;
            tokens.push({ type: TokenType.StrictNotEqual, value: "!==", start, end: this.pos });
            continue;
          }
          this.pos += 2;
          tokens.push({ type: TokenType.NotEqual, value: "!=", start, end: this.pos });
          continue;
        }
        this.pos++;
        tokens.push({ type: TokenType.Exclamation, value: "!", start, end: this.pos });
        continue;
      }

      // Ampersands (&&)
      if (char === "&" && this.peek(1) === "&") {
        this.pos += 2;
        tokens.push({ type: TokenType.AmpAmp, value: "&&", start, end: this.pos });
        continue;
      }

      // Bars (||)
      if (char === "|" && this.peek(1) === "|") {
        this.pos += 2;
        tokens.push({ type: TokenType.BarBar, value: "||", start, end: this.pos });
        continue;
      }

      // Numbers
      if (this.isDigit(char)) {
        const num = this.readNumber();
        tokens.push({ type: TokenType.Number, value: num, start, end: this.pos });
        continue;
      }

      // Strings (single, double quote, backtick)
      if (char === '"' || char === "'" || char === "`") {
        const str = this.readString(char);
        tokens.push({ type: TokenType.String, value: str, start, end: this.pos });
        continue;
      }

      // Identifiers & Keywords
      if (this.isIdentStart(char)) {
        const ident = this.readIdentifier();
        const keywords = ["const", "let", "var", "return", "true", "false", "null", "undefined"];
        const type = keywords.includes(ident) ? TokenType.Keyword : TokenType.Identifier;
        tokens.push({ type, value: ident, start, end: this.pos });
        continue;
      }

      // Unknown character fallback — step forward
      this.pos++;
    }

    tokens.push({ type: TokenType.EOF, value: "", start: this.pos, end: this.pos });
    return tokens;
  }

  private peek(offset: number = 0): string {
    return this.pos + offset < this.input.length ? this.input[this.pos + offset] : "";
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.pos++;
      } else if (ch === "/" && this.peek(1) === "/") {
        // Line comment
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private readNumber(): string {
    const start = this.pos;
    while (this.pos < this.input.length && (this.isDigit(this.input[this.pos]) || this.input[this.pos] === ".")) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  private readString(quote: string): string {
    const start = this.pos;
    this.pos++; // Skip opening quote
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === "\\") this.pos++; // Skip escape
      this.pos++;
    }
    if (this.pos < this.input.length) this.pos++; // Skip closing quote
    return this.input.slice(start, this.pos);
  }

  private readIdentifier(): string {
    const start = this.pos;
    while (this.pos < this.input.length && this.isIdentPart(this.input[this.pos])) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }
}

// ─── Pratt Parser ────────────────────────────────────────────────────────

export class PrattParser {
  private tokens: Token[] = [];
  private current = 0;

  constructor(input: string) {
    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();
  }

  parse(): ASTNode {
    return this.parseStatement();
  }

  private peek(): Token {
    return this.tokens[this.current] || { type: TokenType.EOF, value: "", start: 0, end: 0 };
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== TokenType.EOF) {
      this.current++;
    }
    return token;
  }

  private match(...types: TokenType[]): boolean {
    for (const t of types) {
      if (this.peek().type === t) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private parseStatement(): ASTNode {
    const token = this.peek();

    // Variable Declaration: const / let / var
    if (token.type === TokenType.Keyword && ["const", "let", "var"].includes(token.value)) {
      const kind = this.advance().value as "const" | "let" | "var";
      const id = this.parseExpression(Precedence.Assignment);

      let init: ASTNode | undefined;
      if (this.match(TokenType.Equal)) {
        init = this.parseExpression(Precedence.Lowest);
      }

      this.match(TokenType.Semicolon);
      return {
        type: "VariableDeclaration",
        kind,
        declarations: [{ id, init }],
      };
    }

    // Return Statement
    if (token.type === TokenType.Keyword && token.value === "return") {
      this.advance();
      let argument: ASTNode | undefined;
      if (this.peek().type !== TokenType.Semicolon && this.peek().type !== TokenType.EOF) {
        argument = this.parseExpression(Precedence.Lowest);
      }
      this.match(TokenType.Semicolon);
      return { type: "ReturnStatement", argument };
    }

    // Expression Statement
    const expr = this.parseExpression(Precedence.Lowest);
    this.match(TokenType.Semicolon);
    return expr;
  }

  parseExpression(precedence: Precedence): ASTNode {
    let left = this.parsePrefix();

    while (precedence < this.getInfixPrecedence()) {
      left = this.parseInfix(left);
    }

    return left;
  }

  private parsePrefix(): ASTNode {
    const token = this.advance();

    // Identifier
    if (token.type === TokenType.Identifier) {
      return { type: "Identifier", name: token.value };
    }

    // Keywords like true, false, null, undefined
    if (token.type === TokenType.Keyword) {
      if (token.value === "true") return { type: "Literal", value: true, raw: "true" };
      if (token.value === "false") return { type: "Literal", value: false, raw: "false" };
      if (token.value === "null") return { type: "Literal", value: null, raw: "null" };
      if (token.value === "undefined") return { type: "Literal", value: undefined, raw: "undefined" };
      return { type: "Identifier", name: token.value };
    }

    // Numbers
    if (token.type === TokenType.Number) {
      return { type: "Literal", value: parseFloat(token.value), raw: token.value };
    }

    // Strings
    if (token.type === TokenType.String) {
      const unquoted = token.value.slice(1, -1);
      return { type: "Literal", value: unquoted, raw: token.value };
    }

    // Grouping: (expr)
    if (token.type === TokenType.LeftParen) {
      const expr = this.parseExpression(Precedence.Lowest);
      this.match(TokenType.RightParen);
      return expr;
    }

    // Unary: !expr, -expr, +expr
    if (token.type === TokenType.Exclamation || token.type === TokenType.Minus || token.type === TokenType.Plus) {
      const right = this.parseExpression(Precedence.Unary);
      return {
        type: "BinaryExpression",
        operator: token.value,
        left: { type: "Literal", value: 0, raw: "0" },
        right,
      };
    }

    throw new Error(`Unexpected token at start of expression: '${token.value}'`);
  }

  private getInfixPrecedence(): Precedence {
    const token = this.peek();
    switch (token.type) {
      case TokenType.Dot:
      case TokenType.QuestionDot:
      case TokenType.LeftBracket:
        return Precedence.Member;
      case TokenType.LeftParen:
        return Precedence.Call;
      case TokenType.Star:
      case TokenType.Slash:
      case TokenType.Percent:
        return Precedence.MulDiv;
      case TokenType.Plus:
      case TokenType.Minus:
        return Precedence.AddSub;
      case TokenType.DoubleEqual:
      case TokenType.TripleEqual:
      case TokenType.NotEqual:
      case TokenType.StrictNotEqual:
        return Precedence.Equality;
      case TokenType.AmpAmp:
        return Precedence.LogicalAnd;
      case TokenType.BarBar:
        return Precedence.LogicalOr;
      case TokenType.DoubleQuestion:
        return Precedence.Nullish;
      case TokenType.Question:
        return Precedence.Ternary;
      case TokenType.Equal:
        return Precedence.Assignment;
      default:
        return Precedence.Lowest;
    }
  }

  private parseInfix(left: ASTNode): ASTNode {
    const token = this.advance();

    // Member access via dot: obj.prop
    if (token.type === TokenType.Dot) {
      const propToken = this.advance();
      return {
        type: "MemberExpression",
        object: left,
        property: { type: "Identifier", name: propToken.value },
        computed: false,
        optional: false,
      };
    }

    // Member access via optional chaining: obj?.prop or obj?.[idx]
    if (token.type === TokenType.QuestionDot) {
      if (this.match(TokenType.LeftBracket)) {
        const property = this.parseExpression(Precedence.Lowest);
        this.match(TokenType.RightBracket);
        return {
          type: "MemberExpression",
          object: left,
          property,
          computed: true,
          optional: true,
        };
      }
      const propToken = this.advance();
      return {
        type: "MemberExpression",
        object: left,
        property: { type: "Identifier", name: propToken.value },
        computed: false,
        optional: true,
      };
    }

    // Member access via bracket notation: obj[prop]
    if (token.type === TokenType.LeftBracket) {
      const property = this.parseExpression(Precedence.Lowest);
      this.match(TokenType.RightBracket);
      return {
        type: "MemberExpression",
        object: left,
        property,
        computed: true,
        optional: false,
      };
    }

    // Function call: fn(arg1, arg2)
    if (token.type === TokenType.LeftParen) {
      const args: ASTNode[] = [];
      if (this.peek().type !== TokenType.RightParen) {
        do {
          args.push(this.parseExpression(Precedence.Lowest));
        } while (this.match(TokenType.Comma));
      }
      this.match(TokenType.RightParen);
      return {
        type: "CallExpression",
        callee: left,
        arguments: args,
        optional: false,
      };
    }

    // Nullish Coalescing (??)
    if (token.type === TokenType.DoubleQuestion) {
      const right = this.parseExpression(Precedence.Nullish);
      return {
        type: "LogicalExpression",
        operator: "??",
        left,
        right,
      };
    }

    // Logical OR (||) and AND (&&)
    if (token.type === TokenType.BarBar || token.type === TokenType.AmpAmp) {
      const prec = token.type === TokenType.BarBar ? Precedence.LogicalOr : Precedence.LogicalAnd;
      const right = this.parseExpression(prec);
      return {
        type: "LogicalExpression",
        operator: token.value,
        left,
        right,
      };
    }

    // Binary arithmetic (+, -, *, /, %)
    if ([TokenType.Plus, TokenType.Minus, TokenType.Star, TokenType.Slash, TokenType.Percent].includes(token.type)) {
      const prec = [TokenType.Star, TokenType.Slash, TokenType.Percent].includes(token.type)
        ? Precedence.MulDiv
        : Precedence.AddSub;
      const right = this.parseExpression(prec);
      return {
        type: "BinaryExpression",
        operator: token.value,
        left,
        right,
      };
    }

    // Equality (===, ==, !==, !=)
    if ([TokenType.TripleEqual, TokenType.DoubleEqual, TokenType.StrictNotEqual, TokenType.NotEqual].includes(token.type)) {
      const right = this.parseExpression(Precedence.Equality);
      return {
        type: "BinaryExpression",
        operator: token.value,
        left,
        right,
      };
    }

    // Ternary: cond ? consequent : alternate
    if (token.type === TokenType.Question) {
      const consequent = this.parseExpression(Precedence.Lowest);
      this.match(TokenType.Colon);
      const alternate = this.parseExpression(Precedence.Ternary);
      return {
        type: "ConditionalExpression",
        test: left,
        consequent,
        alternate,
      };
    }

    // Assignment: left = right
    if (token.type === TokenType.Equal) {
      const right = this.parseExpression(Precedence.Assignment - 1);
      return {
        type: "BinaryExpression",
        operator: "=",
        left,
        right,
      };
    }

    throw new Error(`Unhandled infix operator: '${token.value}'`);
  }
}

// ─── Code Generator (AST Unparser) ──────────────────────────────────────

export class CodeGenerator {
  static generate(node: ASTNode): string {
    switch (node.type) {
      case "Identifier":
        return node.name;

      case "Literal":
        return node.raw;

      case "MemberExpression": {
        const objStr = CodeGenerator.generate(node.object);
        if (node.computed) {
          const propStr = CodeGenerator.generate(node.property);
          return node.optional ? `${objStr}?.[${propStr}]` : `${objStr}[${propStr}]`;
        }
        const propStr = CodeGenerator.generate(node.property);
        return node.optional ? `${objStr}?.${propStr}` : `${objStr}.${propStr}`;
      }

      case "BinaryExpression": {
        const leftStr = CodeGenerator.wrapIfNeeded(node.left);
        const rightStr = CodeGenerator.wrapIfNeeded(node.right);
        return `${leftStr} ${node.operator} ${rightStr}`;
      }

      case "LogicalExpression": {
        const leftStr = CodeGenerator.wrapIfNeeded(node.left);
        const rightStr = CodeGenerator.wrapIfNeeded(node.right);
        return `${leftStr} ${node.operator} ${rightStr}`;
      }

      case "ConditionalExpression": {
        const testStr = CodeGenerator.generate(node.test);
        const consStr = CodeGenerator.generate(node.consequent);
        const altStr = CodeGenerator.generate(node.alternate);
        return `${testStr} ? ${consStr} : ${altStr}`;
      }

      case "CallExpression": {
        const calleeStr = CodeGenerator.generate(node.callee);
        const argsStr = node.arguments.map(a => CodeGenerator.generate(a)).join(", ");
        return `${calleeStr}(${argsStr})`;
      }

      case "VariableDeclaration": {
        const decl = node.declarations[0];
        const idStr = CodeGenerator.generate(decl.id);
        const initStr = decl.init ? ` = ${CodeGenerator.generate(decl.init)}` : "";
        return `${node.kind} ${idStr}${initStr};`;
      }

      case "ReturnStatement": {
        return node.argument ? `return ${CodeGenerator.generate(node.argument)};` : "return;";
      }

      case "ExpressionStatement": {
        return `${CodeGenerator.generate(node.expression)};`;
      }

      default:
        throw new Error(`Unknown AST node type: ${(node as any).type}`);
    }
  }

  private static wrapIfNeeded(node: ASTNode): string {
    const str = CodeGenerator.generate(node);
    if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
      return `(${str})`;
    }
    return str;
  }
}

// ─── AST Helpers for Self-Healing ───────────────────────────────────────

/**
 * Extract full property chain from a MemberExpression AST node.
 * Example: `payload.data.attributes.amount` -> `["payload", "data", "attributes", "amount"]`
 * Example: `payload["attributes"]["amount"]` -> `["payload", "attributes", "amount"]`
 */
export function extractPropertyChainFromAST(node: ASTNode): string[] {
  const chain: string[] = [];

  function traverse(n: ASTNode) {
    if (n.type === "MemberExpression") {
      traverse(n.object);
      if (n.property.type === "Identifier") {
        chain.push(n.property.name);
      } else if (n.property.type === "Literal") {
        chain.push(String(n.property.value));
      }
    } else if (n.type === "Identifier") {
      chain.push(n.name);
    }
  }

  traverse(node);
  return chain;
}

/**
 * Find all MemberExpression nodes inside an AST tree.
 */
export function findMemberExpressionsInAST(root: ASTNode): MemberExpressionNode[] {
  const results: MemberExpressionNode[] = [];

  function traverse(n: ASTNode) {
    if (n.type === "MemberExpression") {
      results.push(n);
      traverse(n.object);
      traverse(n.property);
    } else if (n.type === "BinaryExpression" || n.type === "LogicalExpression") {
      traverse(n.left);
      traverse(n.right);
    } else if (n.type === "ConditionalExpression") {
      traverse(n.test);
      traverse(n.consequent);
      traverse(n.alternate);
    } else if (n.type === "CallExpression") {
      traverse(n.callee);
      n.arguments.forEach(traverse);
    } else if (n.type === "VariableDeclaration") {
      n.declarations.forEach(d => {
        if (d.init) traverse(d.init);
      });
    } else if (n.type === "ReturnStatement") {
      if (n.argument) traverse(n.argument);
    }
  }

  traverse(root);
  return results;
}
