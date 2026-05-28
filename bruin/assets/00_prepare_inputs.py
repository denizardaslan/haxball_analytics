"""@bruin
name: haxball.prepare_inputs
type: python
@bruin"""

from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[2]
LIVE_DIR = ROOT / "data"
SAMPLE_DIR = ROOT / "sample_data"
TARGET_DIR = LIVE_DIR / "bruin_input"


def collect_jsonl(source_dir: Path, target_file: Path) -> int:
    files = sorted(source_dir.glob("*.jsonl"))
    target_file.parent.mkdir(parents=True, exist_ok=True)
    rows = 0

    with target_file.open("w", encoding="utf-8") as output:
        for file_path in files:
            with file_path.open("r", encoding="utf-8") as input_file:
                for line in input_file:
                    if line.strip():
                        output.write(line)
                        rows += 1

    return rows


def source_for(kind: str) -> Path:
    live_source = LIVE_DIR / kind
    if live_source.exists() and any(live_source.glob("*.jsonl")):
        return live_source
    return SAMPLE_DIR / kind


TARGET_DIR.mkdir(parents=True, exist_ok=True)
snapshot_rows = collect_jsonl(source_for("snapshots"), TARGET_DIR / "snapshots.jsonl")
event_rows = collect_jsonl(source_for("events"), TARGET_DIR / "events.jsonl")

metadata = TARGET_DIR / "source_manifest.txt"
metadata.write_text(
    "\n".join(
        [
            f"snapshots={snapshot_rows}",
            f"events={event_rows}",
            f"snapshot_source={source_for('snapshots')}",
            f"event_source={source_for('events')}",
        ]
    )
    + "\n",
    encoding="utf-8",
)

shutil.copyfile(TARGET_DIR / "snapshots.jsonl", TARGET_DIR / "latest_snapshots.jsonl")
shutil.copyfile(TARGET_DIR / "events.jsonl", TARGET_DIR / "latest_events.jsonl")
