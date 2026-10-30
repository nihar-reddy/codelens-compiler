# CodeLens 1.3.3 — Fresh Engine Fix

This is a local-first educational web app for exploring a restricted, line-oriented C/C++ source analyzer. This package includes a matched frontend and Python backend that both report version **1.3.3**. It uses port **8023** to avoid confusing it with older CodeLens servers running on ports 8000, 8017, 8018, 8019, or 8020.

## Fastest way to start on macOS

1. Extract this ZIP to your Desktop. It creates a folder named `codelens-1.3.3`.
2. Open Terminal and run:

   ```bash
   cd ~/Desktop/codelens-1.3.3
   bash start-codelens.command
   ```

3. Open **http://127.0.0.1:8023**. Keep the Terminal window open while using CodeLens.
4. Confirm the header says **CODELENS 1.3.3 · FRESH ENGINE FIX** and **ENGINE CONNECTED · 1.3.3**.

The server health endpoint is http://127.0.0.1:8023/api/health. It should return JSON with `"ok": true` and `"version": "1.3.3"`.

## Manual start

If you don't want to use the launcher:

```bash
cd ~/Desktop/codelens-1.3.3
CODELENS_PORT=8023 python3 server.py
```

## If the engine still says offline

- Make sure the browser URL is **exactly** `http://127.0.0.1:8023` — not port 8000 or 8019.
- Stop any server started from an older CodeLens folder with **Ctrl+C** in its Terminal.
- In the same Terminal where you started 1.3.3, check `http://127.0.0.1:8023/api/health` in the browser. It must show version `1.3.3`.
- Do not open `index.html` by double-clicking. Use the local Python server URL.

## Workflow

1. Source program input, upload and demo loader
2. Lexical token stream with kind and line
3. Simplified hierarchical structure tree and delimiter diagnostics
4. Symbol/use table
5. Simplified sequential control-flow sketch
6. Definition/use and assignment trace
7. Redundancy rule evaluation
8. Human-readable explanation engine
9. Filterable source-level warnings and report export
10. Suggested revised source with reviewable edits

## Five quality metrics

- **Analysis latency:** elapsed analysis request time, in milliseconds.
- **Redundancy density:** findings per 100 lines of source.
- **Benchmark precision:** TP / (TP + FP).
- **Benchmark recall:** TP / (TP + FN).
- **Benchmark F1-score:** harmonic mean of precision and recall.

Precision, recall, and F1 are calculated using the included labeled cases; they are not guarantees for every C/C++ program. Findings are matched by type and multiplicity. Use the benchmark detail table to see where the current heuristic analyzer has false positives and false negatives.

## Tests

```bash
python3 -m unittest -v test_analyzer.py
```

## Limitations

CodeLens is not a full C/C++ compiler or standards-compliant parser. Its statement structure and control-flow views are simplified and line-oriented; nested scopes, macros, pointer side effects, and comprehensive branch-sensitive analysis are limited. Always review suggested edits before reusing the revised source.
