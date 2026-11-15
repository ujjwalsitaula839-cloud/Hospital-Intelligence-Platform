"""Run every automated check and write one plain-language HTML report.

Sections:
  1. HIPAA safeguards  - backend checks (tests/security, run in a throwaway python:3.11-slim container)
                         plus browser checks (frontend/src/test/HipaaBrowserSafeguards.test.tsx)
  2. Accessibility     - jest-axe and keyboard/screen-reader checks (frontend/src/test/A11y.test.tsx)
  3. Other frontend    - every other Vitest test

Usage, from the repository root:
    python tests/security/run_checks.py                  # everything
    python tests/security/run_checks.py --skip-backend   # frontend only (no Docker needed)
    python tests/security/run_checks.py --skip-frontend  # HIPAA backend only

Requires Docker for the backend checks and `npm ci` in frontend/ for the frontend checks.
Exit code: 0 when nothing failed (known gaps are expected), 1 otherwise.
"""
import argparse
from datetime import datetime
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FRONTEND = ROOT / "frontend"
DEFAULT_OUTPUT = HERE / "results" / "test-report.html"

HIPAA_BROWSER_FILE = "HipaaBrowserSafeguards.test.tsx"
A11Y_FILES = {"A11y.test.tsx"}

STATUS_LABELS = {
    "passed": "Pass",
    "known_gap": "Known gap",
    "failed": "Fail",
    "error": "Could not run",
    "gap_closed": "Gap closed",
    "skipped": "Skipped",
}


# ---------------------------------------------------------------------------
# Collectors
# ---------------------------------------------------------------------------

def _docker() -> str:
    found = shutil.which("docker")
    if found:
        return found
    # Standard Docker Desktop locations on Windows (all-users and per-user installs), for shells opened before install.
    for candidate in (Path(r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"),
                      Path.home() / "AppData" / "Local" / "Programs" / "DockerDesktop" / "resources" / "bin" / "docker.exe"):
        if candidate.exists():
            return str(candidate)
    raise RuntimeError("Docker was not found on PATH. Start Docker Desktop or use --skip-backend.")


def backend_rows() -> list:
    command = [
        _docker(), "run", "--rm",
        "-v", f"{ROOT}:/repo:ro",
        "-v", "hip-security-pip-cache:/root/.cache/pip",
        "-w", "/repo", "-e", "PYTHONDONTWRITEBYTECODE=1",
        "python:3.11-slim", "sh", "-c",
        "pip install -q --disable-pip-version-check --root-user-action=ignore -r tests/security/requirements.txt"
        " && python tests/security/hipaa_runner.py --json",
    ]
    process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    lines = [line for line in process.stdout.splitlines() if line.strip().startswith("[")]
    if not lines:
        raise RuntimeError(f"Backend checks produced no results.\n{process.stderr[-2000:]}")
    rows = []
    for row in json.loads(lines[-1]):
        rows.append({
            "section": "hipaa",
            "group": "Backend services",
            "hipaa": row["section"],
            "safeguard": row["safeguard"],
            "finding": row.get("finding", ""),
            "description": row["description"],
            "status": row["status"],
            "detail": (row.get("gap") + "\n" if row.get("gap") else "") + (row.get("detail") or ""),
        })
    return rows


def frontend_rows(runner=subprocess.run) -> list:
    vitest = FRONTEND / "node_modules" / "vitest" / "vitest.mjs"
    node = shutil.which("node")
    if not vitest.exists() or not node:
        raise RuntimeError("Frontend dependencies are missing. Run `npm ci` in frontend/ first.")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "vitest.json"
        proc = runner([node, str(vitest), "run", "--reporter=json", f"--outputFile={out}"],
                      cwd=FRONTEND, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
        if not out.exists():
            diagnostics = (getattr(proc, "stderr", "") or getattr(proc, "stdout", "") or "").strip()
            raise RuntimeError(f"Vitest did not produce a JSON report (exit code {getattr(proc, 'returncode', 1)}).\n{diagnostics}")
        data = json.loads(out.read_text(encoding="utf-8"))

    rows = []
    for test_file in data.get("testResults", []):
        file_name = Path(test_file["name"]).name
        if file_name == HIPAA_BROWSER_FILE:
            section = "hipaa"
        elif file_name in A11Y_FILES:
            section = "a11y"
        else:
            section = "other"
        if not test_file.get("assertionResults") and test_file.get("status") == "failed":
            rows.append({"section": section, "group": file_name, "hipaa": "", "safeguard": "",
                         "description": "Test file could not be loaded", "status": "error",
                         "detail": test_file.get("message", "")})
            continue
        for test in test_file.get("assertionResults", []):
            title = test["title"]
            describe = " › ".join(test.get("ancestorTitles", []))
            known_gap = title.startswith("[known gap]")
            raw = test.get("status")
            if raw == "passed":
                status = "known_gap" if known_gap else "passed"
            elif raw == "failed":
                status = "gap_closed" if known_gap else "failed"
            else:
                status = "skipped"
            hipaa_section, safeguard = "", ""
            if section == "hipaa":
                match = re.match(r"HIPAA (§[^ ]+(?: \+ §[^ ]+)?) (.*)", describe)
                if match:
                    hipaa_section, safeguard = match.group(1), match.group(2).split(":")[0]
            rows.append({
                "section": section,
                "group": "Browser" if section == "hipaa" else file_name,
                "hipaa": hipaa_section,
                "safeguard": safeguard,
                "description": title.replace("[known gap] ", ""),
                "context": describe,
                "status": status,
                "detail": "\n".join(test.get("failureMessages") or []) or (
                    "This browser check fails on main today and is marked it.fails until the gap is fixed; "
                    "the test describes the required behaviour." if status == "known_gap" else ""),
            })

    # If Vitest exited nonzero but parsed results don't already reflect a failure/error,
    # record an error row so teardown or runtime crashes cannot masquerade as an all-green run.
    has_failures = any(r["status"] in ("failed", "error", "gap_closed") for r in rows)
    if getattr(proc, "returncode", 0) != 0 and not has_failures:
        diagnostics = (getattr(proc, "stderr", "") or getattr(proc, "stdout", "") or "").strip()
        rows.append({
            "section": "other",
            "group": "Vitest runner",
            "hipaa": "",
            "safeguard": "",
            "description": f"Vitest runner failed (exit code {proc.returncode})",
            "context": "Frontend test runner",
            "status": "error",
            "detail": diagnostics or f"Vitest process exited with status code {proc.returncode}.",
        })

    return rows


# ---------------------------------------------------------------------------
# HTML report
# ---------------------------------------------------------------------------

def _counts(rows):
    return {key: sum(r["status"] == key for r in rows) for key in STATUS_LABELS}


def _badge(status):
    return f'<span class="badge {status}">{STATUS_LABELS[status]}</span>'


def _table(rows, hipaa=False):
    head = ("<th scope='col'>Result</th><th scope='col'>What is checked</th>"
            + ("<th scope='col'>HIPAA section</th><th scope='col'>Safeguard</th><th scope='col'>Where</th>" if hipaa
               else "<th scope='col'>Test file / group</th>"))
    body = []
    order = {"failed": 0, "error": 1, "gap_closed": 2, "known_gap": 3, "skipped": 4, "passed": 5}
    for r in sorted(rows, key=lambda r: (order[r["status"]], r.get("hipaa", ""), r["group"], r["description"])):
        detail = ""
        if r["detail"].strip() and r["status"] != "passed":
            summary = "Why this is a known gap" if r["status"] == "known_gap" else "Technical details"
            detail = f"<details><summary>{summary}</summary><pre>{html.escape(r['detail'].strip()[:4000])}</pre></details>"
        context = f"<small>{html.escape(r['context'])}</small>" if r.get("context") and not hipaa else ""
        finding = f"<small>{html.escape(r['finding'])}</small>" if r.get("finding") else ""
        if hipaa:
            extra = f"<td>{html.escape(r['hipaa'])}</td><td>{html.escape(r['safeguard'])}</td><td>{html.escape(r['group'])}</td>"
        else:
            extra = f"<td>{html.escape(r['group'])}</td>"
        body.append(f"<tr><td>{_badge(r['status'])}</td><td>{html.escape(r['description'])}{finding}{context}{detail}</td>{extra}</tr>")
    return f"<div class='table-wrap'><table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table></div>"


def _summary_cards(counts, total, label_id):
    cards = "".join(
        f"<li class='card {key}'><strong>{counts[key]}</strong><span>{STATUS_LABELS[key]}</span></li>"
        for key in ("passed", "known_gap", "failed", "error", "gap_closed") if counts[key] or key in ("passed", "known_gap", "failed")
    )
    return f"<ul class='cards' aria-labelledby='{label_id}'><li class='card total'><strong>{total}</strong><span>Total</span></li>{cards}</ul>"


SECTIONS = [
    ("hipaa", "HIPAA safeguards",
     "Checks of the HIPAA Security Rule technical safeguards (45 CFR §164.312) and related requirements, run "
     "against the real service code with synthetic data. A <em>known gap</em> is a check that describes the "
     "required behaviour for a gap that exists today; it is expected to fail until the code is fixed."),
    ("a11y", "Accessibility",
     "Automated axe (WCAG 2.2 AA) scans of the sign-in pages and main dialogs, plus keyboard focus and "
     "screen-reader announcement checks. Colour contrast is checked separately in a real browser."),
    ("other", "Other frontend tests", "Behaviour of pages, dialogs and helpers in the web app."),
]


def write_html(rows, destination: Path, notes: list):
    total_counts = _counts(rows)
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    parts = [f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test Report</title>
<style>
:root {{ --bg:#f5f7fa; --surface:#ffffff; --text:#14202e; --muted:#4a5868; --line:#d5dde6; --head:#e9eff5;
  --pass:#17623b; --pass-bg:#e3f4ea; --gap:#7a4a00; --gap-bg:#fdf1d8; --fail:#9b1c1c; --fail-bg:#fde4e4;
  --err:#5b3a8c; --err-bg:#efe7fb; --link:#0b5394; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#0f141a; --surface:#18202a; --text:#e8eef5; --muted:#a9b6c4;
  --line:#2c3846; --head:#212c38; --pass:#7ee2a8; --pass-bg:#123222; --gap:#f6c56b; --gap-bg:#3a2a0b;
  --fail:#ff9c9c; --fail-bg:#3d1414; --err:#cdb4ff; --err-bg:#2a1d44; --link:#8cc4ff; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width:1200px; margin:0 auto; padding:24px 16px 48px; }}
h1 {{ margin:0 0 4px; font-size:1.75rem; }} h2 {{ margin:40px 0 4px; font-size:1.3rem; }}
p.lead, p.meta, footer {{ color:var(--muted); }}
a {{ color:var(--link); }}
nav ul {{ display:flex; flex-wrap:wrap; gap:8px 16px; padding:0; list-style:none; }}
.cards {{ display:flex; flex-wrap:wrap; gap:12px; padding:0; margin:16px 0; list-style:none; }}
.card {{ background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 16px; min-width:120px; }}
.card strong {{ display:block; font-size:1.8rem; line-height:1.1; }}
.card span {{ color:var(--muted); font-size:.9rem; }}
.card.passed strong {{ color:var(--pass); }} .card.known_gap strong {{ color:var(--gap); }}
.card.failed strong, .card.error strong {{ color:var(--fail); }} .card.gap_closed strong {{ color:var(--err); }}
.table-wrap {{ overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--surface); }}
table {{ border-collapse:collapse; width:100%; min-width:640px; }}
th, td {{ text-align:left; vertical-align:top; padding:10px 12px; border-bottom:1px solid var(--line); }}
th {{ background:var(--head); font-size:.85rem; text-transform:uppercase; letter-spacing:.04em; }}
tr:last-child td {{ border-bottom:0; }}
td small {{ display:block; color:var(--muted); margin-top:2px; }}
.badge {{ display:inline-block; padding:2px 8px; border-radius:999px; font-size:.8rem; font-weight:700; white-space:nowrap; }}
.badge.passed {{ color:var(--pass); background:var(--pass-bg); }} .badge.known_gap {{ color:var(--gap); background:var(--gap-bg); }}
.badge.failed, .badge.error {{ color:var(--fail); background:var(--fail-bg); }} .badge.gap_closed, .badge.skipped {{ color:var(--err); background:var(--err-bg); }}
details {{ margin-top:6px; }} summary {{ cursor:pointer; color:var(--link); }}
pre {{ white-space:pre-wrap; overflow-wrap:anywhere; font-size:.8rem; background:var(--head); padding:8px; border-radius:6px; }}
:focus-visible {{ outline:2px solid var(--link); outline-offset:2px; }}
.note {{ background:var(--gap-bg); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:10px 14px; }}
</style>
</head>
<body>
<main>
<h1>Hospital Intelligence Platform: test report</h1>
<p class="meta">Generated {generated}. Synthetic data only; no production systems or patient data were used.</p>
<h2 id="overall" style="margin-top:16px">Overall</h2>
{_summary_cards(total_counts, len(rows), "overall")}
<nav aria-label="Report sections"><ul>
{''.join(f"<li><a href='#{key}'>{title} ({len([r for r in rows if r['section'] == key])})</a></li>" for key, title, _ in SECTIONS)}
</ul></nav>
"""]
    for note in notes:
        parts.append(f"<p class='note' role='note'>{html.escape(note)}</p>")
    for key, title, lead in SECTIONS:
        section_rows = [r for r in rows if r["section"] == key]
        parts.append(f"<section aria-labelledby='{key}'><h2 id='{key}'>{title}</h2><p class='lead'>{lead}</p>")
        if section_rows:
            parts.append(_summary_cards(_counts(section_rows), len(section_rows), key))
            parts.append(_table(section_rows, hipaa=(key == "hipaa")))
        else:
            parts.append("<p>No results for this section in this run.</p>")
        parts.append("</section>")
    parts.append("""<footer><h2>What these checks do not cover</h2>
<p>Passing these checks does not by itself establish HIPAA compliance. Not covered: risk analysis and risk management,
workforce training, business associate agreements (including the external language-model provider), encryption at
rest for the database and backups, contingency and backup plans, physical safeguards, deployed TLS certificates and
review of the audit logs.</p></footer>
</main>
</body>
</html>""")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(parts), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-backend", action="store_true", help="do not run the containerised HIPAA backend checks")
    parser.add_argument("--skip-frontend", action="store_true", help="do not run the Vitest suite")
    args = parser.parse_args()

    rows, notes = [], []
    if not args.skip_backend:
        print("Running HIPAA backend checks in a python:3.11-slim container...")
        try:
            rows += backend_rows()
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as problem:
            notes.append(f"HIPAA backend checks could not run: {problem}")
    else:
        notes.append("HIPAA backend checks were skipped for this run (--skip-backend).")
    if not args.skip_frontend:
        print("Running frontend tests (Vitest)...")
        try:
            rows += frontend_rows()
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as problem:
            notes.append(f"Frontend tests could not run: {problem}")
    else:
        notes.append("Frontend tests were skipped for this run (--skip-frontend).")

    write_html(rows, args.output, notes)
    counts = _counts(rows)
    print("\n" + " | ".join(f"{counts[k]} {STATUS_LABELS[k].lower()}" for k in STATUS_LABELS if counts[k]))
    for key, title, _ in SECTIONS:
        section = _counts([r for r in rows if r["section"] == key])
        print(f"  {title}: " + ", ".join(f"{v} {STATUS_LABELS[k].lower()}" for k, v in section.items() if v))
    for note in notes:
        print("NOTE: " + note)
    print(f"Report: {args.output.resolve()}")
    broken = counts["failed"] + counts["error"] + counts["gap_closed"]
    return 1 if broken or any("could not run" in n for n in notes) else 0


if __name__ == "__main__":
    sys.exit(main())
