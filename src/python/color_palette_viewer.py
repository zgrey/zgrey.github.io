"""
color_palette_viewer.py
----------------------
Read the Markdown colour‑palette table (color‑palette.md) and display each entry
with a coloured swatch and its label.

Usage:
    $ python -m src.python.color_palette_viewer   # from the repo root
or
    $ python src/python/color_palette_viewer.py   # from anywhere

If the optional `rich` library is installed, the output will be colourised in
the terminal; otherwise a plain‑text fallback is used.
"""

import pathlib
import re
import sys

# ----------------------------------------------------------------------
# Helper: optional pretty printing with the `rich` library
# ----------------------------------------------------------------------
try:
    from rich.console import Console
    from rich.table import Table
    from rich.text import Text
    rich_available = True
    console = Console()
except Exception:            # graceful fallback if rich is not installed
    rich_available = False

# ----------------------------------------------------------------------
# Parse the markdown table
# ----------------------------------------------------------------------
TABLE_LINE_RE = re.compile(r'^\s*\|(.+?)\|\s*$')   # matches a line that starts/ends with '|'

def _clean_cell(cell: str) -> str:
    """Strip surrounding back‑ticks and whitespace from a table cell."""
    return cell.strip().strip('`').strip()

def parse_palette_markdown(md_path: pathlib.Path):
    """
    Read ``color‑palette.md`` and return a list of dicts:

        [
            {"var": "--color-bg-primary", "hex": "#1a1a1a", "desc": "Main background"},
            ...
        ]
    """
    if not md_path.is_file():
        raise FileNotFoundError(f"Palette file not found: {md_path}")

    entries = []
    with md_path.open(encoding="utf-8") as f:
        for line in f:
            # Keep only the lines that look like a markdown table row
            if not line.lstrip().startswith("|"):
                continue
            # Skip the markdown separator line (---|---|---)
            if re.search(r'\|[-:]+\|', line):
                continue

            match = TABLE_LINE_RE.match(line)
            if not match:
                continue

            # Split on '|' but ignore empty parts from leading/trailing pipe
            raw_cells = [c for c in match.group(1).split("|")]
            if len(raw_cells) < 2:
                continue          # not enough columns

            # Expected order: variable | hex | (optional) description
            var   = _clean_cell(raw_cells[0])
            hexc  = _clean_cell(raw_cells[1])
            desc  = _clean_cell(raw_cells[2]) if len(raw_cells) > 2 else ""

            entries.append({"var": var, "hex": hexc, "desc": desc})
    return entries

# ----------------------------------------------------------------------
# Rendering helpers
# ----------------------------------------------------------------------
def _render_rich(entries):
    """Show a colourful table using `rich`."""
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Variable", style="cyan")
    table.add_column("Hex", style="white")
    table.add_column("Swatch", justify="center")
    table.add_column("Description", style="dim")

    for e in entries:
        # Create a tiny coloured block using the background colour of the hex code
        swatch = Text("   ", style=f"on {e['hex']}")
        table.add_row(e["var"], e["hex"], swatch, e["desc"] or "-")
    console.print(table)


def _render_plain(entries):
    """Simple ASCII output when `rich` is not available."""
    max_var = max(len(e["var"]) for e in entries) if entries else 0
    max_hex = max(len(e["hex"]) for e in entries) if entries else 0
    header = f"{'Variable'.ljust(max_var)}  {'Hex'.ljust(max_hex)}  Description"
    print(header)
    print("-" * len(header))
    for e in entries:
        var = e["var"].ljust(max_var)
        hexc = e["hex"].ljust(max_hex)
        desc = e["desc"]
        print(f"{var}  {hexc}  {desc}")

# ----------------------------------------------------------------------
# Main entry point
# ----------------------------------------------------------------------
def main():
    # Repository root is two levels up from this file (src/python/)
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    palette_path = repo_root / "color-palette.md"

    try:
        entries = parse_palette_markdown(palette_path)
    except Exception as exc:
        sys.stderr.write(f"Error loading colour palette: {exc}\n")
        sys.exit(1)

    if not entries:
        print("No colour entries found in the palette file.")
        return

    if rich_available:
        _render_rich(entries)
    else:
        _render_plain(entries)


if __name__ == "__main__":
    main()
