"""Lightweight, explainable source analyzer for a restricted C/C++ subset.

This is an educational heuristic analyzer, not a standards-complete C/C++ parser.
It intentionally analyzes one main statement per source line and does not model
full expression semantics, nested scopes, macros, pointers, or branch-sensitive CFGs.
"""
from __future__ import annotations

import re
import time
from collections import OrderedDict
from typing import Any

KEYWORDS = set("auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false class public private protected using namespace std cout cin endl printf scanf main nullptr".split())
TOKEN_RE = re.compile(
    r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|'
    r'\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*|==|!=|<=|>=|&&|\|\||\+\+|--|->|<<|>>|'
    r'\+=|-=|\*=|/=|%=|[{}()\[\];,=+\-*/%<>!&|:.?]'
)
ID_RE = re.compile(r'\b[A-Za-z_]\w*\b')
DECL_RE = re.compile(r'^\s*(?:(?:const|static|unsigned|signed)\s+)*(int|float|double|char|bool|long|short)\s+([A-Za-z_]\w*)\s*(?:=\s*(.*?))?\s*;?\s*$')
ASSIGN_RE = re.compile(r'^\s*([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|/=|%=)\s*(.*?)\s*;\s*$')
FUNCTION_RE = re.compile(r'^(?:(?:int|void|float|double|char|bool|long|short)\s+)?[A-Za-z_]\w*\s*\([^;]*\)\s*$')
CONTROL_RE = re.compile(r'^(if|else\s+if|else|while|for|switch|case|do)\b')


def _replace_comments(match: re.Match[str]) -> str:
    value = match.group(0)
    if value.startswith(('//', '/*')):
        return ''.join('\n' if ch == '\n' else ' ' for ch in value)
    return value


def strip_comments(source: str) -> str:
    """Remove comments without damaging quoted strings or line numbering."""
    return re.sub(
        r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/',
        _replace_comments,
        source,
    )


def tokenize(source: str) -> list[dict[str, str]]:
    clean = strip_comments(source)
    result: list[dict[str, str]] = []
    for match in TOKEN_RE.finditer(clean):
        value = match.group(0)
        if value.startswith(('//', '/*')):
            continue
        if value in KEYWORDS:
            kind = 'keyword'
        elif re.fullmatch(r'\d+(?:\.\d+)?', value):
            kind = 'number'
        elif value.startswith(('"', "'")):
            kind = 'literal'
        elif re.fullmatch(r'[A-Za-z_]\w*', value):
            kind = 'identifier'
        elif value in '{}()[];,.:?':
            kind = 'symbol'
        else:
            kind = 'operator'
        result.append({'value': value, 'kind': kind})
    return result


def _mask_literals(line: str) -> str:
    return re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', lambda m: ' ' * len(m.group(0)), line)


def _parse_line(raw: str, line_no: int, depth: int) -> dict[str, Any] | None:
    """Classify one line after braces are removed from the statement text."""
    s = raw.strip()
    if not s or s.startswith('#'):
        return None
    # Remove leading closing braces and trailing braces, but keep the body of
    # constructs such as `} else {` so the analysis can resume in the parent.
    while s.startswith('}'):
        s = s[1:].strip()
    while s.endswith('{') or s.endswith('}'):
        s = s[:-1].strip()
    s = s.strip()
    if not s or s == ';':
        return None

    # Function definitions are represented as structure nodes, not variable declarations.
    if FUNCTION_RE.match(s) and not CONTROL_RE.match(s) and ('(' in raw) and ('{' in raw):
        return {'line': line_no, 'text': s, 'kind': 'function', 'depth': max(0, depth)}

    decl = DECL_RE.match(s)
    if decl:
        typ, name, value = decl.groups()
        return {'line': line_no, 'text': s, 'kind': 'declaration', 'var': name,
                'type': typ, 'value': (value or '').strip(), 'initialized': value is not None,
                'depth': max(0, depth)}

    if re.match(r'^return\b', s):
        return {'line': line_no, 'text': s, 'kind': 'return', 'depth': max(0, depth)}

    ass = ASSIGN_RE.match(s)
    if ass:
        name, op, value = ass.groups()
        return {'line': line_no, 'text': s, 'kind': 'assignment', 'var': name,
                'op': op, 'value': value.strip(), 'depth': max(0, depth)}

    if CONTROL_RE.match(s):
        return {'line': line_no, 'text': s, 'kind': 'control', 'depth': max(0, depth)}

    return {'line': line_no, 'text': s, 'kind': 'statement', 'depth': max(0, depth)}


def _collect_statements(source: str) -> list[dict[str, Any]]:
    clean = strip_comments(source)
    statements: list[dict[str, Any]] = []
    depth = 0
    for line_no, raw in enumerate(clean.splitlines(), 1):
        masked = _mask_literals(raw)
        # The depth where a statement appears is after any leading close brace.
        leading_closes = len(re.match(r'^\s*(}*)', masked).group(1))
        stmt_depth = max(0, depth - leading_closes)
        st = _parse_line(raw, line_no, stmt_depth)
        if st:
            statements.append(st)
        # Update depth from braces outside strings/character literals.
        depth = max(0, depth + masked.count('{') - masked.count('}'))
    return statements


def _detect_unreachable(statements: list[dict[str, Any]]) -> set[int]:
    """Flag statements within the same brace region after an unconditional return."""
    unreachable_lines: set[int] = set()
    terminated_depth: int | None = None
    # Statement depths alone are insufficient to notice a closing brace on an
    # otherwise empty line, so infer region exits from the next observed depth.
    for i, st in enumerate(statements):
        depth = int(st.get('depth', 0))
        if st['kind'] == 'function':
            terminated_depth = None
            continue
        if terminated_depth is not None and depth < terminated_depth:
            terminated_depth = None
        if terminated_depth is not None and depth >= terminated_depth:
            unreachable_lines.add(st['line'])
        if st['kind'] == 'return' and st['line'] not in unreachable_lines:
            terminated_depth = depth
        # If next statement is in a shallower block, the return's region ended.
        if terminated_depth is not None and i + 1 < len(statements):
            next_depth = int(statements[i + 1].get('depth', 0))
            if next_depth < terminated_depth:
                terminated_depth = None
    return unreachable_lines


def _delimiter_issues(tokens: list[dict[str, str]]) -> list[dict[str, Any]]:
    pairs = {')': '(', ']': '[', '}': '{'}
    stack: list[tuple[str, int]] = []
    issues: list[dict[str, Any]] = []
    # Token line numbers are reconstructed from source in analyze() separately;
    # this helper checks delimiter balance only.
    for token in tokens:
        value = token['value']
        if value in ('(', '[', '{'):
            stack.append((value, token.get('line', 1)))
        elif value in pairs:
            if not stack or stack[-1][0] != pairs[value]:
                issues.append({'line': token.get('line', 1), 'message': f"Unexpected closing delimiter '{value}'."})
            else:
                stack.pop()
    for value, line in stack:
        issues.append({'line': line, 'message': f"Opening delimiter '{value}' is not closed."})
    return issues


def _tokens_with_lines(source: str) -> list[dict[str, Any]]:
    clean = strip_comments(source)
    tokens: list[dict[str, Any]] = []
    for line_no, line in enumerate(clean.splitlines(), 1):
        for item in tokenize(line):
            tokens.append({**item, 'line': line_no})
    return tokens


def _pure_expression(expression: str) -> bool:
    """Conservative check: only literals, identifiers and side-effect-free operators."""
    expr = expression.strip()
    if not expr:
        return True
    if re.search(r'\b[A-Za-z_]\w*\s*\(', expr):
        return False  # possible function call
    if any(op in expr for op in ('++', '--', '+=', '-=', '*=', '/=', '%=', '=')):
        return False
    # Deliberately limited expression alphabet: no member access, indexing or commas.
    return bool(re.fullmatch(r"[A-Za-z_\w\s'\".+\-*/%()!<>&|^~]+", expr))


def _revised_source(source: str, statements: list[dict[str, Any]], symbols: OrderedDict,
                    warnings: list[dict[str, Any]], syntax_issues: list[dict[str, Any]],
                    unreachable_lines: set[int]) -> tuple[str, list[dict[str, Any]], str | None]:
    """Apply only conservative single-line fixes; avoid rewriting malformed input."""
    if syntax_issues:
        return source, [], 'Automatic edits are paused because delimiter/structure issues exist.'

    lines = source.splitlines()
    by_line = {int(st['line']): st for st in statements}
    edits: dict[int, str | None] = {}
    fixes: list[dict[str, Any]] = []

    # First remove clearly unreachable supported statements, one source line at a time.
    for line_no in sorted(unreachable_lines):
        if 1 <= line_no <= len(lines) and line_no not in edits:
            raw = lines[line_no - 1]
            stripped = raw.strip()
            # Don't delete structural/control rows if the parser's line granularity is ambiguous.
            if stripped and not stripped.startswith(('}', 'else', 'if ', 'while ', 'for ')) and '{' not in stripped and '}' not in stripped:
                edits[line_no] = None
                fixes.append({'line': line_no, 'action': 'Remove unreachable statement',
                              'description': 'Removed a statement after an unconditional return in the same supported block.'})

    # Remove unused declarations only when their initializer is safely side-effect free.
    unreachable_decl_lines = {line for line in unreachable_lines}
    for warning in warnings:
        if warning['type'] != 'Unused Variable':
            continue
        line_no = int(warning['line'])
        if line_no in edits or line_no in unreachable_decl_lines:
            continue
        st = by_line.get(line_no)
        if not st or st.get('kind') != 'declaration':
            continue
        if _pure_expression(st.get('value', '')):
            edits[line_no] = None
            fixes.append({'line': line_no, 'action': 'Remove unused declaration',
                          'description': f"Removed unused variable '{st['var']}' because its initializer has no detected side effects."})

    # Remove an earlier definition only if the detector established that it is overwritten
    # before a read. For a declaration, keep the declaration itself and remove only the initializer.
    for warning in warnings:
        if warning['type'] != 'Redundant Assignment':
            continue
        line_no = int(warning['line'])
        if line_no in edits:
            continue
        st = by_line.get(line_no)
        if not st:
            continue
        if st.get('kind') == 'declaration':
            raw = lines[line_no - 1] if 1 <= line_no <= len(lines) else ''
            # const objects require an initializer; don't create invalid C++ by removing it.
            prefix_match = re.match(r'^(\s*)(?:(?:const|static|unsigned|signed)\s+)*(?:int|float|double|char|bool|long|short)\s+[A-Za-z_]\w*\s*=', raw)
            if prefix_match and not re.search(r'\bconst\b', raw.split('=')[0]) and _pure_expression(st.get('value', '')):
                replacement = re.sub(r'\s*=\s*.*?;?\s*$', ';', raw)
                edits[line_no] = replacement
                fixes.append({'line': line_no, 'action': 'Remove overwritten initializer',
                              'description': f"Kept the declaration of '{st['var']}' but removed its value, which was overwritten before any read."})
        elif st.get('kind') == 'assignment' and _pure_expression(st.get('value', '')):
            edits[line_no] = None
            fixes.append({'line': line_no, 'action': 'Remove overwritten assignment',
                          'description': f"Removed the earlier assignment to '{st.get('var', 'variable')}' because its value was overwritten before any read."})

    if not edits:
        return source, [], 'No conservative automatic edits were applicable; the original source is preserved.'

    revised_lines = [line for i, line in enumerate(lines, 1) if edits.get(i, line) is not None]
    for i, replacement in edits.items():
        if replacement is not None:
            # Assignments were applied after filtering deletions; reconstruct using source-index map below.
            pass
    # Rebuild from original positions so replacements and deletions keep their intended ordering.
    revised_lines = []
    for i, line in enumerate(lines, 1):
        if i not in edits:
            revised_lines.append(line)
        elif edits[i] is not None:
            revised_lines.append(edits[i] or '')
    revised = '\n'.join(revised_lines)
    if source.endswith('\n'):
        revised += '\n'
    # Preserve source order in the change log and only list lines where a real edit happened.
    fixes.sort(key=lambda item: item['line'])
    return revised, fixes, None


def analyze(source: str) -> dict[str, Any]:
    started_at = time.perf_counter()
    if not isinstance(source, str):
        raise TypeError('Source code must be a string.')
    clean = strip_comments(source)
    raw_tokens = _tokens_with_lines(source)
    # Delimiter checking uses token positions and therefore ignores braces in strings/comments.
    syntax_issues = _delimiter_issues(raw_tokens)
    statements = _collect_statements(clean)
    symbols: OrderedDict[str, dict[str, Any]] = OrderedDict()
    warnings: list[dict[str, Any]] = []

    for st in statements:
        if st['kind'] == 'declaration':
            name = st['var']
            # Deliberately simple: identifiers are keyed by name, not full lexical scope.
            symbols[name] = {
                'name': name, 'type': st['type'], 'line': st['line'],
                'initialized': st['initialized'], 'used': False, 'reads': 0,
                'writes': 1 if st['initialized'] else 0,
            }

    unreachable_lines = _detect_unreachable(statements)

    # Symbol/read-use analysis ignores code classified as unreachable.
    for st in statements:
        if st['line'] in unreachable_lines:
            continue
        read_names: list[str] = []
        if st['kind'] == 'declaration':
            read_names = ID_RE.findall(st.get('value', ''))
        elif st['kind'] == 'assignment':
            read_names = ID_RE.findall(st.get('value', ''))
            if st.get('op') != '=':
                read_names.append(st['var'])
        else:
            read_names = ID_RE.findall(st['text'])
        for name in read_names:
            if name in symbols:
                symbols[name]['used'] = True
                symbols[name]['reads'] += 1
        if st['kind'] == 'assignment' and st['var'] in symbols:
            symbols[st['var']]['writes'] += 1

    for sym in symbols.values():
        if not sym['used']:
            warnings.append({
                'line': sym['line'], 'variable': sym['name'], 'type': 'Unused Variable', 'severity': 'warning',
                'message': f"Variable '{sym['name']}' is declared but never read.",
                'reason': f"No read of '{sym['name']}' was found in reachable supported statements.",
                'analysis': 'Symbol / Use Analysis',
                'suggestion': f"Remove '{sym['name']}' if it is not needed, or read its value where intended.",
            })

    # Reaching-definition approximation: reads consume pending values before a
    # statement's target is overwritten, preventing false positives for x = x + 1.
    pending: dict[str, dict[str, Any]] = {}
    for st in statements:
        if st['line'] in unreachable_lines:
            continue
        kind = st['kind']
        reads: list[str] = []
        if kind == 'declaration':
            reads = ID_RE.findall(st.get('value', ''))
        elif kind == 'assignment':
            reads = ID_RE.findall(st.get('value', ''))
            if st.get('op') != '=':
                reads.append(st['var'])
        else:
            reads = ID_RE.findall(st['text'])
        for name in reads:
            pending.pop(name, None)

        if kind == 'declaration' and st.get('initialized'):
            pending[st['var']] = {'line': st['line'], 'value': st.get('value', '')}
        elif kind == 'assignment' and st['var'] in symbols:
            var = st['var']
            if var in pending:
                prev = pending[var]
                warnings.append({
                    'line': prev['line'], 'related_line': st['line'], 'variable': var,
                    'type': 'Redundant Assignment', 'severity': 'warning',
                    'message': f"Value assigned to '{var}' is overwritten before being read.",
                    'reason': f"The definition at line {prev['line']} is replaced at line {st['line']} without an intervening read in the supported sequential flow.",
                    'analysis': 'Definition-Use Analysis',
                    'suggestion': 'Remove the earlier assignment if its value has no required side effect.',
                })
            pending[var] = {'line': st['line'], 'value': st.get('value', '')}

    # Literal constant-condition check; this warns about the condition only and
    # does not claim to resolve or remove an entire branch.
    for st in statements:
        if st['kind'] == 'control':
            match = re.match(r'^if\s*\(\s*(true|false|0|1)\s*\)', st['text'])
            if match:
                literal = match.group(1)
                meaning = 'always true' if literal in ('true', '1') else 'always false'
                warnings.append({
                    'line': st['line'], 'type': 'Constant Condition', 'severity': 'info',
                    'message': f"Condition uses literal '{literal}' and is {meaning}.",
                    'reason': 'The condition contains a literal boolean/integer value rather than a runtime expression.',
                    'analysis': 'Constant-Condition Check',
                    'suggestion': 'Verify that this is intentional; replace it with a meaningful condition if needed.',
                })

    for st in statements:
        if st['line'] in unreachable_lines:
            warnings.append({
                'line': st['line'], 'type': 'Unreachable Code', 'severity': 'error',
                'message': 'Statement appears after an unconditional return in the same block.',
                'reason': 'Sequential control flow has already terminated at a preceding return statement.',
                'analysis': 'Basic Control-Flow Analysis',
                'suggestion': 'Move the statement before the return or remove it if unnecessary.',
            })

    # Build an honest, simplified flow sketch for the UI (not a complete CFG).
    flow_nodes: list[dict[str, Any]] = [{'id': 'start', 'label': 'Start', 'line': 0, 'kind': 'start', 'reachable': True}]
    for idx, st in enumerate(statements, 1):
        if st['kind'] == 'function':
            continue
        flow_nodes.append({
            'id': f"n{idx}", 'label': st['text'][:76], 'line': st['line'],
            'kind': st['kind'], 'reachable': st['line'] not in unreachable_lines,
        })
    flow_nodes.append({'id': 'exit', 'label': 'Exit', 'line': 0, 'kind': 'exit', 'reachable': True})

    warnings.sort(key=lambda w: (w['line'], w['type']))
    unique: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for warning in warnings:
        key = (warning['line'], warning['type'])
        if key not in seen:
            seen.add(key)
            unique.append(warning)

    statement_rows = [{
        'line': st['line'], 'text': st['text'], 'kind': st['kind'],
        'depth': st.get('depth', 0), 'reachable': st['line'] not in unreachable_lines,
    } for st in statements]

    revised_source, applied_fixes, rewrite_note = _revised_source(
        source, statements, symbols, unique, syntax_issues, unreachable_lines
    )
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    line_count = max(1, len(source.splitlines()))
    summary = {
        'lines': len(source.splitlines()), 'tokens': len(raw_tokens),
        'symbols': len(symbols), 'statements': len(statements),
        'warnings': len(unique),
        'unused': sum(w['type'] == 'Unused Variable' for w in unique),
        'unreachable': sum(w['type'] == 'Unreachable Code' for w in unique),
        'assignments': sum(w['type'] == 'Redundant Assignment' for w in unique),
        'constants': sum(w['type'] == 'Constant Condition' for w in unique),
        'syntax_issues': len(syntax_issues),
        'analysis_ms': round(elapsed_ms, 3),
        'redundancy_density': round(len(unique) * 100 / line_count, 2),
    }
    return {
        'tokens': raw_tokens,
        'symbols': list(symbols.values()),
        'statements': statement_rows,
        'flow_nodes': flow_nodes,
        'syntax_issues': syntax_issues,
        'warnings': unique,
        'revised_source': revised_source,
        'applied_fixes': applied_fixes,
        'rewrite_note': rewrite_note,
        'summary': summary,
        'scope_note': 'Educational heuristic for a restricted, line-oriented C/C++ subset. It does not implement a full C/C++ grammar, scope-aware symbols, branch-sensitive CFG/data-flow, macro expansion, pointer analysis, or interprocedural analysis.',
    }
